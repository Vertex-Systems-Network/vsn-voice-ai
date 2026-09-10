use std::error::Error;
use std::fmt::{Display, Formatter};
use std::mem::size_of;

use vsn_audio_core::AudioFormat;

pub const VIRTUAL_MIC_PROTOCOL_MAGIC: u32 = u32::from_le_bytes(*b"VSNM");
// Version 2 adds one seqlock-style stamp per PCM ring slot.
pub const VIRTUAL_MIC_PROTOCOL_VERSION: u16 = 2;
pub const VIRTUAL_MIC_SAMPLE_FORMAT_F32_LE: u16 = 1;
pub const VIRTUAL_MIC_SLOT_STAMP_WRITING_BIT: u64 = 1;
pub const VIRTUAL_MIC_MAX_FRAME_SEQUENCE: u64 = u64::MAX >> 1;

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VirtualMicProtocolHeader {
    pub magic: u32,
    pub version: u16,
    pub header_bytes: u16,
    pub session_generation: u64,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub sample_format: u16,
    pub frame_duration_micros: u32,
    pub capacity_frames: u32,
    pub samples_per_frame: u32,
    pub reserved: u32,
}

impl VirtualMicProtocolHeader {
    pub fn new(
        format: AudioFormat,
        capacity_frames: usize,
        session_generation: u64,
    ) -> Result<Self, VirtualMicProtocolError> {
        if session_generation == 0 {
            return Err(VirtualMicProtocolError::InvalidSessionGeneration);
        }
        if capacity_frames == 0 || capacity_frames > u32::MAX as usize {
            return Err(VirtualMicProtocolError::InvalidCapacity(capacity_frames));
        }

        let samples_per_frame = format
            .samples_per_frame()
            .map_err(|error| VirtualMicProtocolError::InvalidFormat(error.to_string()))?;
        let samples_per_frame = u32::try_from(samples_per_frame)
            .map_err(|_| VirtualMicProtocolError::InvalidFormat("frame is too large".into()))?;
        let frame_duration_micros = u32::from(format.frame_duration_ms)
            .checked_mul(1_000)
            .ok_or_else(|| {
                VirtualMicProtocolError::InvalidFormat("frame duration overflow".into())
            })?;
        let header_bytes = u16::try_from(size_of::<Self>())
            .map_err(|_| VirtualMicProtocolError::HeaderSizeOverflow)?;

        Ok(Self {
            magic: VIRTUAL_MIC_PROTOCOL_MAGIC,
            version: VIRTUAL_MIC_PROTOCOL_VERSION,
            header_bytes,
            session_generation,
            sample_rate_hz: format.sample_rate_hz,
            channels: format.channels,
            sample_format: VIRTUAL_MIC_SAMPLE_FORMAT_F32_LE,
            frame_duration_micros,
            capacity_frames: capacity_frames as u32,
            samples_per_frame,
            reserved: 0,
        })
    }

    pub fn validate(&self) -> Result<AudioFormat, VirtualMicProtocolError> {
        if self.magic != VIRTUAL_MIC_PROTOCOL_MAGIC {
            return Err(VirtualMicProtocolError::MagicMismatch {
                expected: VIRTUAL_MIC_PROTOCOL_MAGIC,
                actual: self.magic,
            });
        }
        if self.version != VIRTUAL_MIC_PROTOCOL_VERSION {
            return Err(VirtualMicProtocolError::VersionMismatch {
                expected: VIRTUAL_MIC_PROTOCOL_VERSION,
                actual: self.version,
            });
        }
        if usize::from(self.header_bytes) != size_of::<Self>() {
            return Err(VirtualMicProtocolError::HeaderSizeMismatch {
                expected: size_of::<Self>(),
                actual: usize::from(self.header_bytes),
            });
        }
        if self.session_generation == 0 {
            return Err(VirtualMicProtocolError::InvalidSessionGeneration);
        }
        if self.capacity_frames == 0 {
            return Err(VirtualMicProtocolError::InvalidCapacity(0));
        }
        if self.sample_format != VIRTUAL_MIC_SAMPLE_FORMAT_F32_LE {
            return Err(VirtualMicProtocolError::UnsupportedSampleFormat(
                self.sample_format,
            ));
        }
        if self.frame_duration_micros == 0 || !self.frame_duration_micros.is_multiple_of(1_000) {
            return Err(VirtualMicProtocolError::InvalidFrameDurationMicros(
                self.frame_duration_micros,
            ));
        }

        let frame_duration_ms =
            u16::try_from(self.frame_duration_micros / 1_000).map_err(|_| {
                VirtualMicProtocolError::InvalidFrameDurationMicros(self.frame_duration_micros)
            })?;
        let format = AudioFormat {
            sample_rate_hz: self.sample_rate_hz,
            channels: self.channels,
            frame_duration_ms,
        };
        let expected_samples = format
            .samples_per_frame()
            .map_err(|error| VirtualMicProtocolError::InvalidFormat(error.to_string()))?;
        let actual_samples = usize::try_from(self.samples_per_frame)
            .map_err(|_| VirtualMicProtocolError::InvalidFormat("frame is too large".into()))?;
        if actual_samples != expected_samples {
            return Err(VirtualMicProtocolError::SamplesPerFrameMismatch {
                expected: expected_samples,
                actual: actual_samples,
            });
        }
        if self.reserved != 0 {
            return Err(VirtualMicProtocolError::ReservedFieldNonZero(self.reserved));
        }

        Ok(format)
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct VirtualMicCursorSnapshot {
    pub session_generation: u64,
    pub producer_sequence: u64,
    pub consumer_sequence: u64,
    pub overrun_drops: u64,
    pub underruns: u64,
}

#[repr(C, align(8))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct VirtualMicFrameSlotStamp {
    pub value: u64,
}

pub const fn can_encode_frame_sequence(sequence: u64) -> bool {
    sequence <= VIRTUAL_MIC_MAX_FRAME_SEQUENCE
}

pub const fn encode_stable_slot_stamp(sequence: u64) -> u64 {
    sequence << 1
}

pub const fn encode_writing_slot_stamp(sequence: u64) -> u64 {
    encode_stable_slot_stamp(sequence) | VIRTUAL_MIC_SLOT_STAMP_WRITING_BIT
}

pub const fn slot_stamp_is_writing(stamp: u64) -> bool {
    stamp & VIRTUAL_MIC_SLOT_STAMP_WRITING_BIT != 0
}

pub const fn decode_slot_stamp_sequence(stamp: u64) -> u64 {
    stamp >> 1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VirtualMicRingPlan {
    pub capacity_frames: u64,
    pub buffered_frames: u64,
    pub producer_slot: usize,
    pub consumer_slot: usize,
    pub normalized_consumer_sequence: u64,
    pub dropped_frames: u64,
}

pub fn plan_ring_window(
    header: &VirtualMicProtocolHeader,
    cursors: VirtualMicCursorSnapshot,
) -> Result<VirtualMicRingPlan, VirtualMicProtocolError> {
    header.validate()?;
    if cursors.session_generation != header.session_generation {
        return Err(VirtualMicProtocolError::SessionGenerationMismatch {
            expected: header.session_generation,
            actual: cursors.session_generation,
        });
    }
    if cursors.producer_sequence < cursors.consumer_sequence {
        return Err(VirtualMicProtocolError::CursorOrderInvalid {
            producer: cursors.producer_sequence,
            consumer: cursors.consumer_sequence,
        });
    }
    if cursors.producer_sequence > VIRTUAL_MIC_MAX_FRAME_SEQUENCE + 1
        || cursors.consumer_sequence > VIRTUAL_MIC_MAX_FRAME_SEQUENCE + 1
    {
        return Err(VirtualMicProtocolError::FrameSequenceOverflow);
    }

    let capacity_frames = u64::from(header.capacity_frames);
    let raw_buffered = cursors.producer_sequence - cursors.consumer_sequence;
    let dropped_frames = raw_buffered.saturating_sub(capacity_frames);
    let normalized_consumer_sequence = cursors.consumer_sequence + dropped_frames;
    let buffered_frames = raw_buffered.min(capacity_frames);
    let producer_slot = usize::try_from(cursors.producer_sequence % capacity_frames)
        .map_err(|_| VirtualMicProtocolError::SlotIndexOverflow)?;
    let consumer_slot = usize::try_from(normalized_consumer_sequence % capacity_frames)
        .map_err(|_| VirtualMicProtocolError::SlotIndexOverflow)?;

    Ok(VirtualMicRingPlan {
        capacity_frames,
        buffered_frames,
        producer_slot,
        consumer_slot,
        normalized_consumer_sequence,
        dropped_frames,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VirtualMicProtocolError {
    InvalidFormat(String),
    InvalidCapacity(usize),
    InvalidSessionGeneration,
    HeaderSizeOverflow,
    SlotIndexOverflow,
    FrameSequenceOverflow,
    MagicMismatch { expected: u32, actual: u32 },
    VersionMismatch { expected: u16, actual: u16 },
    HeaderSizeMismatch { expected: usize, actual: usize },
    UnsupportedSampleFormat(u16),
    InvalidFrameDurationMicros(u32),
    SamplesPerFrameMismatch { expected: usize, actual: usize },
    ReservedFieldNonZero(u32),
    SessionGenerationMismatch { expected: u64, actual: u64 },
    CursorOrderInvalid { producer: u64, consumer: u64 },
}

impl Display for VirtualMicProtocolError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidFormat(message) => {
                write!(f, "invalid virtual microphone format: {message}")
            }
            Self::InvalidCapacity(capacity) => {
                write!(f, "invalid virtual microphone ring capacity: {capacity}")
            }
            Self::InvalidSessionGeneration => {
                f.write_str("virtual microphone session generation must be non-zero")
            }
            Self::HeaderSizeOverflow => {
                f.write_str("virtual microphone protocol header is too large")
            }
            Self::SlotIndexOverflow => f.write_str("virtual microphone ring slot index overflow"),
            Self::FrameSequenceOverflow => {
                f.write_str("virtual microphone frame sequence exceeds slot-stamp encoding")
            }
            Self::MagicMismatch { expected, actual } => write!(
                f,
                "virtual microphone protocol magic mismatch: expected {expected:#010x}, got {actual:#010x}"
            ),
            Self::VersionMismatch { expected, actual } => write!(
                f,
                "virtual microphone protocol version mismatch: expected {expected}, got {actual}"
            ),
            Self::HeaderSizeMismatch { expected, actual } => write!(
                f,
                "virtual microphone protocol header size mismatch: expected {expected}, got {actual}"
            ),
            Self::UnsupportedSampleFormat(format) => {
                write!(f, "unsupported virtual microphone sample format: {format}")
            }
            Self::InvalidFrameDurationMicros(duration) => write!(
                f,
                "invalid virtual microphone frame duration in microseconds: {duration}"
            ),
            Self::SamplesPerFrameMismatch { expected, actual } => write!(
                f,
                "virtual microphone samples-per-frame mismatch: expected {expected}, got {actual}"
            ),
            Self::ReservedFieldNonZero(value) => write!(
                f,
                "virtual microphone reserved protocol field must be zero, got {value}"
            ),
            Self::SessionGenerationMismatch { expected, actual } => write!(
                f,
                "virtual microphone session generation mismatch: expected {expected}, got {actual}"
            ),
            Self::CursorOrderInvalid { producer, consumer } => write!(
                f,
                "virtual microphone cursor order invalid: producer {producer}, consumer {consumer}"
            ),
        }
    }
}

impl Error for VirtualMicProtocolError {}

#[cfg(test)]
mod tests {
    use super::*;

    const FORMAT: AudioFormat = AudioFormat {
        sample_rate_hz: 48_000,
        channels: 1,
        frame_duration_ms: 10,
    };

    #[test]
    fn protocol_header_round_trips_reference_format() {
        let header = VirtualMicProtocolHeader::new(FORMAT, 8, 1).expect("header");

        assert_eq!(header.validate().expect("valid header"), FORMAT);
        assert_eq!(header.magic, VIRTUAL_MIC_PROTOCOL_MAGIC);
        assert_eq!(header.version, VIRTUAL_MIC_PROTOCOL_VERSION);
        assert_eq!(
            usize::from(header.header_bytes),
            size_of::<VirtualMicProtocolHeader>()
        );
        assert_eq!(header.sample_format, VIRTUAL_MIC_SAMPLE_FORMAT_F32_LE);
        assert_eq!(header.frame_duration_micros, 10_000);
        assert_eq!(header.samples_per_frame, 480);
        assert_eq!(header.capacity_frames, 8);
        assert_eq!(size_of::<VirtualMicFrameSlotStamp>(), 8);
        assert_eq!(std::mem::align_of::<VirtualMicFrameSlotStamp>(), 8);
    }

    #[test]
    fn protocol_rejects_unknown_version() {
        let mut header = VirtualMicProtocolHeader::new(FORMAT, 8, 1).expect("header");
        header.version = VIRTUAL_MIC_PROTOCOL_VERSION + 1;

        assert!(matches!(
            header.validate(),
            Err(VirtualMicProtocolError::VersionMismatch { .. })
        ));
    }

    #[test]
    fn slot_stamp_encoding_distinguishes_writing_from_stable() {
        let sequence = 42;
        let writing = encode_writing_slot_stamp(sequence);
        let stable = encode_stable_slot_stamp(sequence);

        assert!(can_encode_frame_sequence(sequence));
        assert!(slot_stamp_is_writing(writing));
        assert!(!slot_stamp_is_writing(stable));
        assert_eq!(decode_slot_stamp_sequence(writing), sequence);
        assert_eq!(decode_slot_stamp_sequence(stable), sequence);
    }

    #[test]
    fn generation_change_requires_cursor_reset_or_rebind() {
        let header = VirtualMicProtocolHeader::new(FORMAT, 8, 7).expect("header");
        let cursors = VirtualMicCursorSnapshot {
            session_generation: 6,
            ..VirtualMicCursorSnapshot::default()
        };

        assert!(matches!(
            plan_ring_window(&header, cursors),
            Err(VirtualMicProtocolError::SessionGenerationMismatch { .. })
        ));
    }

    #[test]
    fn ring_slots_wrap_deterministically() {
        let header = VirtualMicProtocolHeader::new(FORMAT, 4, 1).expect("header");
        let cursors = VirtualMicCursorSnapshot {
            session_generation: 1,
            producer_sequence: 6,
            consumer_sequence: 3,
            ..VirtualMicCursorSnapshot::default()
        };

        let plan = plan_ring_window(&header, cursors).expect("ring plan");

        assert_eq!(plan.buffered_frames, 3);
        assert_eq!(plan.producer_slot, 2);
        assert_eq!(plan.consumer_slot, 3);
        assert_eq!(plan.dropped_frames, 0);
    }

    #[test]
    fn overrun_discards_oldest_frames_and_preserves_bounded_window() {
        let header = VirtualMicProtocolHeader::new(FORMAT, 4, 1).expect("header");
        let cursors = VirtualMicCursorSnapshot {
            session_generation: 1,
            producer_sequence: 10,
            consumer_sequence: 2,
            ..VirtualMicCursorSnapshot::default()
        };

        let plan = plan_ring_window(&header, cursors).expect("ring plan");

        assert_eq!(plan.buffered_frames, 4);
        assert_eq!(plan.dropped_frames, 4);
        assert_eq!(plan.normalized_consumer_sequence, 6);
        assert_eq!(plan.consumer_slot, 2);
        assert_eq!(plan.producer_slot, 2);
    }

    #[test]
    fn cursor_order_is_monotonic_within_generation() {
        let header = VirtualMicProtocolHeader::new(FORMAT, 4, 1).expect("header");
        let cursors = VirtualMicCursorSnapshot {
            session_generation: 1,
            producer_sequence: 3,
            consumer_sequence: 4,
            ..VirtualMicCursorSnapshot::default()
        };

        assert!(matches!(
            plan_ring_window(&header, cursors),
            Err(VirtualMicProtocolError::CursorOrderInvalid { .. })
        ));
    }

    #[test]
    fn ring_plan_rejects_cursor_beyond_slot_stamp_encoding() {
        let header = VirtualMicProtocolHeader::new(FORMAT, 4, 1).expect("header");
        let cursors = VirtualMicCursorSnapshot {
            session_generation: 1,
            producer_sequence: VIRTUAL_MIC_MAX_FRAME_SEQUENCE + 2,
            consumer_sequence: VIRTUAL_MIC_MAX_FRAME_SEQUENCE + 2,
            ..VirtualMicCursorSnapshot::default()
        };

        assert!(matches!(
            plan_ring_window(&header, cursors),
            Err(VirtualMicProtocolError::FrameSequenceOverflow)
        ));
    }
}
