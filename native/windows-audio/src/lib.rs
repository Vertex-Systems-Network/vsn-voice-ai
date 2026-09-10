pub mod capture_plan;
pub mod engine_period;

use std::error::Error;
use std::fmt::{Display, Formatter};

use vsn_audio_core::device::{
    DeviceCatalog, DeviceDescriptor, DeviceError, DeviceFlow, DeviceId, DeviceRole,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefaultEndpoint {
    pub flow: DeviceFlow,
    pub role: DeviceRole,
    pub id: DeviceId,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EndpointSnapshot {
    pub devices: Vec<DeviceDescriptor>,
    pub defaults: Vec<DefaultEndpoint>,
}

impl EndpointSnapshot {
    pub fn into_catalog(self) -> Result<DeviceCatalog, WindowsAudioError> {
        let mut catalog = DeviceCatalog::new();
        for descriptor in self.devices {
            catalog.upsert(descriptor);
        }
        for default in self.defaults {
            catalog.set_default(default.flow, default.role, Some(default.id))?;
        }
        Ok(catalog)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowsAudioError {
    UnsupportedPlatform,
    Backend(String),
    InvalidEndpoint(DeviceError),
}

impl Display for WindowsAudioError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedPlatform => f.write_str("Windows audio backend requires Windows"),
            Self::Backend(message) => write!(f, "Windows audio backend error: {message}"),
            Self::InvalidEndpoint(error) => write!(f, "invalid Windows audio endpoint: {error}"),
        }
    }
}

impl Error for WindowsAudioError {}

impl From<DeviceError> for WindowsAudioError {
    fn from(value: DeviceError) -> Self {
        Self::InvalidEndpoint(value)
    }
}

pub fn snapshot_endpoints() -> Result<EndpointSnapshot, WindowsAudioError> {
    platform::snapshot_endpoints()
}

#[cfg(not(windows))]
mod platform {
    use super::{EndpointSnapshot, WindowsAudioError};

    pub fn snapshot_endpoints() -> Result<EndpointSnapshot, WindowsAudioError> {
        Err(WindowsAudioError::UnsupportedPlatform)
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;

    use vsn_audio_core::device::DeviceState;
    use windows::Win32::Media::Audio::{
        DEVICE_STATE_ACTIVE, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, eCapture,
        eCommunications, eConsole, eMultimedia, eRender,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
        CoUninitialize,
    };

    use super::{
        DefaultEndpoint, DeviceDescriptor, DeviceFlow, DeviceId, DeviceRole, EndpointSnapshot,
        WindowsAudioError,
    };

    struct ComApartment;

    impl ComApartment {
        fn initialize() -> Result<Self, WindowsAudioError> {
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
                .ok()
                .map_err(backend_error)?;
            Ok(Self)
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    pub fn snapshot_endpoints() -> Result<EndpointSnapshot, WindowsAudioError> {
        let _com = ComApartment::initialize()?;
        let enumerator: IMMDeviceEnumerator = unsafe {
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(backend_error)?
        };

        let mut devices = Vec::new();
        collect_active_devices(&enumerator, DeviceFlow::Capture, &mut devices)?;
        collect_active_devices(&enumerator, DeviceFlow::Render, &mut devices)?;

        let mut defaults = Vec::new();
        collect_default(
            &enumerator,
            DeviceFlow::Capture,
            DeviceRole::Console,
            &mut defaults,
        )?;
        collect_default(
            &enumerator,
            DeviceFlow::Capture,
            DeviceRole::Multimedia,
            &mut defaults,
        )?;
        collect_default(
            &enumerator,
            DeviceFlow::Capture,
            DeviceRole::Communications,
            &mut defaults,
        )?;
        collect_default(
            &enumerator,
            DeviceFlow::Render,
            DeviceRole::Console,
            &mut defaults,
        )?;
        collect_default(
            &enumerator,
            DeviceFlow::Render,
            DeviceRole::Multimedia,
            &mut defaults,
        )?;
        collect_default(
            &enumerator,
            DeviceFlow::Render,
            DeviceRole::Communications,
            &mut defaults,
        )?;

        Ok(EndpointSnapshot { devices, defaults })
    }

    fn collect_active_devices(
        enumerator: &IMMDeviceEnumerator,
        flow: DeviceFlow,
        devices: &mut Vec<DeviceDescriptor>,
    ) -> Result<(), WindowsAudioError> {
        let data_flow = match flow {
            DeviceFlow::Capture => eCapture,
            DeviceFlow::Render => eRender,
        };
        let collection = unsafe {
            enumerator
                .EnumAudioEndpoints(data_flow, DEVICE_STATE_ACTIVE)
                .map_err(backend_error)?
        };
        let count = unsafe { collection.GetCount().map_err(backend_error)? };

        for index in 0..count {
            let device = unsafe { collection.Item(index).map_err(backend_error)? };
            let endpoint_id = device_id(&device)?;
            let id = DeviceId::new(endpoint_id.clone())?;
            devices.push(DeviceDescriptor::new(
                id,
                endpoint_id,
                flow,
                DeviceState::Active,
            )?);
        }

        Ok(())
    }

    fn collect_default(
        enumerator: &IMMDeviceEnumerator,
        flow: DeviceFlow,
        role: DeviceRole,
        defaults: &mut Vec<DefaultEndpoint>,
    ) -> Result<(), WindowsAudioError> {
        let data_flow = match flow {
            DeviceFlow::Capture => eCapture,
            DeviceFlow::Render => eRender,
        };
        let endpoint_role = match role {
            DeviceRole::Console => eConsole,
            DeviceRole::Multimedia => eMultimedia,
            DeviceRole::Communications => eCommunications,
        };

        let Ok(device) = (unsafe { enumerator.GetDefaultAudioEndpoint(data_flow, endpoint_role) })
        else {
            return Ok(());
        };
        defaults.push(DefaultEndpoint {
            flow,
            role,
            id: DeviceId::new(device_id(&device)?)?,
        });
        Ok(())
    }

    fn device_id(device: &IMMDevice) -> Result<String, WindowsAudioError> {
        let value = unsafe { device.GetId().map_err(backend_error)? };
        let text = unsafe { value.to_string() }
            .map_err(|error| WindowsAudioError::Backend(error.to_string()));
        unsafe { CoTaskMemFree(Some(value.0.cast::<c_void>())) };
        text
    }

    fn backend_error(error: windows::core::Error) -> WindowsAudioError {
        WindowsAudioError::Backend(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vsn_audio_core::device::DeviceState;

    fn id(value: &str) -> DeviceId {
        DeviceId::new(value).expect("valid test device id")
    }

    fn device(value: &str, flow: DeviceFlow) -> DeviceDescriptor {
        DeviceDescriptor::new(id(value), value, flow, DeviceState::Active)
            .expect("valid test endpoint")
    }

    #[test]
    fn snapshot_builds_core_catalog_with_default_roles() {
        let snapshot = EndpointSnapshot {
            devices: vec![
                device("mic-a", DeviceFlow::Capture),
                device("speaker-a", DeviceFlow::Render),
            ],
            defaults: vec![
                DefaultEndpoint {
                    flow: DeviceFlow::Capture,
                    role: DeviceRole::Communications,
                    id: id("mic-a"),
                },
                DefaultEndpoint {
                    flow: DeviceFlow::Render,
                    role: DeviceRole::Console,
                    id: id("speaker-a"),
                },
            ],
        };

        let catalog = snapshot.into_catalog().expect("snapshot should map");

        assert_eq!(
            catalog
                .default_for(DeviceFlow::Capture, DeviceRole::Communications)
                .map(|device| device.id.as_str()),
            Some("mic-a")
        );
        assert_eq!(
            catalog
                .default_for(DeviceFlow::Render, DeviceRole::Console)
                .map(|device| device.id.as_str()),
            Some("speaker-a")
        );
    }

    #[test]
    fn snapshot_rejects_default_with_wrong_flow() {
        let snapshot = EndpointSnapshot {
            devices: vec![device("speaker-a", DeviceFlow::Render)],
            defaults: vec![DefaultEndpoint {
                flow: DeviceFlow::Capture,
                role: DeviceRole::Communications,
                id: id("speaker-a"),
            }],
        };

        assert!(matches!(
            snapshot.into_catalog(),
            Err(WindowsAudioError::InvalidEndpoint(
                DeviceError::FlowMismatch { .. }
            ))
        ));
    }

    #[cfg(not(windows))]
    #[test]
    fn backend_is_explicitly_unavailable_off_windows() {
        assert_eq!(
            snapshot_endpoints(),
            Err(WindowsAudioError::UnsupportedPlatform)
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_mmdevice_snapshot_runtime_smoke() {
        let snapshot = snapshot_endpoints().expect("MMDevice endpoint snapshot should initialize");
        snapshot
            .into_catalog()
            .expect("runtime MMDevice snapshot should satisfy core catalog invariants");
    }
}
