#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamState {
    Stopped,
    Opening,
    Running,
    Recovering,
    Bypassed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamFault {
    DeviceInvalidated,
    DeviceUnavailable,
    Backend(String),
    Processing(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecoveryPolicy {
    pub max_reopen_failures: u8,
    pub initial_backoff_ms: u64,
    pub max_backoff_ms: u64,
}

impl RecoveryPolicy {
    pub fn new(
        max_reopen_failures: u8,
        initial_backoff_ms: u64,
        max_backoff_ms: u64,
    ) -> Result<Self, RecoveryPolicyError> {
        if max_reopen_failures == 0 {
            return Err(RecoveryPolicyError::ZeroAttempts);
        }
        if initial_backoff_ms == 0 {
            return Err(RecoveryPolicyError::ZeroInitialBackoff);
        }
        if max_backoff_ms < initial_backoff_ms {
            return Err(RecoveryPolicyError::MaxBackoffBelowInitial);
        }
        Ok(Self {
            max_reopen_failures,
            initial_backoff_ms,
            max_backoff_ms,
        })
    }

    fn delay_for_failure(self, failure_count: u8) -> u64 {
        let shift = u32::from(failure_count.saturating_sub(1)).min(20);
        self.initial_backoff_ms
            .saturating_mul(1_u64 << shift)
            .min(self.max_backoff_ms)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryPolicyError {
    ZeroAttempts,
    ZeroInitialBackoff,
    MaxBackoffBelowInitial,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEvent {
    StartRequested,
    OpenSucceeded,
    OpenFailed {
        fault: StreamFault,
        retryable: bool,
    },
    DeviceInvalidated,
    RetryTimerElapsed,
    ProcessingFailed(String),
    ProcessingRecovered,
    StopRequested,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamAction {
    None,
    OpenDevice,
    StopDevice,
    EnterBypass,
    ExitBypass,
    ScheduleRetry { delay_ms: u64 },
    SurfaceFailure { fault: StreamFault },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamTransition {
    pub previous: StreamState,
    pub current: StreamState,
    pub action: StreamAction,
    pub reopen_failures: u8,
}

#[derive(Debug, Clone)]
pub struct StreamController {
    state: StreamState,
    policy: RecoveryPolicy,
    reopen_failures: u8,
}

impl StreamController {
    pub fn new(policy: RecoveryPolicy) -> Self {
        Self {
            state: StreamState::Stopped,
            policy,
            reopen_failures: 0,
        }
    }

    pub fn state(&self) -> StreamState {
        self.state
    }

    pub fn reopen_failures(&self) -> u8 {
        self.reopen_failures
    }

    pub fn apply(&mut self, event: StreamEvent) -> StreamTransition {
        let previous = self.state;
        let action = match event {
            StreamEvent::StartRequested if self.state == StreamState::Stopped => {
                self.reopen_failures = 0;
                self.state = StreamState::Opening;
                StreamAction::OpenDevice
            }
            StreamEvent::OpenSucceeded if self.state == StreamState::Opening => {
                self.reopen_failures = 0;
                self.state = StreamState::Running;
                StreamAction::None
            }
            StreamEvent::OpenFailed { fault, retryable }
                if self.state == StreamState::Opening && retryable =>
            {
                self.reopen_failures = self.reopen_failures.saturating_add(1);
                if self.reopen_failures >= self.policy.max_reopen_failures {
                    self.state = StreamState::Failed;
                    StreamAction::SurfaceFailure { fault }
                } else {
                    self.state = StreamState::Recovering;
                    StreamAction::ScheduleRetry {
                        delay_ms: self.policy.delay_for_failure(self.reopen_failures),
                    }
                }
            }
            StreamEvent::OpenFailed {
                fault,
                retryable: false,
            } if self.state == StreamState::Opening => {
                self.state = StreamState::Failed;
                StreamAction::SurfaceFailure { fault }
            }
            StreamEvent::DeviceInvalidated
                if matches!(self.state, StreamState::Running | StreamState::Bypassed) =>
            {
                self.reopen_failures = 0;
                self.state = StreamState::Recovering;
                StreamAction::ScheduleRetry {
                    delay_ms: self.policy.initial_backoff_ms,
                }
            }
            StreamEvent::RetryTimerElapsed if self.state == StreamState::Recovering => {
                self.state = StreamState::Opening;
                StreamAction::OpenDevice
            }
            StreamEvent::ProcessingFailed(message) if self.state == StreamState::Running => {
                self.state = StreamState::Bypassed;
                StreamAction::EnterBypass
            }
            StreamEvent::ProcessingFailed(_) if self.state == StreamState::Bypassed => {
                StreamAction::None
            }
            StreamEvent::ProcessingRecovered if self.state == StreamState::Bypassed => {
                self.state = StreamState::Running;
                StreamAction::ExitBypass
            }
            StreamEvent::StopRequested if self.state != StreamState::Stopped => {
                self.reopen_failures = 0;
                self.state = StreamState::Stopped;
                StreamAction::StopDevice
            }
            _ => StreamAction::None,
        };

        StreamTransition {
            previous,
            current: self.state,
            action,
            reopen_failures: self.reopen_failures,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> RecoveryPolicy {
        RecoveryPolicy::new(3, 25, 100).expect("valid policy")
    }

    fn running_controller() -> StreamController {
        let mut controller = StreamController::new(policy());
        controller.apply(StreamEvent::StartRequested);
        controller.apply(StreamEvent::OpenSucceeded);
        controller
    }

    #[test]
    fn policy_rejects_unbounded_or_invalid_values() {
        assert_eq!(
            RecoveryPolicy::new(0, 25, 100),
            Err(RecoveryPolicyError::ZeroAttempts)
        );
        assert_eq!(
            RecoveryPolicy::new(3, 0, 100),
            Err(RecoveryPolicyError::ZeroInitialBackoff)
        );
        assert_eq!(
            RecoveryPolicy::new(3, 100, 25),
            Err(RecoveryPolicyError::MaxBackoffBelowInitial)
        );
    }

    #[test]
    fn start_and_open_success_enter_running_state() {
        let mut controller = StreamController::new(policy());

        let opening = controller.apply(StreamEvent::StartRequested);
        assert_eq!(opening.current, StreamState::Opening);
        assert_eq!(opening.action, StreamAction::OpenDevice);

        let running = controller.apply(StreamEvent::OpenSucceeded);
        assert_eq!(running.current, StreamState::Running);
        assert_eq!(controller.reopen_failures(), 0);
    }

    #[test]
    fn processing_failure_uses_bypass_without_reopening_device() {
        let mut controller = running_controller();

        let bypass = controller.apply(StreamEvent::ProcessingFailed("provider timeout".into()));
        assert_eq!(bypass.current, StreamState::Bypassed);
        assert_eq!(bypass.action, StreamAction::EnterBypass);
        assert_eq!(controller.reopen_failures(), 0);

        let recovered = controller.apply(StreamEvent::ProcessingRecovered);
        assert_eq!(recovered.current, StreamState::Running);
        assert_eq!(recovered.action, StreamAction::ExitBypass);
    }

    #[test]
    fn invalidated_device_schedules_bounded_reopen() {
        let mut controller = running_controller();

        let invalidated = controller.apply(StreamEvent::DeviceInvalidated);
        assert_eq!(invalidated.current, StreamState::Recovering);
        assert_eq!(
            invalidated.action,
            StreamAction::ScheduleRetry { delay_ms: 25 }
        );

        let retry = controller.apply(StreamEvent::RetryTimerElapsed);
        assert_eq!(retry.current, StreamState::Opening);
        assert_eq!(retry.action, StreamAction::OpenDevice);
    }

    #[test]
    fn retry_backoff_is_exponential_and_capped() {
        let mut controller = running_controller();
        controller.apply(StreamEvent::DeviceInvalidated);
        controller.apply(StreamEvent::RetryTimerElapsed);

        let first = controller.apply(StreamEvent::OpenFailed {
            fault: StreamFault::DeviceUnavailable,
            retryable: true,
        });
        assert_eq!(first.action, StreamAction::ScheduleRetry { delay_ms: 25 });

        controller.apply(StreamEvent::RetryTimerElapsed);
        let second = controller.apply(StreamEvent::OpenFailed {
            fault: StreamFault::DeviceUnavailable,
            retryable: true,
        });
        assert_eq!(second.action, StreamAction::ScheduleRetry { delay_ms: 50 });
    }

    #[test]
    fn repeated_reopen_failures_stop_retrying_at_policy_limit() {
        let mut controller = running_controller();
        controller.apply(StreamEvent::DeviceInvalidated);

        for expected_failure in 1..=3 {
            controller.apply(StreamEvent::RetryTimerElapsed);
            let transition = controller.apply(StreamEvent::OpenFailed {
                fault: StreamFault::DeviceUnavailable,
                retryable: true,
            });
            assert_eq!(transition.reopen_failures, expected_failure);

            if expected_failure < 3 {
                assert_eq!(transition.current, StreamState::Recovering);
            } else {
                assert_eq!(transition.current, StreamState::Failed);
                assert_eq!(
                    transition.action,
                    StreamAction::SurfaceFailure {
                        fault: StreamFault::DeviceUnavailable
                    }
                );
            }
        }
    }

    #[test]
    fn successful_reopen_resets_failure_count() {
        let mut controller = running_controller();
        controller.apply(StreamEvent::DeviceInvalidated);
        controller.apply(StreamEvent::RetryTimerElapsed);
        controller.apply(StreamEvent::OpenFailed {
            fault: StreamFault::DeviceUnavailable,
            retryable: true,
        });
        controller.apply(StreamEvent::RetryTimerElapsed);

        let transition = controller.apply(StreamEvent::OpenSucceeded);

        assert_eq!(transition.current, StreamState::Running);
        assert_eq!(transition.reopen_failures, 0);
    }

    #[test]
    fn non_retryable_open_failure_surfaces_immediately() {
        let mut controller = StreamController::new(policy());
        controller.apply(StreamEvent::StartRequested);

        let transition = controller.apply(StreamEvent::OpenFailed {
            fault: StreamFault::Backend("unsupported format".into()),
            retryable: false,
        });

        assert_eq!(transition.current, StreamState::Failed);
        assert_eq!(
            transition.action,
            StreamAction::SurfaceFailure {
                fault: StreamFault::Backend("unsupported format".into())
            }
        );
    }

    #[test]
    fn stop_cancels_recovery_state() {
        let mut controller = running_controller();
        controller.apply(StreamEvent::DeviceInvalidated);

        let transition = controller.apply(StreamEvent::StopRequested);

        assert_eq!(transition.current, StreamState::Stopped);
        assert_eq!(transition.action, StreamAction::StopDevice);
        assert_eq!(transition.reopen_failures, 0);
    }
}
