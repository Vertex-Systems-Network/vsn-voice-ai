use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnginePeriodRange {
    pub default_frames: u32,
    pub fundamental_frames: u32,
    pub min_frames: u32,
    pub max_frames: u32,
}

impl EnginePeriodRange {
    pub fn new(
        default_frames: u32,
        fundamental_frames: u32,
        min_frames: u32,
        max_frames: u32,
    ) -> Result<Self, EnginePeriodError> {
        if fundamental_frames == 0 {
            return Err(EnginePeriodError::ZeroFundamental);
        }
        if min_frames == 0 {
            return Err(EnginePeriodError::ZeroMinimum);
        }
        if min_frames > max_frames {
            return Err(EnginePeriodError::MinimumExceedsMaximum);
        }

        let range = Self {
            default_frames,
            fundamental_frames,
            min_frames,
            max_frames,
        };

        if !range.is_supported(default_frames) {
            return Err(EnginePeriodError::InvalidDefault);
        }
        if !min_frames.is_multiple_of(fundamental_frames)
            || !max_frames.is_multiple_of(fundamental_frames)
        {
            return Err(EnginePeriodError::RangeNotAlignedToFundamental);
        }

        Ok(range)
    }

    pub fn is_supported(self, frames: u32) -> bool {
        frames >= self.min_frames
            && frames <= self.max_frames
            && frames.is_multiple_of(self.fundamental_frames)
    }

    pub fn nearest_supported(self, target_frames: u32) -> u32 {
        let target = target_frames.clamp(self.min_frames, self.max_frames);
        let fundamental = self.fundamental_frames;

        let lower = (target / fundamental) * fundamental;
        let upper = lower.saturating_add(fundamental);

        let lower = if self.is_supported(lower) {
            Some(lower)
        } else {
            None
        };
        let upper = if self.is_supported(upper) {
            Some(upper)
        } else {
            None
        };

        match (lower, upper) {
            (Some(lower), Some(upper)) => {
                let lower_distance = target - lower;
                let upper_distance = upper - target;
                if lower_distance <= upper_distance {
                    lower
                } else {
                    upper
                }
            }
            (Some(lower), None) => lower,
            (None, Some(upper)) => upper,
            (None, None) => self.default_frames,
        }
    }
}

pub fn frames_for_duration(
    sample_rate_hz: u32,
    duration_ms: u16,
) -> Result<u32, EnginePeriodError> {
    if sample_rate_hz == 0 {
        return Err(EnginePeriodError::ZeroSampleRate);
    }
    if duration_ms == 0 {
        return Err(EnginePeriodError::ZeroDuration);
    }

    let product = u64::from(sample_rate_hz)
        .checked_mul(u64::from(duration_ms))
        .ok_or(EnginePeriodError::FrameCountOverflow)?;
    if !product.is_multiple_of(1_000) {
        return Err(EnginePeriodError::NonIntegralFrameCount);
    }

    u32::try_from(product / 1_000).map_err(|_| EnginePeriodError::FrameCountOverflow)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnginePeriodError {
    ZeroFundamental,
    ZeroMinimum,
    MinimumExceedsMaximum,
    InvalidDefault,
    RangeNotAlignedToFundamental,
    ZeroSampleRate,
    ZeroDuration,
    NonIntegralFrameCount,
    FrameCountOverflow,
}

impl Display for EnginePeriodError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::ZeroFundamental => "fundamental engine period must be greater than zero",
            Self::ZeroMinimum => "minimum engine period must be greater than zero",
            Self::MinimumExceedsMaximum => "minimum engine period exceeds maximum",
            Self::InvalidDefault => "default engine period is outside the supported period grid",
            Self::RangeNotAlignedToFundamental => {
                "engine period range is not aligned to the fundamental period"
            }
            Self::ZeroSampleRate => "sample rate must be greater than zero",
            Self::ZeroDuration => "target duration must be greater than zero",
            Self::NonIntegralFrameCount => {
                "sample rate and duration do not produce an integral audio-frame count"
            }
            Self::FrameCountOverflow => "target audio-frame count overflowed",
        };
        f.write_str(message)
    }
}

impl Error for EnginePeriodError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_documented_style_period_grid() {
        let range = EnginePeriodRange::new(448, 4, 48, 448).expect("valid range");
        assert!(range.is_supported(48));
        assert!(range.is_supported(96));
        assert!(range.is_supported(128));
        assert!(range.is_supported(448));
        assert!(!range.is_supported(98));
        assert!(!range.is_supported(4));
        assert!(!range.is_supported(1_000));
    }

    #[test]
    fn chooses_nearest_supported_period_and_prefers_lower_on_tie() {
        let range = EnginePeriodRange::new(480, 48, 48, 480).expect("valid range");

        assert_eq!(range.nearest_supported(480), 480);
        assert_eq!(range.nearest_supported(450), 432);
        assert_eq!(range.nearest_supported(456), 432);
        assert_eq!(range.nearest_supported(457), 480);
    }

    #[test]
    fn clamps_targets_to_supported_range() {
        let range = EnginePeriodRange::new(480, 48, 48, 480).expect("valid range");
        assert_eq!(range.nearest_supported(1), 48);
        assert_eq!(range.nearest_supported(900), 480);
    }

    #[test]
    fn rejects_invalid_engine_period_ranges() {
        assert_eq!(
            EnginePeriodRange::new(480, 0, 48, 480),
            Err(EnginePeriodError::ZeroFundamental)
        );
        assert_eq!(
            EnginePeriodRange::new(480, 48, 0, 480),
            Err(EnginePeriodError::ZeroMinimum)
        );
        assert_eq!(
            EnginePeriodRange::new(480, 48, 480, 48),
            Err(EnginePeriodError::MinimumExceedsMaximum)
        );
        assert_eq!(
            EnginePeriodRange::new(100, 48, 48, 480),
            Err(EnginePeriodError::InvalidDefault)
        );
        assert_eq!(
            EnginePeriodRange::new(480, 48, 50, 480),
            Err(EnginePeriodError::RangeNotAlignedToFundamental)
        );
    }

    #[test]
    fn converts_ten_milliseconds_at_48khz_to_480_audio_frames() {
        assert_eq!(frames_for_duration(48_000, 10), Ok(480));
    }

    #[test]
    fn rejects_non_integral_target_frame_counts() {
        assert_eq!(
            frames_for_duration(44_100, 1),
            Err(EnginePeriodError::NonIntegralFrameCount)
        );
    }
}
