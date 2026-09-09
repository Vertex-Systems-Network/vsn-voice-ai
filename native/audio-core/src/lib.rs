pub mod device;
pub mod device_control;

use std::collections::VecDeque;
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub frame_duration_ms: u16,
}

impl AudioFormat {
    pub fn samples_per_frame(self) -> Result<usize, AudioError> {
        if self.sample_rate_hz == 0 {
            return Err(AudioError::InvalidFormat(
                "sample rate must be greater than zero",
            ));
        }
        if self.channels == 0 {
            return Err(AudioError::InvalidFormat(
                "channel count must be greater than zero",
            ));
        }
        if self.frame_duration_ms == 0 || self.frame_duration_ms > 100 {
            return Err(AudioError::InvalidFormat(
                "frame duration must be between 1 and 100 milliseconds",
            ));
        }

        let samples_per_channel = u64::from(self.sample_rate_hz)
            .checked_mul(u64::from(self.frame_duration_ms))
            .ok_or(AudioError::InvalidFormat("frame size overflow"))?;
        if samples_per_channel % 1_000 != 0 {
            return Err(AudioError::InvalidFormat(
                "sample rate and frame duration must produce an integral frame size",
            ));
        }

        let total = (samples_per_channel / 1_000)
            .checked_mul(u64::from(self.channels))
            .ok_or(AudioError::InvalidFormat("frame size overflow"))?;
        usize::try_from(total).map_err(|_| AudioError::InvalidFormat("frame size overflow"))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioFrame {
    pub sequence: u64,
    pub captured_at_micros: u64,
    pub format: AudioFormat,
    pub samples: Vec<f32>,
}

impl AudioFrame {
    pub fn new(
        sequence: u64,
        captured_at_micros: u64,
        format: AudioFormat,
        samples: Vec<f32>,
    ) -> Result<Self, AudioError> {
        let expected = format.samples_per_frame()?;
        if samples.len() != expected {
            return Err(AudioError::InvalidSampleCount {
                expected,
                actual: samples.len(),
            });
        }
        if let Some((index, _)) = samples
            .iter()
            .enumerate()
            .find(|(_, sample)| !sample.is_finite())
        {
            return Err(AudioError::NonFiniteSample { index });
        }

        Ok(Self {
            sequence,
            captured_at_micros,
            format,
            samples,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AudioError {
    InvalidFormat(&'static str),
    InvalidSampleCount { expected: usize, actual: usize },
    NonFiniteSample { index: usize },
    QueueCapacityZero,
}

impl Display for AudioError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidFormat(message) => write!(f, "invalid audio format: {message}"),
            Self::InvalidSampleCount { expected, actual } => {
                write!(f, "invalid sample count: expected {expected}, got {actual}")
            }
            Self::NonFiniteSample { index } => write!(f, "non-finite sample at index {index}"),
            Self::QueueCapacityZero => write!(f, "audio queue capacity must be greater than zero"),
        }
    }
}

impl Error for AudioError {}

pub trait AudioStage: Send {
    fn name(&self) -> &'static str;

    fn process(&mut self, frame: &mut AudioFrame) -> Result<(), String>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessingState {
    Active,
    Degraded,
    Bypassed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PipelineResult {
    pub frame: AudioFrame,
    pub state: ProcessingState,
    pub stages_completed: usize,
    pub bypass_reason: Option<String>,
}

#[derive(Default)]
pub struct AudioPipeline {
    stages: Vec<Box<dyn AudioStage>>,
}

impl AudioPipeline {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_stage<T>(&mut self, stage: T)
    where
        T: AudioStage + 'static,
    {
        self.stages.push(Box::new(stage));
    }

    pub fn process(&mut self, mut frame: AudioFrame) -> PipelineResult {
        let original = frame.clone();

        for (index, stage) in self.stages.iter_mut().enumerate() {
            if let Err(message) = stage.process(&mut frame) {
                return PipelineResult {
                    frame: original,
                    state: ProcessingState::Bypassed,
                    stages_completed: index,
                    bypass_reason: Some(format!("{}: {message}", stage.name())),
                };
            }
        }

        PipelineResult {
            frame,
            state: ProcessingState::Active,
            stages_completed: self.stages.len(),
            bypass_reason: None,
        }
    }
}

#[derive(Debug)]
pub struct BoundedFrameQueue {
    capacity: usize,
    frames: VecDeque<AudioFrame>,
}

impl BoundedFrameQueue {
    pub fn new(capacity: usize) -> Result<Self, AudioError> {
        if capacity == 0 {
            return Err(AudioError::QueueCapacityZero);
        }
        Ok(Self {
            capacity,
            frames: VecDeque::with_capacity(capacity),
        })
    }

    pub fn push(&mut self, frame: AudioFrame) -> Option<AudioFrame> {
        let dropped = if self.frames.len() == self.capacity {
            self.frames.pop_front()
        } else {
            None
        };
        self.frames.push_back(frame);
        dropped
    }

    pub fn pop(&mut self) -> Option<AudioFrame> {
        self.frames.pop_front()
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

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

    struct GainStage(f32);

    impl AudioStage for GainStage {
        fn name(&self) -> &'static str {
            "gain"
        }

        fn process(&mut self, frame: &mut AudioFrame) -> Result<(), String> {
            for sample in &mut frame.samples {
                *sample *= self.0;
            }
            Ok(())
        }
    }

    struct FailingStage;

    impl AudioStage for FailingStage {
        fn name(&self) -> &'static str {
            "failing-stage"
        }

        fn process(&mut self, _frame: &mut AudioFrame) -> Result<(), String> {
            Err("provider timeout".to_string())
        }
    }

    #[test]
    fn computes_integral_frame_size() {
        assert_eq!(FORMAT.samples_per_frame(), Ok(480));
    }

    #[test]
    fn rejects_invalid_sample_count() {
        let error = AudioFrame::new(1, 0, FORMAT, vec![0.0; 479]).expect_err("must fail");
        assert_eq!(
            error,
            AudioError::InvalidSampleCount {
                expected: 480,
                actual: 479
            }
        );
    }

    #[test]
    fn rejects_non_finite_audio() {
        let mut samples = vec![0.0; 480];
        samples[12] = f32::NAN;
        let error = AudioFrame::new(1, 0, FORMAT, samples).expect_err("must fail");
        assert_eq!(error, AudioError::NonFiniteSample { index: 12 });
    }

    #[test]
    fn successful_pipeline_returns_processed_audio() {
        let mut pipeline = AudioPipeline::new();
        pipeline.push_stage(GainStage(0.5));

        let result = pipeline.process(frame(1, 1.0));

        assert_eq!(result.state, ProcessingState::Active);
        assert_eq!(result.stages_completed, 1);
        assert_eq!(result.bypass_reason, None);
        assert!(result.frame.samples.iter().all(|sample| *sample == 0.5));
    }

    #[test]
    fn failed_stage_returns_original_audio_for_safe_bypass() {
        let original = frame(7, 0.25);
        let mut pipeline = AudioPipeline::new();
        pipeline.push_stage(GainStage(0.5));
        pipeline.push_stage(FailingStage);

        let result = pipeline.process(original.clone());

        assert_eq!(result.state, ProcessingState::Bypassed);
        assert_eq!(result.stages_completed, 1);
        assert_eq!(result.frame, original);
        assert_eq!(
            result.bypass_reason.as_deref(),
            Some("failing-stage: provider timeout")
        );
    }

    #[test]
    fn bounded_queue_drops_oldest_frame_instead_of_growing() {
        let mut queue = BoundedFrameQueue::new(2).expect("valid queue");
        assert!(queue.push(frame(1, 0.0)).is_none());
        assert!(queue.push(frame(2, 0.0)).is_none());

        let dropped = queue.push(frame(3, 0.0)).expect("oldest frame dropped");

        assert_eq!(dropped.sequence, 1);
        assert_eq!(queue.len(), 2);
        assert_eq!(queue.pop().expect("frame 2").sequence, 2);
        assert_eq!(queue.pop().expect("frame 3").sequence, 3);
        assert!(queue.is_empty());
    }
}
