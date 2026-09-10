use std::error::Error;
use std::fmt::{Display, Formatter};

use vsn_audio_core::{AudioError, AudioFormat, AudioFrame};

use crate::capture_plan::SharedCapturePlan;
use crate::packet_reframer::{PacketReframeError, PacketReframer, ReframedPacket};
use crate::sample_decode::{NativeSampleEncoding, SampleDecodeError, SampleDecoder};
use crate::wasapi_capture::{CapturePacketFlags, CapturedPacket};

#[derive(Debug, Clone, PartialEq)]
pub struct CapturedAudioFrame {
    pub frame: AudioFrame,
    pub flags: CapturePacketFlags,
    pub device_position_frames: u64,
    pub qpc_position_100ns: u64,
}

#[derive(Debug)]
pub struct CaptureFrameAssembler {
    format: AudioFormat,
    reframer: PacketReframer,
    decoder: SampleDecoder,
    next_sequence: u64,
}

impl CaptureFrameAssembler {
    pub fn new(
        plan: SharedCapturePlan,
        block_align: u16,
        encoding: NativeSampleEncoding,
        initial_sequence: u64,
    ) -> Result<Self, CaptureFrameAssemblyError> {
        let decoder = SampleDecoder::new(encoding, plan.format.channels)?;
        if decoder.frame_bytes() != usize::from(block_align) {
            return Err(CaptureFrameAssemblyError::BlockAlignMismatch {
                declared: block_align,
                expected: decoder.frame_bytes(),
            });
        }
        let reframer = PacketReframer::new(plan, block_align)?;

        Ok(Self {
            format: plan.format,
            reframer,
            decoder,
            next_sequence: initial_sequence,
        })
    }

    pub fn next_sequence(&self) -> u64 {
        self.next_sequence
    }

    pub fn pending_frames(&self) -> u64 {
        self.reframer.pending_frames()
    }

    pub fn reset_pending(&mut self) {
        self.reframer.reset();
    }

    pub fn push(
        &mut self,
        packet: CapturedPacket,
    ) -> Result<Vec<CapturedAudioFrame>, CaptureFrameAssemblyError> {
        let reframed = self.reframer.push(packet)?;
        let mut output = Vec::with_capacity(reframed.len());
        for packet in reframed {
            output.push(self.assemble(packet)?);
        }
        Ok(output)
    }

    fn assemble(
        &mut self,
        packet: ReframedPacket,
    ) -> Result<CapturedAudioFrame, CaptureFrameAssemblyError> {
        let samples = self.decoder.decode_interleaved(&packet.bytes)?;
        let sequence = self.next_sequence;
        let next_sequence = sequence
            .checked_add(1)
            .ok_or(CaptureFrameAssemblyError::SequenceOverflow)?;
        let captured_at_micros = packet.qpc_position_100ns / 10;
        let frame = AudioFrame::new(sequence, captured_at_micros, self.format, samples)?;
        self.next_sequence = next_sequence;

        Ok(CapturedAudioFrame {
            frame,
            flags: packet.flags,
            device_position_frames: packet.device_position_frames,
            qpc_position_100ns: packet.qpc_position_100ns,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureFrameAssemblyError {
    BlockAlignMismatch { declared: u16, expected: usize },
    SequenceOverflow,
    Reframe(PacketReframeError),
    Decode(SampleDecodeError),
    Audio(AudioError),
}

impl Display for CaptureFrameAssemblyError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BlockAlignMismatch { declared, expected } => write!(
                f,
                "capture frame block alignment mismatch: declared {declared}, expected {expected}"
            ),
            Self::SequenceOverflow => f.write_str("capture frame sequence overflow"),
            Self::Reframe(error) => write!(f, "capture packet reframing failed: {error}"),
            Self::Decode(error) => write!(f, "capture sample decoding failed: {error}"),
            Self::Audio(error) => write!(f, "capture audio frame validation failed: {error}"),
        }
    }
}

impl Error for CaptureFrameAssemblyError {}

impl From<PacketReframeError> for CaptureFrameAssemblyError {
    fn from(value: PacketReframeError) -> Self {
        Self::Reframe(value)
    }
}

impl From<SampleDecodeError> for CaptureFrameAssemblyError {
    fn from(value: SampleDecodeError) -> Self {
        Self::Decode(value)
    }
}

impl From<AudioError> for CaptureFrameAssemblyError {
    fn from(value: AudioError) -> Self {
        Self::Audio(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture_plan::CaptureCadence;

    const FORMAT: AudioFormat = AudioFormat {
        sample_rate_hz: 400,
        channels: 1,
        frame_duration_ms: 10,
    };

    fn plan() -> SharedCapturePlan {
        SharedCapturePlan {
            format: FORMAT,
            pipeline_frames_per_channel: 4,
            pipeline_samples: 4,
            engine_period_frames: 2,
            cadence: CaptureCadence::Accumulate,
        }
    }

    fn pcm16_packet(
        values: &[i16],
        flags: CapturePacketFlags,
        device_position_frames: u64,
    ) -> CapturedPacket {
        let mut bytes = Vec::with_capacity(values.len() * 2);
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        CapturedPacket {
            frames: values.len() as u32,
            bytes,
            flags,
            device_position_frames,
            qpc_position_100ns: device_position_frames * 10_000_000 / u64::from(FORMAT.sample_rate_hz),
        }
    }

    fn assembler(initial_sequence: u64) -> CaptureFrameAssembler {
        CaptureFrameAssembler::new(
            plan(),
            2,
            NativeSampleEncoding::Pcm {
                container_bits: 16,
                valid_bits: 16,
            },
            initial_sequence,
        )
        .expect("valid capture frame assembler")
    }

    #[test]
    fn aggregates_native_packets_into_valid_audio_frame() {
        let mut assembler = assembler(7);
        assert!(assembler
            .push(pcm16_packet(&[0, 16_384], CapturePacketFlags::default(), 0))
            .expect("first packet accepted")
            .is_empty());
        let output = assembler
            .push(pcm16_packet(&[-16_384, 32_767], CapturePacketFlags::default(), 2))
            .expect("second packet accepted");

        assert_eq!(output.len(), 1);
        assert_eq!(output[0].frame.sequence, 7);
        assert_eq!(output[0].frame.format, FORMAT);
        assert_eq!(output[0].frame.samples[0], 0.0);
        assert_eq!(output[0].frame.samples[1], 0.5);
        assert_eq!(output[0].frame.samples[2], -0.5);
        assert!(output[0].frame.samples[3] > 0.999);
        assert_eq!(output[0].frame.captured_at_micros, 0);
        assert_eq!(assembler.next_sequence(), 8);
        assert_eq!(assembler.pending_frames(), 0);
    }

    #[test]
    fn splits_large_packet_with_monotonic_sequence_and_capture_positions() {
        let mut assembler = assembler(10);
        let output = assembler
            .push(pcm16_packet(
                &[0, 0, 0, 0, 0, 0, 0, 0],
                CapturePacketFlags::default(),
                4,
            ))
            .expect("large packet accepted");

        assert_eq!(output.len(), 2);
        assert_eq!(output[0].frame.sequence, 10);
        assert_eq!(output[1].frame.sequence, 11);
        assert_eq!(output[0].device_position_frames, 4);
        assert_eq!(output[1].device_position_frames, 8);
        assert_eq!(output[0].frame.captured_at_micros, 10_000);
        assert_eq!(output[1].frame.captured_at_micros, 20_000);
        assert_eq!(assembler.next_sequence(), 12);
    }

    #[test]
    fn discontinuity_drops_partial_packet_and_marks_recovered_frame() {
        let mut assembler = assembler(0);
        assembler
            .push(pcm16_packet(&[1, 2], CapturePacketFlags::default(), 0))
            .expect("partial packet accepted");
        let output = assembler
            .push(pcm16_packet(
                &[3, 4, 5, 6],
                CapturePacketFlags {
                    data_discontinuity: true,
                    ..CapturePacketFlags::default()
                },
                20,
            ))
            .expect("recovery packet accepted");

        assert_eq!(output.len(), 1);
        assert!(output[0].flags.data_discontinuity);
        assert_eq!(output[0].device_position_frames, 20);
        assert_eq!(assembler.pending_frames(), 0);
    }

    #[test]
    fn timestamp_error_and_silence_metadata_survive_assembly() {
        let mut assembler = assembler(0);
        let output = assembler
            .push(pcm16_packet(
                &[0, 0, 0, 0],
                CapturePacketFlags {
                    silent: true,
                    timestamp_error: true,
                    ..CapturePacketFlags::default()
                },
                40,
            ))
            .expect("silent packet accepted");

        assert!(output[0].flags.silent);
        assert!(output[0].flags.timestamp_error);
        assert!(output[0].frame.samples.iter().all(|sample| *sample == 0.0));
    }

    #[test]
    fn rejects_block_alignment_that_disagrees_with_decoder() {
        assert!(matches!(
            CaptureFrameAssembler::new(
                plan(),
                4,
                NativeSampleEncoding::Pcm {
                    container_bits: 16,
                    valid_bits: 16
                },
                0
            ),
            Err(CaptureFrameAssemblyError::BlockAlignMismatch {
                declared: 4,
                expected: 2
            })
        ));
    }

    #[test]
    fn sequence_overflow_fails_without_advancing_sequence() {
        let mut assembler = assembler(u64::MAX);
        let error = assembler
            .push(pcm16_packet(&[0, 0, 0, 0], CapturePacketFlags::default(), 0))
            .expect_err("sequence overflow should fail");

        assert_eq!(error, CaptureFrameAssemblyError::SequenceOverflow);
        assert_eq!(assembler.next_sequence(), u64::MAX);
    }
}
