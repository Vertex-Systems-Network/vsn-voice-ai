use std::error::Error;
use std::fmt::{Display, Formatter};

use crate::frame_assembler::{
    CaptureFrameAssembler, CaptureFrameAssemblyError, CapturedAudioFrame,
};
use crate::wasapi_capture::{
    CaptureSessionSummary, CapturedPacket, EventCaptureSession, WasapiCaptureError,
};

pub const DEFAULT_MAX_PACKETS_PER_DRAIN: usize = 64;

pub trait CapturePacketSource {
    fn summary(&self) -> &CaptureSessionSummary;

    fn is_started(&self) -> bool;

    fn start(&mut self) -> Result<(), WasapiCaptureError>;

    fn stop(&mut self) -> Result<(), WasapiCaptureError>;

    fn wait_for_packet_event(&self, timeout_ms: u32) -> Result<bool, WasapiCaptureError>;

    fn next_packet_frames(&self) -> Result<u32, WasapiCaptureError>;

    fn read_packet(&self) -> Result<Option<CapturedPacket>, WasapiCaptureError>;
}

impl CapturePacketSource for EventCaptureSession {
    fn summary(&self) -> &CaptureSessionSummary {
        EventCaptureSession::summary(self)
    }

    fn is_started(&self) -> bool {
        EventCaptureSession::is_started(self)
    }

    fn start(&mut self) -> Result<(), WasapiCaptureError> {
        EventCaptureSession::start(self)
    }

    fn stop(&mut self) -> Result<(), WasapiCaptureError> {
        EventCaptureSession::stop(self)
    }

    fn wait_for_packet_event(&self, timeout_ms: u32) -> Result<bool, WasapiCaptureError> {
        EventCaptureSession::wait_for_packet_event(self, timeout_ms)
    }

    fn next_packet_frames(&self) -> Result<u32, WasapiCaptureError> {
        EventCaptureSession::next_packet_frames(self)
    }

    fn read_packet(&self) -> Result<Option<CapturedPacket>, WasapiCaptureError> {
        EventCaptureSession::read_packet(self)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CaptureDrain {
    pub event_signaled: bool,
    pub packets_consumed: usize,
    pub frames: Vec<CapturedAudioFrame>,
    pub queue_drained: bool,
    pub hit_packet_budget: bool,
}

impl CaptureDrain {
    fn timeout() -> Self {
        Self {
            event_signaled: false,
            packets_consumed: 0,
            frames: Vec::new(),
            queue_drained: true,
            hit_packet_budget: false,
        }
    }
}

pub struct CapturePump<S> {
    source: S,
    assembler: CaptureFrameAssembler,
    max_packets_per_drain: usize,
}

impl<S> CapturePump<S>
where
    S: CapturePacketSource,
{
    pub fn new(
        source: S,
        initial_sequence: u64,
        max_packets_per_drain: usize,
    ) -> Result<Self, CapturePumpError> {
        if max_packets_per_drain == 0 {
            return Err(CapturePumpError::PacketBudgetZero);
        }

        let summary = source.summary();
        let assembler = CaptureFrameAssembler::new(
            summary.plan,
            summary.mix_format.block_align,
            summary.sample_encoding,
            initial_sequence,
        )?;

        Ok(Self {
            source,
            assembler,
            max_packets_per_drain,
        })
    }

    pub fn source(&self) -> &S {
        &self.source
    }

    pub fn source_mut(&mut self) -> &mut S {
        &mut self.source
    }

    pub fn into_source(self) -> S {
        self.source
    }

    pub fn is_started(&self) -> bool {
        self.source.is_started()
    }

    pub fn next_sequence(&self) -> u64 {
        self.assembler.next_sequence()
    }

    pub fn pending_frames(&self) -> u64 {
        self.assembler.pending_frames()
    }

    pub fn max_packets_per_drain(&self) -> usize {
        self.max_packets_per_drain
    }

    pub fn start(&mut self) -> Result<(), CapturePumpError> {
        self.source.start().map_err(CapturePumpError::from)
    }

    pub fn stop(&mut self) -> Result<(), CapturePumpError> {
        self.source.stop().map_err(CapturePumpError::from)
    }

    pub fn wait_and_drain(&mut self, timeout_ms: u32) -> Result<CaptureDrain, CapturePumpError> {
        if !self.source.wait_for_packet_event(timeout_ms)? {
            return Ok(CaptureDrain::timeout());
        }

        self.drain_available(true)
    }

    pub fn drain_available(&mut self, event_signaled: bool) -> Result<CaptureDrain, CapturePumpError> {
        let mut packets_consumed = 0usize;
        let mut frames = Vec::new();

        while packets_consumed < self.max_packets_per_drain {
            if self.source.next_packet_frames()? == 0 {
                return Ok(CaptureDrain {
                    event_signaled,
                    packets_consumed,
                    frames,
                    queue_drained: true,
                    hit_packet_budget: false,
                });
            }

            let packet = self.source.read_packet()?;
            packets_consumed += 1;
            if let Some(packet) = packet {
                frames.extend(self.assembler.push(packet)?);
            }
        }

        let queue_drained = self.source.next_packet_frames()? == 0;
        Ok(CaptureDrain {
            event_signaled,
            packets_consumed,
            frames,
            queue_drained,
            hit_packet_budget: !queue_drained,
        })
    }
}

impl CapturePump<EventCaptureSession> {
    pub fn open_default(
        frame_duration_ms: u16,
        initial_sequence: u64,
        max_packets_per_drain: usize,
    ) -> Result<Option<Self>, CapturePumpError> {
        let Some(session) = EventCaptureSession::open_default(frame_duration_ms)? else {
            return Ok(None);
        };

        Self::new(session, initial_sequence, max_packets_per_drain).map(Some)
    }

    pub fn open_default_with_standard_budget(
        frame_duration_ms: u16,
        initial_sequence: u64,
    ) -> Result<Option<Self>, CapturePumpError> {
        Self::open_default(
            frame_duration_ms,
            initial_sequence,
            DEFAULT_MAX_PACKETS_PER_DRAIN,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CapturePumpError {
    PacketBudgetZero,
    Capture(WasapiCaptureError),
    Assembly(CaptureFrameAssemblyError),
}

impl Display for CapturePumpError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PacketBudgetZero => f.write_str("capture pump packet budget must be greater than zero"),
            Self::Capture(error) => write!(f, "capture pump source failed: {error}"),
            Self::Assembly(error) => write!(f, "capture pump frame assembly failed: {error}"),
        }
    }
}

impl Error for CapturePumpError {}

impl From<WasapiCaptureError> for CapturePumpError {
    fn from(value: WasapiCaptureError) -> Self {
        Self::Capture(value)
    }
}

impl From<CaptureFrameAssemblyError> for CapturePumpError {
    fn from(value: CaptureFrameAssemblyError) -> Self {
        Self::Assembly(value)
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::VecDeque;

    use vsn_audio_core::AudioFormat;
    use vsn_audio_core::device::DeviceId;

    use super::*;
    use crate::MixFormatSummary;
    use crate::capture_plan::{CaptureCadence, SharedCapturePlan};
    use crate::sample_decode::NativeSampleEncoding;
    use crate::wasapi_capture::CapturePacketFlags;

    const FORMAT: AudioFormat = AudioFormat {
        sample_rate_hz: 400,
        channels: 1,
        frame_duration_ms: 10,
    };

    fn plan() -> SharedCapturePlan {
        SharedCapturePlan {
            format: FORMAT,
            pipeline_frames_per_channel: 4,
            pipeline_samples: 4,
            engine_period_frames: 2,
            cadence: CaptureCadence::Accumulate,
        }
    }

    fn summary() -> CaptureSessionSummary {
        CaptureSessionSummary {
            endpoint_id: DeviceId::new("test-mic").expect("valid test endpoint"),
            mix_format: MixFormatSummary {
                sample_rate_hz: FORMAT.sample_rate_hz,
                channels: FORMAT.channels,
                bits_per_sample: 16,
                block_align: 2,
            },
            sample_encoding: NativeSampleEncoding::Pcm {
                container_bits: 16,
                valid_bits: 16,
            },
            plan: plan(),
            endpoint_buffer_frames: 32,
            stream_latency_100ns: 100_000,
        }
    }

    fn packet(values: &[i16], position: u64) -> CapturedPacket {
        let mut bytes = Vec::with_capacity(values.len() * 2);
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        CapturedPacket {
            frames: values.len() as u32,
            bytes,
            flags: CapturePacketFlags::default(),
            device_position_frames: position,
            qpc_position_100ns: position * 10_000_000 / u64::from(FORMAT.sample_rate_hz),
        }
    }

    struct FakeSource {
        summary: CaptureSessionSummary,
        packets: RefCell<VecDeque<CapturedPacket>>,
        started: bool,
        event_signaled: bool,
        start_calls: usize,
        stop_calls: usize,
    }

    impl FakeSource {
        fn new(packets: Vec<CapturedPacket>, event_signaled: bool) -> Self {
            Self {
                summary: summary(),
                packets: RefCell::new(packets.into()),
                started: false,
                event_signaled,
                start_calls: 0,
                stop_calls: 0,
            }
        }
    }

    impl CapturePacketSource for FakeSource {
        fn summary(&self) -> &CaptureSessionSummary {
            &self.summary
        }

        fn is_started(&self) -> bool {
            self.started
        }

        fn start(&mut self) -> Result<(), WasapiCaptureError> {
            self.started = true;
            self.start_calls += 1;
            Ok(())
        }

        fn stop(&mut self) -> Result<(), WasapiCaptureError> {
            self.started = false;
            self.stop_calls += 1;
            Ok(())
        }

        fn wait_for_packet_event(&self, _timeout_ms: u32) -> Result<bool, WasapiCaptureError> {
            if !self.started {
                return Err(WasapiCaptureError::SessionNotStarted);
            }
            Ok(self.event_signaled)
        }

        fn next_packet_frames(&self) -> Result<u32, WasapiCaptureError> {
            if !self.started {
                return Err(WasapiCaptureError::SessionNotStarted);
            }
            Ok(self
                .packets
                .borrow()
                .front()
                .map(|packet| packet.frames)
                .unwrap_or(0))
        }

        fn read_packet(&self) -> Result<Option<CapturedPacket>, WasapiCaptureError> {
            if !self.started {
                return Err(WasapiCaptureError::SessionNotStarted);
            }
            Ok(self.packets.borrow_mut().pop_front())
        }
    }

    #[test]
    fn rejects_zero_packet_budget() {
        let error = CapturePump::new(FakeSource::new(Vec::new(), true), 0, 0)
            .err()
            .expect("zero packet budget should fail");

        assert_eq!(error, CapturePumpError::PacketBudgetZero);
    }

    #[test]
    fn timeout_returns_without_consuming_queued_packets() {
        let source = FakeSource::new(vec![packet(&[1, 2], 0)], false);
        let mut pump = CapturePump::new(source, 0, 8).expect("valid pump");
        pump.start().expect("fake source starts");

        let drain = pump.wait_and_drain(5).expect("timeout is not an error");

        assert!(!drain.event_signaled);
        assert_eq!(drain.packets_consumed, 0);
        assert!(drain.frames.is_empty());
        assert!(drain.queue_drained);
        assert!(!drain.hit_packet_budget);
        assert_eq!(pump.source().packets.borrow().len(), 1);
    }

    #[test]
    fn event_drains_all_available_packets_and_assembles_frames() {
        let source = FakeSource::new(
            vec![packet(&[0, 16_384], 0), packet(&[-16_384, 32_767], 2)],
            true,
        );
        let mut pump = CapturePump::new(source, 9, 8).expect("valid pump");
        pump.start().expect("fake source starts");

        let drain = pump.wait_and_drain(50).expect("event drain succeeds");

        assert!(drain.event_signaled);
        assert_eq!(drain.packets_consumed, 2);
        assert!(drain.queue_drained);
        assert!(!drain.hit_packet_budget);
        assert_eq!(drain.frames.len(), 1);
        assert_eq!(drain.frames[0].frame.sequence, 9);
        assert_eq!(drain.frames[0].frame.samples[1], 0.5);
        assert_eq!(drain.frames[0].frame.samples[2], -0.5);
        assert_eq!(pump.next_sequence(), 10);
        assert_eq!(pump.pending_frames(), 0);
    }

    #[test]
    fn packet_budget_bounds_one_drain_and_reports_backlog() {
        let source = FakeSource::new(
            vec![
                packet(&[1, 2], 0),
                packet(&[3, 4], 2),
                packet(&[5, 6], 4),
            ],
            true,
        );
        let mut pump = CapturePump::new(source, 0, 2).expect("valid pump");
        pump.start().expect("fake source starts");

        let first = pump.wait_and_drain(50).expect("first drain succeeds");
        assert_eq!(first.packets_consumed, 2);
        assert_eq!(first.frames.len(), 1);
        assert!(!first.queue_drained);
        assert!(first.hit_packet_budget);
        assert_eq!(pump.source().packets.borrow().len(), 1);

        let second = pump
            .drain_available(false)
            .expect("remaining packet drains");
        assert_eq!(second.packets_consumed, 1);
        assert!(second.queue_drained);
        assert!(!second.hit_packet_budget);
        assert_eq!(pump.pending_frames(), 2);
    }

    #[test]
    fn lifecycle_calls_are_forwarded_to_source() {
        let source = FakeSource::new(Vec::new(), false);
        let mut pump = CapturePump::new(source, 0, 8).expect("valid pump");

        assert!(!pump.is_started());
        pump.start().expect("start succeeds");
        assert!(pump.is_started());
        pump.stop().expect("stop succeeds");
        assert!(!pump.is_started());
        assert_eq!(pump.source().start_calls, 1);
        assert_eq!(pump.source().stop_calls, 1);
    }

    #[test]
    fn malformed_packet_propagates_frame_assembly_error() {
        let malformed = CapturedPacket {
            frames: 2,
            bytes: vec![0, 0],
            flags: CapturePacketFlags::default(),
            device_position_frames: 0,
            qpc_position_100ns: 0,
        };
        let source = FakeSource::new(vec![malformed], true);
        let mut pump = CapturePump::new(source, 0, 8).expect("valid pump");
        pump.start().expect("fake source starts");

        assert!(matches!(
            pump.wait_and_drain(50),
            Err(CapturePumpError::Assembly(_))
        ));
    }
}
