use std::time::Instant;

use crate::{AudioFrame, AudioPipeline, PipelineResult, ProcessingState};

pub const PIPELINE_PROCESSING_MEASUREMENT_SCHEMA_VERSION: u32 = 1;

/// Monotonic clock boundary used to measure one synchronous pipeline call.
/// Implementations must not expose wall-clock timestamps, host identity, audio,
/// transcript content, provider credentials, or request metadata.
pub trait PipelineMeasurementClock {
    fn now_micros(&self) -> u64;
}

/// Process-local monotonic clock. Its origin is intentionally private and has no
/// relationship to UTC or system time, so measurements cannot encode a wall
/// clock timestamp.
#[derive(Debug)]
pub struct SystemPipelineMeasurementClock {
    origin: Instant,
}

impl Default for SystemPipelineMeasurementClock {
    fn default() -> Self {
        Self {
            origin: Instant::now(),
        }
    }
}

impl PipelineMeasurementClock for SystemPipelineMeasurementClock {
    fn now_micros(&self) -> u64 {
        u64::try_from(self.origin.elapsed().as_micros()).unwrap_or(u64::MAX)
    }
}

/// Closed, content-safe telemetry for a single AudioPipeline::process call.
///
/// `processing_elapsed_micros` measures entry-to-return time for the local
/// synchronous pipeline call only. It is not, by itself, evidence that the
/// NFR-AUD-002 <=250 ms safe-bypass target was met on controlled hardware.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PipelineProcessingMeasurement {
    pub schema_version: u32,
    pub frame_sequence: u64,
    pub state: ProcessingState,
    pub stages_completed: u32,
    pub processing_elapsed_micros: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MeasuredPipelineResult {
    pub result: PipelineResult,
    pub measurement: PipelineProcessingMeasurement,
}

/// Runs one pipeline call and emits a detached content-safe measurement beside
/// the normal result. Stage error strings remain only on PipelineResult and are
/// deliberately not copied into the telemetry surface.
pub fn process_with_measurement<C: PipelineMeasurementClock>(
    pipeline: &mut AudioPipeline,
    frame: AudioFrame,
    clock: &C,
) -> MeasuredPipelineResult {
    let start_micros = clock.now_micros();
    let result = pipeline.process(frame);
    let end_micros = clock.now_micros();

    let stages_completed = u32::try_from(result.stages_completed).unwrap_or(u32::MAX);
    let measurement = PipelineProcessingMeasurement {
        schema_version: PIPELINE_PROCESSING_MEASUREMENT_SCHEMA_VERSION,
        frame_sequence: result.frame.sequence,
        state: result.state,
        stages_completed,
        processing_elapsed_micros: end_micros.saturating_sub(start_micros),
    };

    MeasuredPipelineResult {
        result,
        measurement,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;
    use crate::{AudioError, AudioFormat, AudioStage};

    const FORMAT: AudioFormat = AudioFormat {
        sample_rate_hz: 48_000,
        channels: 1,
        frame_duration_ms: 10,
    };

    struct SequenceClock {
        values: [u64; 2],
        index: Cell<usize>,
    }

    impl SequenceClock {
        fn new(start: u64, end: u64) -> Self {
            Self {
                values: [start, end],
                index: Cell::new(0),
            }
        }
    }

    impl PipelineMeasurementClock for SequenceClock {
        fn now_micros(&self) -> u64 {
            let index = self.index.get().min(self.values.len() - 1);
            self.index.set(index.saturating_add(1));
            self.values[index]
        }
    }

    struct FailingStage;

    impl AudioStage for FailingStage {
        fn name(&self) -> &'static str {
            "failing-stage"
        }

        fn process(&mut self, _frame: &mut AudioFrame) -> Result<(), String> {
            Err("provider timeout with unsafe free-form detail".to_string())
        }
    }

    fn frame(sequence: u64) -> Result<AudioFrame, AudioError> {
        AudioFrame::new(
            sequence,
            sequence.saturating_mul(10_000),
            FORMAT,
            vec![0.25; FORMAT.samples_per_frame()?],
        )
    }

    #[test]
    fn measures_successful_pipeline_without_wall_clock_data() {
        let mut pipeline = AudioPipeline::new();
        let clock = SequenceClock::new(1_000, 1_275);

        let measured =
            process_with_measurement(&mut pipeline, frame(7).expect("valid frame"), &clock);

        assert_eq!(measured.result.state, ProcessingState::Active);
        assert_eq!(
            measured.measurement,
            PipelineProcessingMeasurement {
                schema_version: 1,
                frame_sequence: 7,
                state: ProcessingState::Active,
                stages_completed: 0,
                processing_elapsed_micros: 275,
            }
        );
    }

    #[test]
    fn bypass_measurement_does_not_copy_free_form_failure_reason() {
        let mut pipeline = AudioPipeline::new();
        pipeline.push_stage(FailingStage);
        let clock = SequenceClock::new(10_000, 10_090);

        let measured =
            process_with_measurement(&mut pipeline, frame(9).expect("valid frame"), &clock);

        assert_eq!(measured.result.state, ProcessingState::Bypassed);
        assert!(
            measured
                .result
                .bypass_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("unsafe free-form detail"))
        );
        assert_eq!(measured.measurement.state, ProcessingState::Bypassed);
        assert_eq!(measured.measurement.processing_elapsed_micros, 90);
        assert!(!format!("{:?}", measured.measurement).contains("unsafe free-form detail"));
    }

    #[test]
    fn non_monotonic_test_clock_fails_closed_to_zero_duration() {
        let mut pipeline = AudioPipeline::new();
        let clock = SequenceClock::new(500, 400);

        let measured =
            process_with_measurement(&mut pipeline, frame(11).expect("valid frame"), &clock);

        assert_eq!(measured.measurement.processing_elapsed_micros, 0);
    }
}
