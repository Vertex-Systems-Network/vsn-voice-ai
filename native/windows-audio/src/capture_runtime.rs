use std::error::Error;
use std::fmt::{Display, Formatter};

use vsn_audio_core::stream_control::{
    RecoveryPolicy, StreamAction, StreamController, StreamEvent, StreamFault, StreamState,
    StreamTransition,
};

use crate::capture_pump::{
    CaptureDrain, CapturePump, CapturePumpError, DEFAULT_MAX_PACKETS_PER_DRAIN,
};
use crate::wasapi_capture::{EventCaptureSession, WasapiCaptureError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureRuntimeConfig {
    pub frame_duration_ms: u16,
    pub max_packets_per_drain: usize,
}

impl CaptureRuntimeConfig {
    pub fn new(
        frame_duration_ms: u16,
        max_packets_per_drain: usize,
    ) -> Result<Self, CaptureRuntimeConfigError> {
        if frame_duration_ms == 0 || frame_duration_ms > 100 {
            return Err(CaptureRuntimeConfigError::InvalidFrameDuration);
        }
        if max_packets_per_drain == 0 {
            return Err(CaptureRuntimeConfigError::PacketBudgetZero);
        }
        Ok(Self {
            frame_duration_ms,
            max_packets_per_drain,
        })
    }
}

impl Default for CaptureRuntimeConfig {
    fn default() -> Self {
        Self {
            frame_duration_ms: 10,
            max_packets_per_drain: DEFAULT_MAX_PACKETS_PER_DRAIN,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureRuntimeConfigError {
    InvalidFrameDuration,
    PacketBudgetZero,
}

impl Display for CaptureRuntimeConfigError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidFrameDuration => {
                f.write_str("capture runtime frame duration must be between 1 and 100 milliseconds")
            }
            Self::PacketBudgetZero => {
                f.write_str("capture runtime packet budget must be greater than zero")
            }
        }
    }
}

impl Error for CaptureRuntimeConfigError {}

pub trait CaptureRuntimePump {
    fn start(&mut self) -> Result<(), CapturePumpError>;

    fn stop(&mut self) -> Result<(), CapturePumpError>;

    fn wait_and_drain(&mut self, timeout_ms: u32) -> Result<CaptureDrain, CapturePumpError>;

    fn next_sequence(&self) -> u64;
}

impl CaptureRuntimePump for CapturePump<EventCaptureSession> {
    fn start(&mut self) -> Result<(), CapturePumpError> {
        CapturePump::start(self)
    }

    fn stop(&mut self) -> Result<(), CapturePumpError> {
        CapturePump::stop(self)
    }

    fn wait_and_drain(&mut self, timeout_ms: u32) -> Result<CaptureDrain, CapturePumpError> {
        CapturePump::wait_and_drain(self, timeout_ms)
    }

    fn next_sequence(&self) -> u64 {
        CapturePump::next_sequence(self)
    }
}

pub trait CapturePumpOpener {
    type Pump: CaptureRuntimePump;

    fn open(
        &mut self,
        config: CaptureRuntimeConfig,
        initial_sequence: u64,
    ) -> Result<Option<Self::Pump>, CapturePumpError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct DefaultCapturePumpOpener;

impl CapturePumpOpener for DefaultCapturePumpOpener {
    type Pump = CapturePump<EventCaptureSession>;

    fn open(
        &mut self,
        config: CaptureRuntimeConfig,
        initial_sequence: u64,
    ) -> Result<Option<Self::Pump>, CapturePumpError> {
        CapturePump::<EventCaptureSession>::open_default(
            config.frame_duration_ms,
            initial_sequence,
            config.max_packets_per_drain,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureFailureDisposition {
    pub fault: StreamFault,
    pub retryable: bool,
}

pub fn classify_capture_error(error: &CapturePumpError) -> CaptureFailureDisposition {
    match error {
        CapturePumpError::Capture(WasapiCaptureError::DeviceInvalidated)
        | CapturePumpError::Capture(WasapiCaptureError::ResourcesInvalidated) => {
            CaptureFailureDisposition {
                fault: StreamFault::DeviceInvalidated,
                retryable: true,
            }
        }
        CapturePumpError::Capture(WasapiCaptureError::AudioServiceNotRunning) => {
            CaptureFailureDisposition {
                fault: StreamFault::DeviceUnavailable,
                retryable: true,
            }
        }
        _ => CaptureFailureDisposition {
            fault: StreamFault::Backend(error.to_string()),
            retryable: false,
        },
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CaptureRuntimeUpdate {
    pub transitions: Vec<StreamTransition>,
    pub drain: Option<CaptureDrain>,
    pub error: Option<CapturePumpError>,
}

impl CaptureRuntimeUpdate {
    fn new() -> Self {
        Self {
            transitions: Vec::new(),
            drain: None,
            error: None,
        }
    }
}

pub struct CaptureRuntime<O>
where
    O: CapturePumpOpener,
{
    config: CaptureRuntimeConfig,
    opener: O,
    controller: StreamController,
    pump: Option<O::Pump>,
    next_sequence: u64,
}

impl<O> CaptureRuntime<O>
where
    O: CapturePumpOpener,
{
    pub fn new(
        config: CaptureRuntimeConfig,
        recovery_policy: RecoveryPolicy,
        opener: O,
        initial_sequence: u64,
    ) -> Self {
        Self {
            config,
            opener,
            controller: StreamController::new(recovery_policy),
            pump: None,
            next_sequence: initial_sequence,
        }
    }

    pub fn state(&self) -> StreamState {
        self.controller.state()
    }

    pub fn reopen_failures(&self) -> u8 {
        self.controller.reopen_failures()
    }

    pub fn next_sequence(&self) -> u64 {
        self.next_sequence
    }

    pub fn has_active_pump(&self) -> bool {
        self.pump.is_some()
    }

    pub fn opener(&self) -> &O {
        &self.opener
    }

    pub fn start(&mut self) -> CaptureRuntimeUpdate {
        let mut update = CaptureRuntimeUpdate::new();
        let transition = self.controller.apply(StreamEvent::StartRequested);
        let should_open = transition.action == StreamAction::OpenDevice;
        update.transitions.push(transition);
        if should_open {
            self.attempt_open(&mut update);
        }
        update
    }

    pub fn retry_timer_elapsed(&mut self) -> CaptureRuntimeUpdate {
        let mut update = CaptureRuntimeUpdate::new();
        let transition = self.controller.apply(StreamEvent::RetryTimerElapsed);
        let should_open = transition.action == StreamAction::OpenDevice;
        update.transitions.push(transition);
        if should_open {
            self.attempt_open(&mut update);
        }
        update
    }

    pub fn poll(
        &mut self,
        timeout_ms: u32,
    ) -> Result<CaptureRuntimeUpdate, CaptureRuntimeError> {
        if !matches!(self.state(), StreamState::Running | StreamState::Bypassed) {
            return Err(CaptureRuntimeError::NotRunning(self.state()));
        }

        let result = {
            let pump = self
                .pump
                .as_mut()
                .ok_or(CaptureRuntimeError::MissingActivePump)?;
            let result = pump.wait_and_drain(timeout_ms);
            self.next_sequence = pump.next_sequence();
            result
        };

        let mut update = CaptureRuntimeUpdate::new();
        match result {
            Ok(drain) => {
                update.drain = Some(drain);
            }
            Err(error) => {
                self.discard_pump();
                let disposition = classify_capture_error(&error);
                update.transitions.push(self.controller.apply(StreamEvent::StreamFailed {
                    fault: disposition.fault,
                    retryable: disposition.retryable,
                }));
                update.error = Some(error);
            }
        }
        Ok(update)
    }

    pub fn notify_device_invalidated(&mut self) -> CaptureRuntimeUpdate {
        self.discard_pump();
        let mut update = CaptureRuntimeUpdate::new();
        update
            .transitions
            .push(self.controller.apply(StreamEvent::DeviceInvalidated));
        update
    }

    pub fn stop(&mut self) -> CaptureRuntimeUpdate {
        let mut update = CaptureRuntimeUpdate::new();
        if let Some(pump) = self.pump.as_mut() {
            self.next_sequence = pump.next_sequence();
            if let Err(error) = pump.stop() {
                update.error = Some(error);
            }
        }
        self.pump = None;
        update
            .transitions
            .push(self.controller.apply(StreamEvent::StopRequested));
        update
    }

    fn attempt_open(&mut self, update: &mut CaptureRuntimeUpdate) {
        match self.opener.open(self.config, self.next_sequence) {
            Ok(Some(mut pump)) => match pump.start() {
                Ok(()) => {
                    self.pump = Some(pump);
                    update
                        .transitions
                        .push(self.controller.apply(StreamEvent::OpenSucceeded));
                }
                Err(error) => {
                    let disposition = classify_capture_error(&error);
                    update
                        .transitions
                        .push(self.controller.apply(StreamEvent::OpenFailed {
                            fault: disposition.fault,
                            retryable: disposition.retryable,
                        }));
                    update.error = Some(error);
                }
            },
            Ok(None) => {
                update
                    .transitions
                    .push(self.controller.apply(StreamEvent::OpenFailed {
                        fault: StreamFault::DeviceUnavailable,
                        retryable: true,
                    }));
            }
            Err(error) => {
                let disposition = classify_capture_error(&error);
                update
                    .transitions
                    .push(self.controller.apply(StreamEvent::OpenFailed {
                        fault: disposition.fault,
                        retryable: disposition.retryable,
                    }));
                update.error = Some(error);
            }
        }
    }

    fn discard_pump(&mut self) {
        if let Some(pump) = self.pump.as_mut() {
            self.next_sequence = pump.next_sequence();
            let _ = pump.stop();
        }
        self.pump = None;
    }
}

impl CaptureRuntime<DefaultCapturePumpOpener> {
    pub fn open_default(
        config: CaptureRuntimeConfig,
        recovery_policy: RecoveryPolicy,
        initial_sequence: u64,
    ) -> Self {
        Self::new(
            config,
            recovery_policy,
            DefaultCapturePumpOpener,
            initial_sequence,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureRuntimeError {
    NotRunning(StreamState),
    MissingActivePump,
}

impl Display for CaptureRuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotRunning(state) => write!(f, "capture runtime cannot poll while in {state:?} state"),
            Self::MissingActivePump => {
                f.write_str("capture runtime is running without an active capture pump")
            }
        }
    }
}

impl Error for CaptureRuntimeError {}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;

    struct FakePoll {
        next_sequence: u64,
        result: Result<CaptureDrain, CapturePumpError>,
    }

    struct FakePump {
        start_error: Option<CapturePumpError>,
        stop_error: Option<CapturePumpError>,
        polls: VecDeque<FakePoll>,
        next_sequence: u64,
    }

    impl FakePump {
        fn healthy(next_sequence: u64) -> Self {
            Self {
                start_error: None,
                stop_error: None,
                polls: VecDeque::new(),
                next_sequence,
            }
        }

        fn with_poll(mut self, poll: FakePoll) -> Self {
            self.polls.push_back(poll);
            self
        }
    }

    impl CaptureRuntimePump for FakePump {
        fn start(&mut self) -> Result<(), CapturePumpError> {
            self.start_error.clone().map_or(Ok(()), Err)
        }

        fn stop(&mut self) -> Result<(), CapturePumpError> {
            self.stop_error.clone().map_or(Ok(()), Err)
        }

        fn wait_and_drain(&mut self, _timeout_ms: u32) -> Result<CaptureDrain, CapturePumpError> {
            let poll = self.polls.pop_front().unwrap_or(FakePoll {
                next_sequence: self.next_sequence,
                result: Ok(empty_drain()),
            });
            self.next_sequence = poll.next_sequence;
            poll.result
        }

        fn next_sequence(&self) -> u64 {
            self.next_sequence
        }
    }

    struct FakeOpener {
        results: VecDeque<Result<Option<FakePump>, CapturePumpError>>,
        requested_sequences: Vec<u64>,
    }

    impl FakeOpener {
        fn new(results: Vec<Result<Option<FakePump>, CapturePumpError>>) -> Self {
            Self {
                results: results.into(),
                requested_sequences: Vec::new(),
            }
        }
    }

    impl CapturePumpOpener for FakeOpener {
        type Pump = FakePump;

        fn open(
            &mut self,
            _config: CaptureRuntimeConfig,
            initial_sequence: u64,
        ) -> Result<Option<Self::Pump>, CapturePumpError> {
            self.requested_sequences.push(initial_sequence);
            self.results.pop_front().unwrap_or(Ok(None))
        }
    }

    fn policy() -> RecoveryPolicy {
        RecoveryPolicy::new(3, 25, 100).expect("valid recovery policy")
    }

    fn config() -> CaptureRuntimeConfig {
        CaptureRuntimeConfig::new(10, 8).expect("valid runtime config")
    }

    fn empty_drain() -> CaptureDrain {
        CaptureDrain {
            event_signaled: true,
            packets_consumed: 0,
            frames: Vec::new(),
            queue_drained: true,
            hit_packet_budget: false,
        }
    }

    #[test]
    fn config_rejects_invalid_frame_duration_and_packet_budget() {
        assert_eq!(
            CaptureRuntimeConfig::new(0, 8),
            Err(CaptureRuntimeConfigError::InvalidFrameDuration)
        );
        assert_eq!(
            CaptureRuntimeConfig::new(101, 8),
            Err(CaptureRuntimeConfigError::InvalidFrameDuration)
        );
        assert_eq!(
            CaptureRuntimeConfig::new(10, 0),
            Err(CaptureRuntimeConfigError::PacketBudgetZero)
        );
    }

    #[test]
    fn classifies_documented_lifecycle_failures_as_retryable() {
        assert_eq!(
            classify_capture_error(&CapturePumpError::Capture(
                WasapiCaptureError::DeviceInvalidated
            )),
            CaptureFailureDisposition {
                fault: StreamFault::DeviceInvalidated,
                retryable: true
            }
        );
        assert_eq!(
            classify_capture_error(&CapturePumpError::Capture(
                WasapiCaptureError::ResourcesInvalidated
            )),
            CaptureFailureDisposition {
                fault: StreamFault::DeviceInvalidated,
                retryable: true
            }
        );
        assert_eq!(
            classify_capture_error(&CapturePumpError::Capture(
                WasapiCaptureError::AudioServiceNotRunning
            )),
            CaptureFailureDisposition {
                fault: StreamFault::DeviceUnavailable,
                retryable: true
            }
        );
        assert!(!classify_capture_error(&CapturePumpError::PacketBudgetZero).retryable);
    }

    #[test]
    fn start_opens_starts_and_enters_running_state() {
        let opener = FakeOpener::new(vec![Ok(Some(FakePump::healthy(7)))]);
        let mut runtime = CaptureRuntime::new(config(), policy(), opener, 7);

        let update = runtime.start();

        assert_eq!(runtime.state(), StreamState::Running);
        assert!(runtime.has_active_pump());
        assert_eq!(runtime.opener().requested_sequences, vec![7]);
        assert_eq!(update.transitions.len(), 2);
        assert_eq!(update.transitions[0].action, StreamAction::OpenDevice);
        assert_eq!(update.transitions[1].current, StreamState::Running);
    }

    #[test]
    fn unavailable_device_retries_with_bounded_backoff_then_fails() {
        let opener = FakeOpener::new(vec![Ok(None), Ok(None), Ok(None)]);
        let mut runtime = CaptureRuntime::new(config(), policy(), opener, 0);

        let first = runtime.start();
        assert_eq!(runtime.state(), StreamState::Recovering);
        assert_eq!(
            first.transitions.last().expect("open failure").action,
            StreamAction::ScheduleRetry { delay_ms: 25 }
        );

        let second = runtime.retry_timer_elapsed();
        assert_eq!(runtime.state(), StreamState::Recovering);
        assert_eq!(
            second.transitions.last().expect("second failure").action,
            StreamAction::ScheduleRetry { delay_ms: 50 }
        );

        let third = runtime.retry_timer_elapsed();
        assert_eq!(runtime.state(), StreamState::Failed);
        assert_eq!(runtime.reopen_failures(), 3);
        assert_eq!(
            third.transitions.last().expect("terminal failure").action,
            StreamAction::SurfaceFailure {
                fault: StreamFault::DeviceUnavailable
            }
        );
    }

    #[test]
    fn runtime_invalidation_schedules_reopen_and_preserves_sequence() {
        let invalidated = CapturePumpError::Capture(WasapiCaptureError::DeviceInvalidated);
        let first_pump = FakePump::healthy(10).with_poll(FakePoll {
            next_sequence: 14,
            result: Err(invalidated.clone()),
        });
        let second_pump = FakePump::healthy(14);
        let opener = FakeOpener::new(vec![Ok(Some(first_pump)), Ok(Some(second_pump))]);
        let mut runtime = CaptureRuntime::new(config(), policy(), opener, 10);
        runtime.start();

        let failed = runtime.poll(50).expect("runtime failure is state-managed");
        assert_eq!(failed.error, Some(invalidated));
        assert_eq!(runtime.state(), StreamState::Recovering);
        assert_eq!(runtime.next_sequence(), 14);
        assert!(!runtime.has_active_pump());
        assert_eq!(
            failed.transitions[0].action,
            StreamAction::ScheduleRetry { delay_ms: 25 }
        );

        let reopened = runtime.retry_timer_elapsed();
        assert_eq!(runtime.state(), StreamState::Running);
        assert!(runtime.has_active_pump());
        assert_eq!(runtime.opener().requested_sequences, vec![10, 14]);
        assert_eq!(reopened.transitions.last().expect("reopened").current, StreamState::Running);
    }

    #[test]
    fn non_retryable_runtime_failure_enters_failed_state() {
        let failure = CapturePumpError::PacketBudgetZero;
        let pump = FakePump::healthy(0).with_poll(FakePoll {
            next_sequence: 0,
            result: Err(failure.clone()),
        });
        let opener = FakeOpener::new(vec![Ok(Some(pump))]);
        let mut runtime = CaptureRuntime::new(config(), policy(), opener, 0);
        runtime.start();

        let update = runtime.poll(50).expect("failure is represented as runtime update");

        assert_eq!(update.error, Some(failure));
        assert_eq!(runtime.state(), StreamState::Failed);
        assert!(!runtime.has_active_pump());
        assert!(matches!(
            update.transitions[0].action,
            StreamAction::SurfaceFailure {
                fault: StreamFault::Backend(_)
            }
        ));
    }

    #[test]
    fn successful_poll_preserves_running_state_and_returns_drain() {
        let drain = empty_drain();
        let pump = FakePump::healthy(20).with_poll(FakePoll {
            next_sequence: 21,
            result: Ok(drain.clone()),
        });
        let opener = FakeOpener::new(vec![Ok(Some(pump))]);
        let mut runtime = CaptureRuntime::new(config(), policy(), opener, 20);
        runtime.start();

        let update = runtime.poll(50).expect("poll succeeds");

        assert_eq!(runtime.state(), StreamState::Running);
        assert_eq!(runtime.next_sequence(), 21);
        assert_eq!(update.drain, Some(drain));
        assert!(update.transitions.is_empty());
        assert!(update.error.is_none());
    }

    #[test]
    fn external_device_notification_uses_same_recovery_state_machine() {
        let opener = FakeOpener::new(vec![Ok(Some(FakePump::healthy(3)))]);
        let mut runtime = CaptureRuntime::new(config(), policy(), opener, 3);
        runtime.start();

        let update = runtime.notify_device_invalidated();

        assert_eq!(runtime.state(), StreamState::Recovering);
        assert!(!runtime.has_active_pump());
        assert_eq!(
            update.transitions[0].action,
            StreamAction::ScheduleRetry { delay_ms: 25 }
        );
    }

    #[test]
    fn polling_outside_running_state_is_rejected() {
        let opener = FakeOpener::new(Vec::new());
        let mut runtime = CaptureRuntime::new(config(), policy(), opener, 0);

        assert_eq!(
            runtime.poll(0),
            Err(CaptureRuntimeError::NotRunning(StreamState::Stopped))
        );
    }
}
