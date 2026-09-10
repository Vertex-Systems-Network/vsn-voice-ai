use std::error::Error;
use std::fmt::{Display, Formatter};

use vsn_audio_core::device::{DeviceError, DeviceId};

use crate::MixFormatSummary;
use crate::capture_plan::{CapturePlanError, SharedCapturePlan};
use crate::sample_decode::{NativeSampleEncoding, SampleDecodeError, SampleDecoder};
use crate::wave_format::{WAVE_FORMAT_EXTENSIBLE_TAG, WaveFormatError};

const BUFFERFLAG_DATA_DISCONTINUITY: u32 = 0x1;
const BUFFERFLAG_SILENT: u32 = 0x2;
const BUFFERFLAG_TIMESTAMP_ERROR: u32 = 0x4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CapturePacketFlags {
    pub silent: bool,
    pub data_discontinuity: bool,
    pub timestamp_error: bool,
}

impl CapturePacketFlags {
    pub fn from_raw(raw: u32) -> Self {
        Self {
            silent: raw & BUFFERFLAG_SILENT != 0,
            data_discontinuity: raw & BUFFERFLAG_DATA_DISCONTINUITY != 0,
            timestamp_error: raw & BUFFERFLAG_TIMESTAMP_ERROR != 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedPacket {
    pub frames: u32,
    pub bytes: Vec<u8>,
    pub flags: CapturePacketFlags,
    pub device_position_frames: u64,
    pub qpc_position_100ns: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureSessionSummary {
    pub endpoint_id: DeviceId,
    pub mix_format: MixFormatSummary,
    pub sample_encoding: NativeSampleEncoding,
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

    pub fn wait_for_packet_event(&self, timeout_ms: u32) -> Result<bool, WasapiCaptureError> {
        if !self.started {
            return Err(WasapiCaptureError::SessionNotStarted);
        }
        self.inner.wait_for_packet_event(timeout_ms)
    }

    pub fn next_packet_frames(&self) -> Result<u32, WasapiCaptureError> {
        if !self.started {
            return Err(WasapiCaptureError::SessionNotStarted);
        }
        self.inner.next_packet_frames()
    }

    pub fn read_packet(&self) -> Result<Option<CapturedPacket>, WasapiCaptureError> {
        if !self.started {
            return Err(WasapiCaptureError::SessionNotStarted);
        }
        self.inner.read_packet()
    }

    pub fn decode_packet(&self, packet: &CapturedPacket) -> Result<Vec<f32>, WasapiCaptureError> {
        let decoder = SampleDecoder::new(
            self.summary.sample_encoding,
            self.summary.mix_format.channels,
        )?;
        decoder
            .decode_interleaved(&packet.bytes)
            .map_err(WasapiCaptureError::from)
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
    SessionNotStarted,
    InvalidMixFormat(&'static str),
    BlockAlignMismatch { declared: u16, expected: usize },
    PacketSizeOverflow { frames: u32, block_align: u16 },
    NullPacketData { frames: u32 },
    Backend(String),
    InvalidEndpoint(DeviceError),
    InvalidCapturePlan(CapturePlanError),
    InvalidWaveFormat(WaveFormatError),
    InvalidSampleDecode(SampleDecodeError),
}

impl Display for WasapiCaptureError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedPlatform => f.write_str("WASAPI capture requires Windows"),
            Self::SessionNotStarted => f.write_str("WASAPI capture session must be started"),
            Self::InvalidMixFormat(message) => write!(f, "invalid WASAPI mix format: {message}"),
            Self::BlockAlignMismatch { declared, expected } => write!(
                f,
                "invalid WASAPI block alignment: declared {declared} bytes, expected {expected}"
            ),
            Self::PacketSizeOverflow {
                frames,
                block_align,
            } => write!(
                f,
                "WASAPI packet size overflow for {frames} frames at block alignment {block_align}"
            ),
            Self::NullPacketData { frames } => {
                write!(
                    f,
                    "WASAPI returned null packet data for {frames} non-silent frames"
                )
            }
            Self::Backend(message) => write!(f, "WASAPI capture error: {message}"),
            Self::InvalidEndpoint(error) => write!(f, "invalid capture endpoint: {error}"),
            Self::InvalidCapturePlan(error) => write!(f, "invalid capture plan: {error}"),
            Self::InvalidWaveFormat(error) => write!(f, "unsupported WASAPI mix format: {error}"),
            Self::InvalidSampleDecode(error) => write!(f, "invalid native audio samples: {error}"),
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

impl From<WaveFormatError> for WasapiCaptureError {
    fn from(value: WaveFormatError) -> Self {
        Self::InvalidWaveFormat(value)
    }
}

impl From<SampleDecodeError> for WasapiCaptureError {
    fn from(value: SampleDecodeError) -> Self {
        Self::InvalidSampleDecode(value)
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{CaptureSessionSummary, CapturedPacket, WasapiCaptureError};

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

        pub fn wait_for_packet_event(&self, _timeout_ms: u32) -> Result<bool, WasapiCaptureError> {
            Err(WasapiCaptureError::UnsupportedPlatform)
        }

        pub fn next_packet_frames(&self) -> Result<u32, WasapiCaptureError> {
            Err(WasapiCaptureError::UnsupportedPlatform)
        }

        pub fn read_packet(&self) -> Result<Option<CapturedPacket>, WasapiCaptureError> {
            Err(WasapiCaptureError::UnsupportedPlatform)
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::ptr::addr_of;
    use std::ptr::{NonNull, null_mut, read_unaligned};
    use std::slice;

    use vsn_audio_core::AudioFormat;
    use windows::Win32::Foundation::{
        CloseHandle, ERROR_NOT_FOUND, GetLastError, HANDLE, WAIT_FAILED, WAIT_OBJECT_0,
        WAIT_TIMEOUT,
    };
    use windows::Win32::Media::Audio::{
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK, IAudioCaptureClient, IAudioClient3, IMMDeviceEnumerator,
        MMDeviceEnumerator, WAVEFORMATEX, WAVEFORMATEXTENSIBLE, eCapture, eCommunications,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
        CoUninitialize,
    };
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    use super::{
        CapturePacketFlags, CaptureSessionSummary, CapturedPacket, DeviceId, MixFormatSummary,
        SampleDecoder, SharedCapturePlan, WAVE_FORMAT_EXTENSIBLE_TAG, WasapiCaptureError,
    };
    use crate::engine_period::EnginePeriodRange;
    use crate::wave_format::{ExtensibleWaveFormat, WaveFormatDescriptor};

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

        fn wait(&self, timeout_ms: u32) -> Result<bool, WasapiCaptureError> {
            let result = unsafe { WaitForSingleObject(self.0, timeout_ms) };
            if result == WAIT_OBJECT_0 {
                return Ok(true);
            }
            if result == WAIT_TIMEOUT {
                return Ok(false);
            }
            if result == WAIT_FAILED {
                let error = unsafe { GetLastError() };
                return Err(WasapiCaptureError::Backend(format!(
                    "WaitForSingleObject failed with Win32 error {}",
                    error.0
                )));
            }
            Err(WasapiCaptureError::Backend(format!(
                "unexpected WaitForSingleObject result: {}",
                result.0
            )))
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
        event: OwnedEvent,
        block_align: u16,
        _apartment: ComApartment,
    }

    impl Session {
        pub fn start(&self) -> Result<(), WasapiCaptureError> {
            unsafe { self.audio_client.Start().map_err(backend_error) }
        }

        pub fn stop(&self) -> Result<(), WasapiCaptureError> {
            unsafe { self.audio_client.Stop().map_err(backend_error) }
        }

        pub fn wait_for_packet_event(&self, timeout_ms: u32) -> Result<bool, WasapiCaptureError> {
            self.event.wait(timeout_ms)
        }

        pub fn next_packet_frames(&self) -> Result<u32, WasapiCaptureError> {
            unsafe {
                self.capture_client
                    .GetNextPacketSize()
                    .map_err(backend_error)
            }
        }

        pub fn read_packet(&self) -> Result<Option<CapturedPacket>, WasapiCaptureError> {
            if self.next_packet_frames()? == 0 {
                return Ok(None);
            }

            let mut data = null_mut();
            let mut frames = 0u32;
            let mut raw_flags = 0u32;
            let mut device_position_frames = 0u64;
            let mut qpc_position_100ns = 0u64;

            unsafe {
                self.capture_client.GetBuffer(
                    &mut data,
                    &mut frames,
                    &mut raw_flags,
                    Some(&mut device_position_frames),
                    Some(&mut qpc_position_100ns),
                )
            }
            .map_err(backend_error)?;

            if frames == 0 {
                unsafe {
                    self.capture_client
                        .ReleaseBuffer(0)
                        .map_err(backend_error)?
                };
                return Ok(None);
            }

            let flags = CapturePacketFlags::from_raw(raw_flags);
            let byte_len = usize::try_from(frames)
                .ok()
                .and_then(|count| count.checked_mul(usize::from(self.block_align)))
                .ok_or(WasapiCaptureError::PacketSizeOverflow {
                    frames,
                    block_align: self.block_align,
                });

            let packet = byte_len.and_then(|byte_len| {
                let bytes = if flags.silent {
                    vec![0; byte_len]
                } else {
                    let pointer =
                        NonNull::new(data).ok_or(WasapiCaptureError::NullPacketData { frames })?;
                    unsafe { slice::from_raw_parts(pointer.as_ptr(), byte_len) }.to_vec()
                };

                Ok(CapturedPacket {
                    frames,
                    bytes,
                    flags,
                    device_position_frames,
                    qpc_position_100ns,
                })
            });

            unsafe {
                self.capture_client
                    .ReleaseBuffer(frames)
                    .map_err(backend_error)?
            };
            packet.map(Some)
        }
    }

    pub fn open_default(
        frame_duration_ms: u16,
    ) -> Result<Option<(Session, CaptureSessionSummary)>, WasapiCaptureError> {
        let apartment = ComApartment::initialize_sta()?;
        let enumerator: IMMDeviceEnumerator = unsafe {
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(backend_error)?
        };
        let device = match unsafe { enumerator.GetDefaultAudioEndpoint(eCapture, eCommunications) }
        {
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
        if wave.nBlockAlign == 0 {
            return Err(WasapiCaptureError::InvalidMixFormat(
                "block alignment must be greater than zero",
            ));
        }

        let sample_encoding =
            wave_format_descriptor(mix_format.as_ptr(), wave)?.native_sample_encoding()?;
        let decoder = SampleDecoder::new(sample_encoding, wave.nChannels)?;
        if decoder.frame_bytes() != usize::from(wave.nBlockAlign) {
            return Err(WasapiCaptureError::BlockAlignMismatch {
                declared: wave.nBlockAlign,
                expected: decoder.frame_bytes(),
            });
        }

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

        let periods =
            EnginePeriodRange::new(default_frames, fundamental_frames, min_frames, max_frames)
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
        unsafe {
            audio_client
                .SetEventHandle(event.handle())
                .map_err(backend_error)?
        };
        let capture_client: IAudioCaptureClient =
            unsafe { audio_client.GetService().map_err(backend_error)? };
        let endpoint_buffer_frames =
            unsafe { audio_client.GetBufferSize().map_err(backend_error)? };
        let stream_latency_100ns =
            unsafe { audio_client.GetStreamLatency().map_err(backend_error)? };

        let summary = CaptureSessionSummary {
            endpoint_id,
            mix_format: MixFormatSummary {
                sample_rate_hz: wave.nSamplesPerSec,
                channels: wave.nChannels,
                bits_per_sample: wave.wBitsPerSample,
                block_align: wave.nBlockAlign,
            },
            sample_encoding,
            plan,
            endpoint_buffer_frames,
            stream_latency_100ns,
        };
        let session = Session {
            audio_client,
            capture_client,
            event,
            block_align: wave.nBlockAlign,
            _apartment: apartment,
        };

        Ok(Some((session, summary)))
    }

    fn wave_format_descriptor(
        mix_format: *const WAVEFORMATEX,
        wave: WAVEFORMATEX,
    ) -> Result<WaveFormatDescriptor, WasapiCaptureError> {
        let extensible = if wave.wFormatTag == WAVE_FORMAT_EXTENSIBLE_TAG
            && wave.cbSize >= crate::wave_format::WAVE_FORMAT_EXTENSIBLE_EXTRA_BYTES
        {
            let format_ptr = mix_format.cast::<WAVEFORMATEXTENSIBLE>();
            let samples = unsafe { read_unaligned(addr_of!((*format_ptr).Samples)) };
            let sub_format = unsafe { read_unaligned(addr_of!((*format_ptr).SubFormat)) };
            Some(ExtensibleWaveFormat {
                valid_bits_per_sample: unsafe { samples.wValidBitsPerSample },
                sub_format_guid: sub_format.to_u128(),
            })
        } else {
            None
        };

        Ok(WaveFormatDescriptor {
            format_tag: wave.wFormatTag,
            bits_per_sample: wave.wBitsPerSample,
            extra_size: wave.cbSize,
            extensible,
        })
    }

    fn device_id(
        device: &windows::Win32::Media::Audio::IMMDevice,
    ) -> Result<String, WasapiCaptureError> {
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

    #[test]
    fn packet_flags_decode_wasapi_bits() {
        let flags = CapturePacketFlags::from_raw(
            BUFFERFLAG_SILENT | BUFFERFLAG_DATA_DISCONTINUITY | BUFFERFLAG_TIMESTAMP_ERROR,
        );

        assert!(flags.silent);
        assert!(flags.data_discontinuity);
        assert!(flags.timestamp_error);
        assert_eq!(
            CapturePacketFlags::from_raw(0),
            CapturePacketFlags::default()
        );
    }

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
            assert!(summary.mix_format.block_align > 0);
            let decoder = SampleDecoder::new(summary.sample_encoding, summary.mix_format.channels)
                .expect("mix format should create native decoder");
            assert_eq!(
                decoder.frame_bytes(),
                usize::from(summary.mix_format.block_align)
            );
            assert!(summary.endpoint_buffer_frames > 0);
            assert!(summary.plan.engine_period_frames > 0);
            assert!(!session.is_started());
            assert!(matches!(
                session.wait_for_packet_event(0),
                Err(WasapiCaptureError::SessionNotStarted)
            ));
            assert!(matches!(
                session.read_packet(),
                Err(WasapiCaptureError::SessionNotStarted)
            ));
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
        session
            .start()
            .expect("repeated start should be idempotent");
        let _ = session.wait_for_packet_event(0);
        let _ = session.next_packet_frames();
        session.stop().expect("WASAPI capture stream should stop");
        assert!(!session.is_started());
        session.stop().expect("repeated stop should be idempotent");
    }
}
