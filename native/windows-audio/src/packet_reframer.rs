use std::collections::VecDeque;
use std::error::Error;
use std::fmt::{Display, Formatter};

use crate::capture_plan::SharedCapturePlan;
use crate::wasapi_capture::{CapturePacketFlags, CapturedPacket};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReframedPacket {
    pub frames: u32,
    pub bytes: Vec<u8>,
    pub flags: CapturePacketFlags,
    pub device_position_frames: u64,
    pub qpc_position_100ns: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PacketReframeError {
    BlockAlignZero,
    TargetFrameCountZero,
    PacketSizeOverflow { frames: u32, block_align: u16 },
    PacketByteCountMismatch { expected: usize, actual: usize },
    PositionOverflow,
}

impl Display for PacketReframeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BlockAlignZero => f.write_str("packet reframer block alignment must be non-zero"),
            Self::TargetFrameCountZero => {
                f.write_str("packet reframer target frame count must be non-zero")
            }
            Self::PacketSizeOverflow {
                frames,
                block_align,
            } => write!(
                f,
                "packet byte size overflow for {frames} frames at block alignment {block_align}"
            ),
            Self::PacketByteCountMismatch { expected, actual } => write!(
                f,
                "packet byte count mismatch: expected {expected}, got {actual}"
            ),
            Self::PositionOverflow => f.write_str("packet timestamp/position arithmetic overflow"),
        }
    }
}

impl Error for PacketReframeError {}

#[derive(Debug)]
struct PendingSegment {
    bytes: Vec<u8>,
    frames: u32,
    consumed_frames: u32,
    silent: bool,
    discontinuity_at_start: bool,
    timestamp_error: bool,
    device_position_frames: u64,
    qpc_position_100ns: u64,
}

impl PendingSegment {
    fn remaining_frames(&self) -> u32 {
        self.frames - self.consumed_frames
    }
}

#[derive(Debug)]
pub struct PacketReframer {
    block_align: u16,
    target_frames: u32,
    sample_rate_hz: u32,
    pending_frames: u64,
    segments: VecDeque<PendingSegment>,
}

impl PacketReframer {
    pub fn new(plan: SharedCapturePlan, block_align: u16) -> Result<Self, PacketReframeError> {
        if block_align == 0 {
            return Err(PacketReframeError::BlockAlignZero);
        }
        if plan.pipeline_frames_per_channel == 0 {
            return Err(PacketReframeError::TargetFrameCountZero);
        }

        Ok(Self {
            block_align,
            target_frames: plan.pipeline_frames_per_channel,
            sample_rate_hz: plan.format.sample_rate_hz,
            pending_frames: 0,
            segments: VecDeque::new(),
        })
    }

    pub fn pending_frames(&self) -> u64 {
        self.pending_frames
    }

    pub fn reset(&mut self) {
        self.pending_frames = 0;
        self.segments.clear();
    }

    pub fn push(
        &mut self,
        packet: CapturedPacket,
    ) -> Result<Vec<ReframedPacket>, PacketReframeError> {
        let expected = packet_byte_len(packet.frames, self.block_align)?;
        if packet.bytes.len() != expected {
            return Err(PacketReframeError::PacketByteCountMismatch {
                expected,
                actual: packet.bytes.len(),
            });
        }
        if packet.frames == 0 {
            return Ok(Vec::new());
        }

        if packet.flags.data_discontinuity {
            self.reset();
        }

        self.pending_frames = self
            .pending_frames
            .checked_add(u64::from(packet.frames))
            .ok_or(PacketReframeError::PositionOverflow)?;
        self.segments.push_back(PendingSegment {
            bytes: packet.bytes,
            frames: packet.frames,
            consumed_frames: 0,
            silent: packet.flags.silent,
            discontinuity_at_start: packet.flags.data_discontinuity,
            timestamp_error: packet.flags.timestamp_error,
            device_position_frames: packet.device_position_frames,
            qpc_position_100ns: packet.qpc_position_100ns,
        });

        let mut output = Vec::new();
        while self.pending_frames >= u64::from(self.target_frames) {
            output.push(self.pop_frame()?);
        }
        Ok(output)
    }

    fn pop_frame(&mut self) -> Result<ReframedPacket, PacketReframeError> {
        let target_bytes = packet_byte_len(self.target_frames, self.block_align)?;
        let mut bytes = Vec::with_capacity(target_bytes);
        let mut frames_needed = self.target_frames;
        let mut flags = CapturePacketFlags {
            silent: true,
            data_discontinuity: false,
            timestamp_error: false,
        };
        let mut first_position = None;

        while frames_needed > 0 {
            let segment = self
                .segments
                .front_mut()
                .expect("pending frame accounting must have a source segment");
            let take_frames = frames_needed.min(segment.remaining_frames());
            let start_frame = segment.consumed_frames;

            if first_position.is_none() {
                let device_offset = u64::from(start_frame);
                let qpc_offset = frames_to_100ns(device_offset, self.sample_rate_hz)?;
                first_position = Some((
                    segment
                        .device_position_frames
                        .checked_add(device_offset)
                        .ok_or(PacketReframeError::PositionOverflow)?,
                    segment
                        .qpc_position_100ns
                        .checked_add(qpc_offset)
                        .ok_or(PacketReframeError::PositionOverflow)?,
                ));
            }

            flags.silent &= segment.silent;
            flags.timestamp_error |= segment.timestamp_error;
            if segment.discontinuity_at_start && start_frame == 0 {
                flags.data_discontinuity = true;
            }

            let start_byte = packet_byte_len(start_frame, self.block_align)?;
            let take_bytes = packet_byte_len(take_frames, self.block_align)?;
            let end_byte = start_byte
                .checked_add(take_bytes)
                .ok_or(PacketReframeError::PositionOverflow)?;
            bytes.extend_from_slice(&segment.bytes[start_byte..end_byte]);

            segment.consumed_frames += take_frames;
            segment.discontinuity_at_start = false;
            frames_needed -= take_frames;

            if segment.consumed_frames == segment.frames {
                self.segments.pop_front();
            }
        }

        self.pending_frames -= u64::from(self.target_frames);
        let (device_position_frames, qpc_position_100ns) =
            first_position.expect("a complete frame must have a source position");
        Ok(ReframedPacket {
            frames: self.target_frames,
            bytes,
            flags,
            device_position_frames,
            qpc_position_100ns,
        })
    }
}

fn packet_byte_len(frames: u32, block_align: u16) -> Result<usize, PacketReframeError> {
    usize::try_from(frames)
        .ok()
        .and_then(|frames| frames.checked_mul(usize::from(block_align)))
        .ok_or(PacketReframeError::PacketSizeOverflow {
            frames,
            block_align,
        })
}

fn frames_to_100ns(frames: u64, sample_rate_hz: u32) -> Result<u64, PacketReframeError> {
    frames
        .checked_mul(10_000_000)
        .ok_or(PacketReframeError::PositionOverflow)
        .map(|ticks| ticks / u64::from(sample_rate_hz))
}

#[cfg(test)]
mod tests {
    use super::*;
    use vsn_audio_core::AudioFormat;

    fn plan(target_frames: u32) -> SharedCapturePlan {
        SharedCapturePlan {
            format: AudioFormat {
                sample_rate_hz: 48_000,
                channels: 1,
                frame_duration_ms: 10,
            },
            pipeline_frames_per_channel: target_frames,
            pipeline_samples: target_frames as usize,
            engine_period_frames: target_frames,
            cadence: crate::capture_plan::CaptureCadence::Exact,
        }
    }

    fn packet(
        frames: u32,
        start_value: u8,
        flags: CapturePacketFlags,
        position: u64,
    ) -> CapturedPacket {
        CapturedPacket {
            frames,
            bytes: (0..frames).map(|offset| start_value + offset as u8).collect(),
            flags,
            device_position_frames: position,
            qpc_position_100ns: position * 10_000_000 / 48_000,
        }
    }

    #[test]
    fn accumulates_short_packets_into_exact_pipeline_frame() {
        let mut reframer = PacketReframer::new(plan(4), 1).expect("valid reframer");

        assert!(reframer
            .push(packet(2, 1, CapturePacketFlags::default(), 0))
            .expect("packet accepted")
            .is_empty());
        let frames = reframer
            .push(packet(2, 3, CapturePacketFlags::default(), 2))
            .expect("packet accepted");

        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].bytes, vec![1, 2, 3, 4]);
        assert_eq!(frames[0].frames, 4);
        assert_eq!(reframer.pending_frames(), 0);
    }

    #[test]
    fn splits_large_packet_and_keeps_frame_aligned_remainder() {
        let mut reframer = PacketReframer::new(plan(4), 1).expect("valid reframer");
        let frames = reframer
            .push(packet(10, 0, CapturePacketFlags::default(), 100))
            .expect("packet accepted");

        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].bytes, vec![0, 1, 2, 3]);
        assert_eq!(frames[1].bytes, vec![4, 5, 6, 7]);
        assert_eq!(frames[0].device_position_frames, 100);
        assert_eq!(frames[1].device_position_frames, 104);
        assert_eq!(reframer.pending_frames(), 2);
    }

    #[test]
    fn discontinuity_drops_partial_data_and_marks_next_output_once() {
        let mut reframer = PacketReframer::new(plan(4), 1).expect("valid reframer");
        reframer
            .push(packet(2, 1, CapturePacketFlags::default(), 0))
            .expect("packet accepted");
        let frames = reframer
            .push(packet(
                4,
                10,
                CapturePacketFlags {
                    data_discontinuity: true,
                    ..CapturePacketFlags::default()
                },
                20,
            ))
            .expect("packet accepted");

        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].bytes, vec![10, 11, 12, 13]);
        assert!(frames[0].flags.data_discontinuity);
        assert_eq!(frames[0].device_position_frames, 20);
        assert_eq!(reframer.pending_frames(), 0);
    }

    #[test]
    fn silent_requires_all_contributing_packets_to_be_silent() {
        let mut reframer = PacketReframer::new(plan(4), 1).expect("valid reframer");
        reframer
            .push(packet(
                2,
                0,
                CapturePacketFlags {
                    silent: true,
                    ..CapturePacketFlags::default()
                },
                0,
            ))
            .expect("packet accepted");
        let frames = reframer
            .push(packet(2, 2, CapturePacketFlags::default(), 2))
            .expect("packet accepted");

        assert!(!frames[0].flags.silent);
    }

    #[test]
    fn rejects_packet_byte_count_that_breaks_frame_alignment() {
        let mut reframer = PacketReframer::new(plan(4), 2).expect("valid reframer");
        let mut invalid = packet(2, 0, CapturePacketFlags::default(), 0);
        invalid.bytes = vec![0, 1, 2];

        assert!(matches!(
            reframer.push(invalid),
            Err(PacketReframeError::PacketByteCountMismatch {
                expected: 4,
                actual: 3
            })
        ));
    }
}
