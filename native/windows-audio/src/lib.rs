pub mod capture_plan;
pub mod engine_period;

use std::error::Error;
use std::fmt::{Display, Formatter};

use vsn_audio_core::device::{
    DeviceCatalog, DeviceDescriptor, DeviceError, DeviceFlow, DeviceId, DeviceRole,
};

use crate::engine_period::{EnginePeriodError, EnginePeriodRange};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MixFormatSummary {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub block_align: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefaultCapturePeriodProbe {
    pub endpoint_id: DeviceId,
    pub mix_format: MixFormatSummary,
    pub engine_periods: EnginePeriodRange,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowsAudioError {
    UnsupportedPlatform,
    Backend(String),
    InvalidEndpoint(DeviceError),
    InvalidEnginePeriod(EnginePeriodError),
}

impl Display for WindowsAudioError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedPlatform => f.write_str("Windows audio backend requires Windows"),
            Self::Backend(message) => write!(f, "Windows audio backend error: {message}"),
            Self::InvalidEndpoint(error) => write!(f, "invalid Windows audio endpoint: {error}"),
            Self::InvalidEnginePeriod(error) => write!(f, "invalid Windows engine period: {error}"),
        }
    }
}

impl Error for WindowsAudioError {}

impl From<DeviceError> for WindowsAudioError {
    fn from(value: DeviceError) -> Self {
        Self::InvalidEndpoint(value)
    }
}

impl From<EnginePeriodError> for WindowsAudioError {
    fn from(value: EnginePeriodError) -> Self {
        Self::InvalidEnginePeriod(value)
    }
}

pub fn snapshot_endpoints() -> Result<EndpointSnapshot, WindowsAudioError> {
    platform::snapshot_endpoints()
}

pub fn probe_default_capture_periods()
-> Result<Option<DefaultCapturePeriodProbe>, WindowsAudioError> {
    platform::probe_default_capture_periods()
}

#[cfg(not(windows))]
mod platform {
    use super::{DefaultCapturePeriodProbe, EndpointSnapshot, WindowsAudioError};

    pub fn snapshot_endpoints() -> Result<EndpointSnapshot, WindowsAudioError> {
        Err(WindowsAudioError::UnsupportedPlatform)
    }

    pub fn probe_default_capture_periods()
    -> Result<Option<DefaultCapturePeriodProbe>, WindowsAudioError> {
        Err(WindowsAudioError::UnsupportedPlatform)
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use vsn_audio_core::device::DeviceState;
    use windows::Win32::Media::Audio::{
        DEVICE_STATE_ACTIVE, IAudioClient3, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        WAVEFORMATEX, eCapture, eCommunications, eConsole, eMultimedia, eRender,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
        CoUninitialize,
    };

    use super::{
        DefaultCapturePeriodProbe, DefaultEndpoint, DeviceDescriptor, DeviceFlow, DeviceId,
        DeviceRole, EndpointSnapshot, MixFormatSummary, WindowsAudioError,
    };
    use crate::engine_period::EnginePeriodRange;

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

    struct CoTaskMem<T>(NonNull<T>);

    impl<T> CoTaskMem<T> {
        fn new(pointer: *mut T, operation: &str) -> Result<Self, WindowsAudioError> {
            NonNull::new(pointer)
                .map(Self)
                .ok_or_else(|| WindowsAudioError::Backend(format!("{operation} returned null")))
        }

        fn as_ptr(&self) -> *const T {
            self.0.as_ptr()
        }
    }

    impl<T> Drop for CoTaskMem<T> {
        fn drop(&mut self) {
            unsafe { CoTaskMemFree(Some(self.0.as_ptr().cast::<c_void>())) };
        }
    }

    fn create_enumerator() -> Result<IMMDeviceEnumerator, WindowsAudioError> {
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(backend_error) }
    }

    pub fn snapshot_endpoints() -> Result<EndpointSnapshot, WindowsAudioError> {
        let _com = ComApartment::initialize()?;
        let enumerator = create_enumerator()?;

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

    pub fn probe_default_capture_periods()
    -> Result<Option<DefaultCapturePeriodProbe>, WindowsAudioError> {
        let _com = ComApartment::initialize()?;
        let enumerator = create_enumerator()?;
        let device = match unsafe { enumerator.GetDefaultAudioEndpoint(eCapture, eCommunications) }
        {
            Ok(device) => device,
            Err(_) => return Ok(None),
        };

        let endpoint_id = DeviceId::new(device_id(&device)?)?;
        let audio_client: IAudioClient3 =
            unsafe { device.Activate(CLSCTX_ALL, None).map_err(backend_error)? };
        let mix_format = CoTaskMem::new(
            unsafe { audio_client.GetMixFormat().map_err(backend_error)? },
            "IAudioClient3::GetMixFormat",
        )?;
        let wave: WAVEFORMATEX = unsafe { *mix_format.as_ptr() };

        let mut default_frames = 0;
        let mut fundamental_frames = 0;
        let mut min_frames = 0;
        let mut max_frames = 0;
        unsafe {
            audio_client.GetSharedModeEnginePeriod(
                mix_format.as_ptr(),
                &mut default_frames,
                &mut fundamental_frames,
                &mut min_frames,
                &mut max_frames,
            )
        }
        .map_err(backend_error)?;

        Ok(Some(DefaultCapturePeriodProbe {
            endpoint_id,
            mix_format: MixFormatSummary {
                sample_rate_hz: wave.nSamplesPerSec,
                channels: wave.nChannels,
                bits_per_sample: wave.wBitsPerSample,
                block_align: wave.nBlockAlign,
            },
            engine_periods: EnginePeriodRange::new(
                default_frames,
                fundamental_frames,
                min_frames,
                max_frames,
            )?,
        }))
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
        assert_eq!(
            probe_default_capture_periods(),
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

    #[cfg(windows)]
    #[test]
    fn windows_default_capture_period_probe_runtime_smoke() {
        let snapshot = snapshot_endpoints().expect("MMDevice endpoint snapshot should initialize");
        let has_communications_capture = snapshot.defaults.iter().any(|default| {
            default.flow == DeviceFlow::Capture && default.role == DeviceRole::Communications
        });
        let probe = probe_default_capture_periods().expect("IAudioClient3 period probe should run");

        assert_eq!(probe.is_some(), has_communications_capture);
        if let Some(probe) = probe {
            assert!(probe.mix_format.sample_rate_hz > 0);
            assert!(probe.mix_format.channels > 0);
            assert!(
                probe
                    .engine_periods
                    .is_supported(probe.engine_periods.default_frames)
            );
        }
    }
}
