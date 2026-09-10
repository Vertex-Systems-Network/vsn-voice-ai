use vsn_audio_core::{AudioFormat, AudioFrame, AudioPipeline, ProcessingState};

use crate::virtual_mic_transport::{VirtualMicStagingBuffer, VirtualMicTransportError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VirtualMicSubmission {
    pub processing_state: ProcessingState,
    pub stages_completed: usize,
    pub bypass_reason: Option<String>,
    pub dropped_sequence: Option<u64>,
}

pub struct VirtualMicOutputBridge {
    transport: VirtualMicStagingBuffer,
}

impl VirtualMicOutputBridge {
    pub fn new(format: AudioFormat, capacity: usize) -> Result<Self, VirtualMicTransportError> {
        Ok(Self {
            transport: VirtualMicStagingBuffer::new(format, capacity)?,
        })
    }

    pub fn transport(&self) -> &VirtualMicStagingBuffer {
        &self.transport
    }

    pub fn transport_mut(&mut self) -> &mut VirtualMicStagingBuffer {
        &mut self.transport
    }

    pub fn process_and_stage(
        &mut self,
        pipeline: &mut AudioPipeline,
        frame: AudioFrame,
    ) -> Result<VirtualMicSubmission, VirtualMicTransportError> {
        let result = pipeline.process(frame);
        let processing_state = result.state;
        let stages_completed = result.stages_completed;
        let bypass_reason = result.bypass_reason;
        let dropped_sequence = self
            .transport
            .push(result.frame)?
            .map(|frame| frame.sequence);

        Ok(VirtualMicSubmission {
            processing_state,
            stages_completed,
            bypass_reason,
            dropped_sequence,
        })
    }
}

#[cfg(test)]
mod tests {
    use vsn_audio_core::{AudioError, AudioStage};

    use super::*;
    use crate::virtual_mic_transport::VirtualMicFrameSource;

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
            "provider"
        }

        fn process(&mut self, _frame: &mut AudioFrame) -> Result<(), String> {
            Err("provider unavailable".into())
        }
    }

    #[test]
    fn processed_frame_is_staged_for_virtual_microphone_output() {
        let mut pipeline = AudioPipeline::new();
        pipeline.push_stage(GainStage(2.0));
        let mut output = VirtualMicOutputBridge::new(FORMAT, 4).expect("output bridge");

        let submission = output
            .process_and_stage(&mut pipeline, frame(1, 0.25))
            .expect("stage output");
        let read = output
            .transport_mut()
            .pop_or_silence(2, 20_000)
            .expect("read staged frame");

        assert_eq!(submission.processing_state, ProcessingState::Active);
        assert_eq!(submission.stages_completed, 1);
        assert!(submission.bypass_reason.is_none());
        assert!(submission.dropped_sequence.is_none());
        assert_eq!(read.source, VirtualMicFrameSource::Buffered);
        assert_eq!(read.frame.sequence, 1);
        assert!(read.frame.samples.iter().all(|sample| *sample == 0.5));
    }

    #[test]
    fn processing_failure_stages_original_frame_through_same_output_path() {
        let original = frame(7, 0.25);
        let mut pipeline = AudioPipeline::new();
        pipeline.push_stage(FailingStage);
        let mut output = VirtualMicOutputBridge::new(FORMAT, 4).expect("output bridge");

        let submission = output
            .process_and_stage(&mut pipeline, original.clone())
            .expect("bypass output");
        let read = output
            .transport_mut()
            .pop_or_silence(8, 80_000)
            .expect("read bypass frame");

        assert_eq!(submission.processing_state, ProcessingState::Bypassed);
        assert_eq!(submission.stages_completed, 0);
        assert_eq!(
            submission.bypass_reason.as_deref(),
            Some("provider: provider unavailable")
        );
        assert!(submission.dropped_sequence.is_none());
        assert_eq!(read.source, VirtualMicFrameSource::Buffered);
        assert_eq!(read.frame, original);
    }

    #[test]
    fn output_bridge_preserves_transport_validation() {
        let invalid = AudioFormat {
            frame_duration_ms: 0,
            ..FORMAT
        };

        assert!(matches!(
            VirtualMicOutputBridge::new(invalid, 4),
            Err(VirtualMicTransportError::Audio(AudioError::InvalidFormat(
                _
            )))
        ));
    }
}
