use std::error::Error;
use std::fmt::{Display, Formatter};

use vsn_audio_core::{AudioError, AudioFormat, AudioFrame, BoundedFrameQueue};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VirtualMicFrameSource {
    Buffered,
    SilenceFallback,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VirtualMicRead {
    pub frame: AudioFrame,
    pub source: VirtualMicFrameSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct VirtualMicTransportStats {
    pub accepted_frames: u64,
    pub overflow_drops: u64,
    pub underruns: u64,
}

#[derive(Debug)]
pub struct VirtualMicStagingBuffer {
    format: AudioFormat,
    samples_per_frame: usize,
    queue: BoundedFrameQueue,
    stats: VirtualMicTransportStats,
}

impl VirtualMicStagingBuffer {
    pub fn new(format: AudioFormat, capacity: usize) -> Result<Self, VirtualMicTransportError> {
        let samples_per_frame = format
            .samples_per_frame()
            .map_err(VirtualMicTransportError::Audio)?;
        let queue = BoundedFrameQueue::new(capacity).map_err(VirtualMicTransportError::Audio)?;

        Ok(Self {
            format,
            samples_per_frame,
            queue,
            stats: VirtualMicTransportStats::default(),
        })
    }

    pub fn format(&self) -> AudioFormat {
        self.format
    }

    pub fn capacity(&self) -> usize {
        self.queue.capacity()
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    pub fn stats(&self) -> VirtualMicTransportStats {
        self.stats
    }

    pub fn push(
        &mut self,
        frame: AudioFrame,
    ) -> Result<Option<AudioFrame>, VirtualMicTransportError> {
        if frame.format != self.format {
            return Err(VirtualMicTransportError::FormatMismatch {
                expected: self.format,
                actual: frame.format,
            });
        }

        let dropped = self.queue.push(frame);
        self.stats.accepted_frames = self.stats.accepted_frames.saturating_add(1);
        if dropped.is_some() {
            self.stats.overflow_drops = self.stats.overflow_drops.saturating_add(1);
        }
        Ok(dropped)
    }

    pub fn pop_or_silence(
        &mut self,
        sequence: u64,
        captured_at_micros: u64,
    ) -> Result<VirtualMicRead, VirtualMicTransportError> {
        if let Some(frame) = self.queue.pop() {
            return Ok(VirtualMicRead {
                frame,
                source: VirtualMicFrameSource::Buffered,
            });
        }

        self.stats.underruns = self.stats.underruns.saturating_add(1);
        let frame = AudioFrame::new(
            sequence,
            captured_at_micros,
            self.format,
            vec![0.0; self.samples_per_frame],
        )
        .map_err(VirtualMicTransportError::Audio)?;

        Ok(VirtualMicRead {
            frame,
            source: VirtualMicFrameSource::SilenceFallback,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VirtualMicTransportError {
    Audio(AudioError),
    FormatMismatch {
        expected: AudioFormat,
        actual: AudioFormat,
    },
}

impl Display for VirtualMicTransportError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Audio(error) => write!(f, "virtual microphone transport audio error: {error}"),
            Self::FormatMismatch { expected, actual } => write!(
                f,
                "virtual microphone transport format mismatch: expected {expected:?}, got {actual:?}"
            ),
        }
    }
}

impl Error for VirtualMicTransportError {}

#[cfg(test)]
mod tests {
    use super::*;

    const FORMAT: AudioFormat = AudioFormat {
        sample_rate_hz: 48_000,
        channels: 1,
        frame_duration_ms: 10,
    };

    fn frame(sequence: u64, value: f32) -> AudioFrame {
        AudioFrame::new(
            sequence,
            sequence * 10_000,
            FORMAT,
            vec![value; FORMAT.samples_per_frame().expect("valid test format")],
        )
        .expect("valid test frame")
    }

    #[test]
    fn rejects_zero_capacity() {
        assert!(matches!(
            VirtualMicStagingBuffer::new(FORMAT, 0),
            Err(VirtualMicTransportError::Audio(
                AudioError::QueueCapacityZero
            ))
        ));
    }

    #[test]
    fn rejects_format_mismatch_without_consuming_capacity() {
        let mut transport = VirtualMicStagingBuffer::new(FORMAT, 2).expect("transport");
        let stereo = AudioFormat {
            channels: 2,
            ..FORMAT
        };
        let mismatched = AudioFrame::new(
            1,
            10_000,
            stereo,
            vec![0.0; stereo.samples_per_frame().expect("valid stereo format")],
        )
        .expect("valid stereo frame");

        assert!(matches!(
            transport.push(mismatched),
            Err(VirtualMicTransportError::FormatMismatch { .. })
        ));
        assert!(transport.is_empty());
        assert_eq!(transport.stats(), VirtualMicTransportStats::default());
    }

    #[test]
    fn overflow_drops_oldest_frame_to_keep_latency_bounded() {
        let mut transport = VirtualMicStagingBuffer::new(FORMAT, 2).expect("transport");
        assert!(transport.push(frame(1, 0.1)).expect("push").is_none());
        assert!(transport.push(frame(2, 0.2)).expect("push").is_none());

        let dropped = transport
            .push(frame(3, 0.3))
            .expect("push")
            .expect("oldest frame should drop");
        assert_eq!(dropped.sequence, 1);
        assert_eq!(transport.len(), 2);
        assert_eq!(transport.stats().accepted_frames, 3);
        assert_eq!(transport.stats().overflow_drops, 1);

        let first = transport.pop_or_silence(10, 100_000).expect("read");
        let second = transport.pop_or_silence(11, 110_000).expect("read");
        assert_eq!(first.source, VirtualMicFrameSource::Buffered);
        assert_eq!(second.source, VirtualMicFrameSource::Buffered);
        assert_eq!(first.frame.sequence, 2);
        assert_eq!(second.frame.sequence, 3);
    }

    #[test]
    fn underrun_returns_fresh_silence_instead_of_replaying_stale_audio() {
        let mut transport = VirtualMicStagingBuffer::new(FORMAT, 2).expect("transport");

        let read = transport.pop_or_silence(42, 420_000).expect("read");

        assert_eq!(read.source, VirtualMicFrameSource::SilenceFallback);
        assert_eq!(read.frame.sequence, 42);
        assert_eq!(read.frame.captured_at_micros, 420_000);
        assert_eq!(read.frame.format, FORMAT);
        assert!(read.frame.samples.iter().all(|sample| *sample == 0.0));
        assert_eq!(transport.stats().underruns, 1);
    }
}
