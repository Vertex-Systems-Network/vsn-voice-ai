use std::error::Error;
use std::fmt::{Display, Formatter};

use vsn_audio_core::{AudioError, AudioFormat};

use crate::engine_period::{EnginePeriodError, EnginePeriodRange, frames_for_duration};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureCadence {
    Exact,
    Accumulate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SharedCapturePlan {
    pub format: AudioFormat,
    pub pipeline_frames_per_channel: u32,
    pub pipeline_samples: usize,
    pub engine_period_frames: u32,
    pub cadence: CaptureCadence,
}

impl SharedCapturePlan {
    pub fn new(
        format: AudioFormat,
        engine_periods: EnginePeriodRange,
    ) -> Result<Self, CapturePlanError> {
        let pipeline_samples = format.samples_per_frame()?;
        let pipeline_frames_per_channel =
            frames_for_duration(format.sample_rate_hz, format.frame_duration_ms)?;
        let engine_period_frames = engine_periods.nearest_supported(pipeline_frames_per_channel);
        let cadence = if engine_period_frames == pipeline_frames_per_channel {
            CaptureCadence::Exact
        } else {
            CaptureCadence::Accumulate
        };

        Ok(Self {
            format,
            pipeline_frames_per_channel,
            pipeline_samples,
            engine_period_frames,
            cadence,
        })
    }

    pub fn requires_accumulator(self) -> bool {
        self.cadence == CaptureCadence::Accumulate
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CapturePlanError {
    InvalidAudioFormat(AudioError),
    InvalidEnginePeriod(EnginePeriodError),
}

impl Display for CapturePlanError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidAudioFormat(error) => write!(f, "invalid capture audio format: {error}"),
            Self::InvalidEnginePeriod(error) => write!(f, "invalid capture engine period: {error}"),
        }
    }
}

impl Error for CapturePlanError {}

impl From<AudioError> for CapturePlanError {
    fn from(value: AudioError) -> Self {
        Self::InvalidAudioFormat(value)
    }
}

impl From<EnginePeriodError> for CapturePlanError {
    fn from(value: EnginePeriodError) -> Self {
        Self::InvalidEnginePeriod(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONO_48K_10MS: AudioFormat = AudioFormat {
        sample_rate_hz: 48_000,
        channels: 1,
        frame_duration_ms: 10,
    };

    #[test]
    fn plans_exact_ten_millisecond_capture_when_supported() {
        let periods = EnginePeriodRange::new(480, 48, 48, 480).expect("valid period grid");
        let plan = SharedCapturePlan::new(MONO_48K_10MS, periods).expect("valid capture plan");

        assert_eq!(plan.pipeline_frames_per_channel, 480);
        assert_eq!(plan.pipeline_samples, 480);
        assert_eq!(plan.engine_period_frames, 480);
        assert_eq!(plan.cadence, CaptureCadence::Exact);
        assert!(!plan.requires_accumulator());
    }

    #[test]
    fn identifies_when_wasapi_period_and_pipeline_frame_need_accumulation() {
        let periods = EnginePeriodRange::new(448, 4, 48, 448).expect("valid period grid");
        let plan = SharedCapturePlan::new(MONO_48K_10MS, periods).expect("valid capture plan");

        assert_eq!(plan.pipeline_frames_per_channel, 480);
        assert_eq!(plan.engine_period_frames, 448);
        assert_eq!(plan.cadence, CaptureCadence::Accumulate);
        assert!(plan.requires_accumulator());
    }

    #[test]
    fn distinguishes_audio_frames_from_interleaved_samples() {
        let stereo = AudioFormat {
            sample_rate_hz: 48_000,
            channels: 2,
            frame_duration_ms: 10,
        };
        let periods = EnginePeriodRange::new(480, 48, 48, 480).expect("valid period grid");
        let plan = SharedCapturePlan::new(stereo, periods).expect("valid capture plan");

        assert_eq!(plan.pipeline_frames_per_channel, 480);
        assert_eq!(plan.pipeline_samples, 960);
        assert_eq!(plan.engine_period_frames, 480);
    }

    #[test]
    fn rejects_audio_format_that_cannot_form_integral_pipeline_frames() {
        let format = AudioFormat {
            sample_rate_hz: 44_100,
            channels: 1,
            frame_duration_ms: 1,
        };
        let periods = EnginePeriodRange::new(441, 1, 1, 441).expect("valid period grid");

        assert!(matches!(
            SharedCapturePlan::new(format, periods),
            Err(CapturePlanError::InvalidAudioFormat(_))
                | Err(CapturePlanError::InvalidEnginePeriod(
                    EnginePeriodError::NonIntegralFrameCount
                ))
        ));
    }
}
