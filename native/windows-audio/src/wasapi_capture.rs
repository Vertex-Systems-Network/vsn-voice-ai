use std::error::Error;
use std::fmt::{Display, Formatter};

use vsn_audio_core::device::{DeviceError, DeviceId};
use vsn_audio_core::AudioFormat;

use crate::capture_plan::{CapturePlanError, SharedCapturePlan};
use crate::engine_period::EnginePeriodRange;
use crate::MixFormatSummary;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureSessionSummary {
    pub endpoint_id: DeviceId,
    pub mix_format: MixFormatSummary,
    pub plan: SharedCapturePlan,
    pub endpoint_buffer_frames: u32,
    pub stream_latency_100ns: i64,
}

pub struct EventCaptureSession {
    summary: CaptureSessionSummary,
    inner: platform::Session,
    started: bool,
}

impl EventCaptureSession {
    pub fn open_default(frame_duration_ms: u16) -> Result<Option<Self>, WasapiCaptureError> {
        platform::open_default(frame_duration_ms).map(|session| {
            session.map(|(inner, summary)| Self {
                summary,
                inner,
                started: false,
            })
        })
    }

    pub fn summary(&self) -> &CaptureSessionSummary {
        &self.summary
    }

    pub fn is_started(&self) -> bool {
        self.started
    }

    pub fn start(&mut self) -> Result<(), WasapiCaptureError> {
        if self.started {
            return Ok(());
        }
        self.inner.start()?;
        self.started = true;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), WasapiCaptureError> {
        if !self.started {
            return Ok(());
        }
        self.inner.stop()?;
        self.started = false;
        Ok(())
    }

    pub fn next_packet_frames(&self) -> Result<u32, WasapiCaptureError> {
        self.inner.next_packet_frames()
    }
}

impl Drop for EventCaptureSession {
    fn drop(&mut self) {
        if self.started {
            let _ = self.inner.stop();
            self.started = false;
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WasapiCaptureError {
    UnsupportedPlatform,
    Backend(String),
    InvalidEndpoint(DeviceError),
    InvalidCapturePlan(CapturePlanError),
}

impl Display for WasapiCaptureError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedPlatform => f.write_str("WASAPI capture requires Windows"),
            Self::Backend(message) => write!(f, "WASAPI capture error: {message}"),
            Self::InvalidEndpoint(error) => write!(f, "invalid capture endpoint: {error}"),
            Self::InvalidCapturePlan(error) => write!(f, "invalid capture plan: {error}"),
        }
    }
}

impl Error for WasapiCaptureError {}

impl From<DeviceError> for WasapiCaptureError {
    fn from(value: DeviceError) -> Self {
        Self::InvalidEndpoint(value)
    }
}

impl From<CapturePlanError> for WasapiCaptureError {
    fn from(value: CapturePlanError) -> Self {
        Self::InvalidCapturePlan(value)
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{CaptureSessionSummary, WasapiCaptureError};

    pub struct Session;

    pub fn open_default(
        _frame_duration_ms: u16,
    ) -> Result<Option<(Session, CaptureSessionSummary)>, WasapiCaptureError> {
        Err(WasapiCaptureError::UnsupportedPlatform)
    }

    impl Session {
        pub fn start(&self) -> Result<(), WasapiCaptureError> {
            Err(WasapiCaptureError::UnsupportedPlatform)
        }

        pub fn stop(&self) -> Result<(), WasapiCaptureError> {
            Err(WasapiCaptureError::UnsupportedPlatform)
        }

        pub fn next_packet_frames(&self) -> Result<u32, WasapiCaptureError> {
            Err(WasapiCaptureError::UnsupportedPlatform)
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use windows::Win32::Foundation::{CloseHandle, ERROR_NOT_FOUND, HANDLE};
    use windows::Win32::Media::Audio::{
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, IAudioCaptureClient, IAudioClient3,
        IMMDeviceEnumerator, MMDeviceEnumerator, WAVEFORMATEX, eCapture, eCommunications,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
        CoUninitialize,
    };
    use windows::Win32::System::Threading::CreateEventW;

    use super::{
        AudioFormat, CaptureSessionSummary, DeviceId, EnginePeriodRange, MixFormatSummary,
        SharedCapturePlan, WasapiCaptureError,
    };

    struct ComApartment;

    impl ComApartment {
        fn initialize_sta() -> Result<Self, WasapiCaptureError> {
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
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
        fn new(pointer: *mut T, operation: &str) -> Result<Self, WasapiCaptureError> {
            NonNull::new(pointer)
                .map(Self)
                .ok_or_else(|| WasapiCaptureError::Backend(format!("{operation} returned null")))
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

    struct OwnedEvent(HANDLE);

    impl OwnedEvent {
        fn create_auto_reset() -> Result<Self, WasapiCaptureError> {
            let handle = unsafe { CreateEventW(None, false, false, None).map_err(backend_error)? };
            Ok(Self(handle))
        }

        fn handle(&self) -> HANDLE {
            self.0
        }
    }

    impl Drop for OwnedEvent {
        fn drop(&mut self) {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    pub struct Session {
        audio_client: IAudioClient3,
        capture_client: IAudioCaptureClient,
        _event: OwnedEvent,
        _apartment: ComApartment,
    }

    impl Session {
        pub fn start(&self) -> Result<(), WasapiCaptureError> {
            unsafe { self.audio_client.Start().map_err(backend_error) }
        }

        pub fn stop(&self) -> Result<(), WasapiCaptureError> {
            unsafe { self.audio_client.Stop().map_err(backend_error) }
        }

        pub fn next_packet_frames(&self) -> Result<u32, WasapiCaptureError> {
            unsafe {
                self.capture_client
                    .GetNextPacketSize()
                    .map_err(backend_error)
            }
        }
    }

    pub fn open_default(
        frame_duration_ms: u16,
    ) -> Result<Option<(Session, CaptureSessionSummary)>, WasapiCaptureError> {
        let apartment = ComApartment::initialize_sta()?;
        let enumerator: IMMDeviceEnumerator = unsafe {
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(backend_error)?
        };
        let device = match unsafe {
            enumerator.GetDefaultAudioEndpoint(eCapture, eCommunications)
        } {
            Ok(device) => device,
            Err(error) if error.code() == ERROR_NOT_FOUND.to_hresult() => return Ok(None),
            Err(error) => return Err(backend_error(error)),
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

        let periods = EnginePeriodRange::new(
            default_frames,
            fundamental_frames,
            min_frames,
            max_frames,
        )
        .map_err(crate::capture_plan::CapturePlanError::from)?;
        let format = AudioFormat {
            sample_rate_hz: wave.nSamplesPerSec,
            channels: wave.nChannels,
            frame_duration_ms,
        };
        let plan = SharedCapturePlan::new(format, periods)?;

        unsafe {
            audio_client.InitializeSharedAudioStream(
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                plan.engine_period_frames,
                mix_format.as_ptr(),
                None,
            )
        }
        .map_err(backend_error)?;

        let event = OwnedEvent::create_auto_reset()?;
        unsafe { audio_client.SetEventHandle(event.handle()).map_err(backend_error)? };
        let capture_client: IAudioCaptureClient =
            unsafe { audio_client.GetService().map_err(backend_error)? };
        let endpoint_buffer_frames = unsafe { audio_client.GetBufferSize().map_err(backend_error)? };
        let stream_latency_100ns = unsafe { audio_client.GetStreamLatency().map_err(backend_error)? };

        let summary = CaptureSessionSummary {
            endpoint_id,
            mix_format: MixFormatSummary {
                sample_rate_hz: wave.nSamplesPerSec,
                channels: wave.nChannels,
                bits_per_sample: wave.wBitsPerSample,
                block_align: wave.nBlockAlign,
            },
            plan,
            endpoint_buffer_frames,
            stream_latency_100ns,
        };
        let session = Session {
            audio_client,
            capture_client,
            _event: event,
            _apartment: apartment,
        };

        Ok(Some((session, summary)))
    }

    fn device_id(device: &windows::Win32::Media::Audio::IMMDevice) -> Result<String, WasapiCaptureError> {
        let value = unsafe { device.GetId().map_err(backend_error)? };
        let text = unsafe { value.to_string() }
            .map_err(|error| WasapiCaptureError::Backend(error.to_string()));
        unsafe { CoTaskMemFree(Some(value.0.cast::<c_void>())) };
        text
    }

    fn backend_error(error: windows::core::Error) -> WasapiCaptureError {
        WasapiCaptureError::Backend(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(windows))]
    #[test]
    fn capture_session_is_explicitly_unavailable_off_windows() {
        assert!(matches!(
            EventCaptureSession::open_default(10),
            Err(WasapiCaptureError::UnsupportedPlatform)
        ));
    }

    #[cfg(windows)]
    #[test]
    fn default_event_capture_session_initializes_when_endpoint_exists() {
        let session = EventCaptureSession::open_default(10)
            .expect("event-driven WASAPI session initialization should execute");

        if let Some(session) = session {
            let summary = session.summary();
            assert!(summary.mix_format.sample_rate_hz > 0);
            assert!(summary.mix_format.channels > 0);
            assert!(summary.endpoint_buffer_frames > 0);
            assert!(summary.plan.engine_period_frames > 0);
            assert!(!session.is_started());
        }
    }

    #[cfg(windows)]
    #[test]
    fn default_event_capture_session_start_stop_is_idempotent_when_endpoint_exists() {
        let Some(mut session) = EventCaptureSession::open_default(10)
            .expect("event-driven WASAPI session initialization should execute")
        else {
            return;
        };

        session.start().expect("WASAPI capture stream should start");
        assert!(session.is_started());
        session.start().expect("repeated start should be idempotent");
        session.stop().expect("WASAPI capture stream should stop");
        assert!(!session.is_started());
        session.stop().expect("repeated stop should be idempotent");
    }
}
