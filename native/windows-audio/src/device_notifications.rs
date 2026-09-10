use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, TryRecvError, TrySendError, sync_channel};

use vsn_audio_core::device::{DeviceFlow, DeviceId, DeviceRole, DeviceState};

pub const DEFAULT_NOTIFICATION_QUEUE_CAPACITY: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndpointNotification {
    DeviceStateChanged {
        endpoint_id: String,
        state: DeviceState,
    },
    DeviceAdded {
        endpoint_id: String,
    },
    DeviceRemoved {
        endpoint_id: String,
    },
    DefaultDeviceChanged {
        flow: DeviceFlow,
        role: DeviceRole,
        endpoint_id: Option<String>,
    },
}

#[derive(Clone)]
struct NotificationPublisher {
    sender: SyncSender<EndpointNotification>,
    dropped: Arc<AtomicU64>,
}

impl NotificationPublisher {
    fn publish(&self, event: EndpointNotification) {
        match self.sender.try_send(event) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                self.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

pub struct EndpointNotificationSubscription {
    receiver: Receiver<EndpointNotification>,
    dropped: Arc<AtomicU64>,
    _platform: platform::Subscription,
}

impl EndpointNotificationSubscription {
    pub fn register(queue_capacity: usize) -> Result<Self, EndpointNotificationError> {
        if queue_capacity == 0 {
            return Err(EndpointNotificationError::QueueCapacityZero);
        }

        let (sender, receiver) = sync_channel(queue_capacity);
        let dropped = Arc::new(AtomicU64::new(0));
        let publisher = NotificationPublisher {
            sender,
            dropped: Arc::clone(&dropped),
        };
        let platform = platform::register(publisher)?;

        Ok(Self {
            receiver,
            dropped,
            _platform: platform,
        })
    }

    pub fn register_with_standard_capacity() -> Result<Self, EndpointNotificationError> {
        Self::register(DEFAULT_NOTIFICATION_QUEUE_CAPACITY)
    }

    pub fn drain(&self, max_events: usize) -> Vec<EndpointNotification> {
        let mut events = Vec::with_capacity(max_events.min(DEFAULT_NOTIFICATION_QUEUE_CAPACITY));
        while events.len() < max_events {
            match self.receiver.try_recv() {
                Ok(event) => events.push(event),
                Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => break,
            }
        }
        events
    }

    pub fn dropped_notifications(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

pub fn requires_capture_reopen(
    event: &EndpointNotification,
    active_endpoint: Option<&DeviceId>,
) -> bool {
    match event {
        EndpointNotification::DeviceStateChanged { endpoint_id, state } => {
            *state != DeviceState::Active && endpoint_matches(endpoint_id, active_endpoint)
        }
        EndpointNotification::DeviceRemoved { endpoint_id } => {
            endpoint_matches(endpoint_id, active_endpoint)
        }
        EndpointNotification::DefaultDeviceChanged {
            flow: DeviceFlow::Capture,
            role: DeviceRole::Communications,
            endpoint_id,
        } => match (endpoint_id.as_deref(), active_endpoint) {
            (Some(new_default), Some(active)) => new_default != active.as_str(),
            _ => true,
        },
        _ => false,
    }
}

fn endpoint_matches(endpoint_id: &str, active_endpoint: Option<&DeviceId>) -> bool {
    active_endpoint.is_some_and(|active| active.as_str() == endpoint_id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndpointNotificationError {
    QueueCapacityZero,
    UnsupportedPlatform,
    RegistrationFailed(String),
    RegistrationThreadStopped,
}

impl Display for EndpointNotificationError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::QueueCapacityZero => {
                f.write_str("endpoint notification queue capacity must be greater than zero")
            }
            Self::UnsupportedPlatform => {
                f.write_str("MMDevice endpoint notifications require Windows")
            }
            Self::RegistrationFailed(message) => {
                write!(
                    f,
                    "MMDevice endpoint notification registration failed: {message}"
                )
            }
            Self::RegistrationThreadStopped => {
                f.write_str("MMDevice notification thread stopped before registration completed")
            }
        }
    }
}

impl Error for EndpointNotificationError {}

#[cfg(not(windows))]
mod platform {
    use super::{EndpointNotificationError, NotificationPublisher};

    pub struct Subscription;

    pub fn register(
        _publisher: NotificationPublisher,
    ) -> Result<Subscription, EndpointNotificationError> {
        Err(EndpointNotificationError::UnsupportedPlatform)
    }
}

#[cfg(windows)]
mod platform {
    use std::sync::mpsc::{Sender, channel};
    use std::thread::{self, JoinHandle};

    use vsn_audio_core::device::{DeviceFlow, DeviceRole, DeviceState};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{
        DEVICE_STATE, DEVICE_STATE_ACTIVE, DEVICE_STATE_DISABLED, DEVICE_STATE_NOTPRESENT,
        DEVICE_STATE_UNPLUGGED, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient,
        IMMNotificationClient_Impl, MMDeviceEnumerator, eCapture, eCommunications, eConsole,
        eMultimedia, eRender,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
    };
    use windows::core::PCWSTR;

    use super::{EndpointNotification, EndpointNotificationError, NotificationPublisher};

    pub struct Subscription {
        stop: Option<Sender<()>>,
        thread: Option<JoinHandle<()>>,
    }

    impl Drop for Subscription {
        fn drop(&mut self) {
            if let Some(stop) = self.stop.take() {
                let _ = stop.send(());
            }
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    pub fn register(
        publisher: NotificationPublisher,
    ) -> Result<Subscription, EndpointNotificationError> {
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();
        let (stop_tx, stop_rx) = channel::<()>();
        let thread = thread::Builder::new()
            .name("vsn-mmdevice-notifications".into())
            .spawn(move || notification_thread(publisher, ready_tx, stop_rx))
            .map_err(|error| EndpointNotificationError::RegistrationFailed(error.to_string()))?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Subscription {
                stop: Some(stop_tx),
                thread: Some(thread),
            }),
            Ok(Err(message)) => {
                let _ = thread.join();
                Err(EndpointNotificationError::RegistrationFailed(message))
            }
            Err(_) => {
                let _ = thread.join();
                Err(EndpointNotificationError::RegistrationThreadStopped)
            }
        }
    }

    fn notification_thread(
        publisher: NotificationPublisher,
        ready: Sender<Result<(), String>>,
        stop: std::sync::mpsc::Receiver<()>,
    ) {
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if let Err(error) = result.ok() {
            let _ = ready.send(Err(error.to_string()));
            return;
        }

        let registration = register_client(publisher);
        match registration {
            Ok((enumerator, client)) => {
                if ready.send(Ok(())).is_ok() {
                    let _ = stop.recv();
                }
                let _ = unsafe { enumerator.UnregisterEndpointNotificationCallback(&client) };
            }
            Err(error) => {
                let _ = ready.send(Err(error.to_string()));
            }
        }

        unsafe { CoUninitialize() };
    }

    fn register_client(
        publisher: NotificationPublisher,
    ) -> windows::core::Result<(IMMDeviceEnumerator, IMMNotificationClient)> {
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
        let client: IMMNotificationClient = NotificationClient { publisher }.into();
        unsafe { enumerator.RegisterEndpointNotificationCallback(&client)? };
        Ok((enumerator, client))
    }

    #[windows::core::implement(IMMNotificationClient)]
    struct NotificationClient {
        publisher: NotificationPublisher,
    }

    impl IMMNotificationClient_Impl for NotificationClient_Impl {
        fn OnDeviceStateChanged(
            &self,
            pwstrdeviceid: &PCWSTR,
            dwnewstate: DEVICE_STATE,
        ) -> windows::core::Result<()> {
            let Some(endpoint_id) = read_device_id(pwstrdeviceid) else {
                return Ok(());
            };
            let Some(state) = map_device_state(dwnewstate) else {
                return Ok(());
            };
            self.publisher
                .publish(EndpointNotification::DeviceStateChanged { endpoint_id, state });
            Ok(())
        }

        fn OnDeviceAdded(&self, pwstrdeviceid: &PCWSTR) -> windows::core::Result<()> {
            if let Some(endpoint_id) = read_device_id(pwstrdeviceid) {
                self.publisher
                    .publish(EndpointNotification::DeviceAdded { endpoint_id });
            }
            Ok(())
        }

        fn OnDeviceRemoved(&self, pwstrdeviceid: &PCWSTR) -> windows::core::Result<()> {
            if let Some(endpoint_id) = read_device_id(pwstrdeviceid) {
                self.publisher
                    .publish(EndpointNotification::DeviceRemoved { endpoint_id });
            }
            Ok(())
        }

        fn OnDefaultDeviceChanged(
            &self,
            flow: EDataFlow,
            role: ERole,
            pwstrdefaultdeviceid: &PCWSTR,
        ) -> windows::core::Result<()> {
            let (Some(flow), Some(role)) = (map_flow(flow), map_role(role)) else {
                return Ok(());
            };
            self.publisher
                .publish(EndpointNotification::DefaultDeviceChanged {
                    flow,
                    role,
                    endpoint_id: read_device_id(pwstrdefaultdeviceid),
                });
            Ok(())
        }

        fn OnPropertyValueChanged(
            &self,
            _pwstrdeviceid: &PCWSTR,
            _key: &PROPERTYKEY,
        ) -> windows::core::Result<()> {
            Ok(())
        }
    }

    fn read_device_id(value: &PCWSTR) -> Option<String> {
        if value.0.is_null() {
            return None;
        }
        unsafe { value.to_string() }
            .ok()
            .filter(|value| !value.trim().is_empty())
    }

    fn map_flow(value: EDataFlow) -> Option<DeviceFlow> {
        if value == eCapture {
            Some(DeviceFlow::Capture)
        } else if value == eRender {
            Some(DeviceFlow::Render)
        } else {
            None
        }
    }

    fn map_role(value: ERole) -> Option<DeviceRole> {
        if value == eConsole {
            Some(DeviceRole::Console)
        } else if value == eMultimedia {
            Some(DeviceRole::Multimedia)
        } else if value == eCommunications {
            Some(DeviceRole::Communications)
        } else {
            None
        }
    }

    fn map_device_state(value: DEVICE_STATE) -> Option<DeviceState> {
        if value == DEVICE_STATE_ACTIVE {
            Some(DeviceState::Active)
        } else if value == DEVICE_STATE_DISABLED {
            Some(DeviceState::Disabled)
        } else if value == DEVICE_STATE_NOTPRESENT {
            Some(DeviceState::NotPresent)
        } else if value == DEVICE_STATE_UNPLUGGED {
            Some(DeviceState::Unplugged)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> DeviceId {
        DeviceId::new(value).expect("valid test device id")
    }

    #[test]
    fn queue_capacity_must_be_nonzero() {
        assert!(matches!(
            EndpointNotificationSubscription::register(0),
            Err(EndpointNotificationError::QueueCapacityZero)
        ));
    }

    #[test]
    fn bounded_publisher_drops_without_blocking_when_full() {
        let (sender, receiver) = sync_channel(1);
        let dropped = Arc::new(AtomicU64::new(0));
        let publisher = NotificationPublisher {
            sender,
            dropped: Arc::clone(&dropped),
        };

        publisher.publish(EndpointNotification::DeviceAdded {
            endpoint_id: "mic-a".into(),
        });
        publisher.publish(EndpointNotification::DeviceAdded {
            endpoint_id: "mic-b".into(),
        });

        assert_eq!(dropped.load(Ordering::Relaxed), 1);
        assert_eq!(
            receiver.try_recv().expect("first event remains queued"),
            EndpointNotification::DeviceAdded {
                endpoint_id: "mic-a".into()
            }
        );
    }

    #[test]
    fn capture_reopen_only_tracks_active_capture_route_changes() {
        let active = id("mic-a");

        assert!(requires_capture_reopen(
            &EndpointNotification::DeviceStateChanged {
                endpoint_id: "mic-a".into(),
                state: DeviceState::Unplugged,
            },
            Some(&active)
        ));
        assert!(requires_capture_reopen(
            &EndpointNotification::DeviceRemoved {
                endpoint_id: "mic-a".into(),
            },
            Some(&active)
        ));
        assert!(requires_capture_reopen(
            &EndpointNotification::DefaultDeviceChanged {
                flow: DeviceFlow::Capture,
                role: DeviceRole::Communications,
                endpoint_id: Some("mic-b".into()),
            },
            Some(&active)
        ));
        assert!(!requires_capture_reopen(
            &EndpointNotification::DefaultDeviceChanged {
                flow: DeviceFlow::Capture,
                role: DeviceRole::Communications,
                endpoint_id: Some("mic-a".into()),
            },
            Some(&active)
        ));
        assert!(!requires_capture_reopen(
            &EndpointNotification::DeviceStateChanged {
                endpoint_id: "speaker-a".into(),
                state: DeviceState::Disabled,
            },
            Some(&active)
        ));
        assert!(!requires_capture_reopen(
            &EndpointNotification::DefaultDeviceChanged {
                flow: DeviceFlow::Render,
                role: DeviceRole::Communications,
                endpoint_id: Some("speaker-b".into()),
            },
            Some(&active)
        ));
    }

    #[cfg(not(windows))]
    #[test]
    fn notification_subscription_is_explicitly_unavailable_off_windows() {
        assert!(matches!(
            EndpointNotificationSubscription::register_with_standard_capacity(),
            Err(EndpointNotificationError::UnsupportedPlatform)
        ));
    }

    #[cfg(windows)]
    #[test]
    fn notification_subscription_registers_and_unregisters_on_windows() {
        let subscription = EndpointNotificationSubscription::register(8)
            .expect("MMDevice notification callback should register");
        assert!(subscription.drain(8).is_empty());
        assert_eq!(subscription.dropped_notifications(), 0);
    }
}
