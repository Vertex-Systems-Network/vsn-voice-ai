#include <ntifs.h>
#include <portcls.h>
#include <ksmedia.h>
#pragma warning(push)
#pragma warning(disable : 4996)
#include <stdunk.h>
#pragma warning(pop)

#include "../include/vsn_virtual_mic_transport_bridge.h"
#include "../include/vsn_virtual_mic_wavert_contract.h"
#include "../include/vsn_virtual_mic_wavert_scheduler.h"
#include "../include/vsn_virtual_mic_wavert_stream.h"
#include "../include/vsn_virtual_mic_wavert_stream_contract.h"

extern "C" const KSDATAFORMAT_WAVEFORMATEXTENSIBLE* VsnVirtualMicCaptureFormat() noexcept;

namespace {

using namespace vsn::virtual_mic;

constexpr ULONG kVsnWaveRtStreamPoolTag = 'SnSV';
constexpr ULONG kVsnWaveRtSchedulerPoolTag = 'FnSV';
constexpr LONGLONG kVsnWaveRtSchedulerPeriod100ns =
    static_cast<LONGLONG>(kWaveRtSchedulerFrameDurationMicros) * 10LL;

static_assert(kVsnWaveRtSchedulerPeriod100ns == 100'000LL, "10 ms scheduler period drifted");
static_assert(kVsnWaveRtSchedulerPeriod100ns <= MAXLONG, "scheduler period exceeds EX_TIMER limit");

EXT_CALLBACK VsnWaveRtSchedulerTimer;

bool EqualGuid(const GUID& left, const GUID& right) noexcept {
    return IsEqualGUIDAligned(left, right) != FALSE;
}

bool IsSupportedCaptureFormat(PKSDATAFORMAT data_format) noexcept {
    if (data_format == nullptr ||
        data_format->FormatSize < sizeof(KSDATAFORMAT_WAVEFORMATEXTENSIBLE) ||
        !EqualGuid(data_format->MajorFormat, KSDATAFORMAT_TYPE_AUDIO) ||
        !EqualGuid(data_format->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) ||
        !EqualGuid(data_format->Specifier, KSDATAFORMAT_SPECIFIER_WAVEFORMATEX)) {
        return false;
    }

    const auto* requested =
        reinterpret_cast<const KSDATAFORMAT_WAVEFORMATEXTENSIBLE*>(data_format);
    const auto* supported = VsnVirtualMicCaptureFormat();
    if (supported == nullptr) {
        return false;
    }

    const WAVEFORMATEX& request_wave = requested->WaveFormatExt.Format;
    const WAVEFORMATEX& supported_wave = supported->WaveFormatExt.Format;
    return request_wave.wFormatTag == supported_wave.wFormatTag &&
           request_wave.nChannels == supported_wave.nChannels &&
           request_wave.nSamplesPerSec == supported_wave.nSamplesPerSec &&
           request_wave.nAvgBytesPerSec == supported_wave.nAvgBytesPerSec &&
           request_wave.nBlockAlign == supported_wave.nBlockAlign &&
           request_wave.wBitsPerSample == supported_wave.wBitsPerSample &&
           request_wave.cbSize == supported_wave.cbSize &&
           requested->WaveFormatExt.Samples.wValidBitsPerSample ==
               supported->WaveFormatExt.Samples.wValidBitsPerSample &&
           requested->WaveFormatExt.dwChannelMask == supported->WaveFormatExt.dwChannelMask &&
           EqualGuid(requested->WaveFormatExt.SubFormat, supported->WaveFormatExt.SubFormat);
}

WaveRtStreamState ToRuntimeState(KSSTATE state) noexcept {
    switch (state) {
        case KSSTATE_STOP:
            return WaveRtStreamState::kStop;
        case KSSTATE_ACQUIRE:
            return WaveRtStreamState::kAcquire;
        case KSSTATE_PAUSE:
            return WaveRtStreamState::kPause;
        case KSSTATE_RUN:
            return WaveRtStreamState::kRun;
        default:
            return static_cast<WaveRtStreamState>(UINT32_MAX);
    }
}

class VsnVirtualMicWaveRtStream final :
    public IMiniportWaveRTStreamNotification,
    public CUnknown {
public:
    DECLARE_STD_UNKNOWN();
    IMP_IMiniportWaveRTStream;
    IMP_IMiniportWaveRTStreamNotification;

    VsnVirtualMicWaveRtStream(
        PUNKNOWN unknown_outer,
        PPORTWAVERTSTREAM port_stream) noexcept
        : CUnknown(unknown_outer),
          port_stream_(port_stream),
          buffer_mdl_(nullptr),
          buffer_(nullptr),
          buffer_size_(0),
          notifications_per_buffer_(0),
          notification_event_(nullptr),
          scheduler_timer_(nullptr),
          scheduler_frame_(nullptr),
          scheduler_started_(FALSE),
          runtime_{} {
        KeInitializeSpinLock(&lock_);
        if (port_stream_ != nullptr) {
            port_stream_->AddRef();
        }
    }

    ~VsnVirtualMicWaveRtStream() override {
        ShutdownScheduler();

        if (buffer_mdl_ != nullptr) {
            if (buffer_ != nullptr) {
                port_stream_->UnmapAllocatedPages(buffer_, buffer_mdl_);
                buffer_ = nullptr;
            }
            port_stream_->FreePagesFromMdl(buffer_mdl_);
            buffer_mdl_ = nullptr;
        }
        if (port_stream_ != nullptr) {
            port_stream_->Release();
            port_stream_ = nullptr;
        }
    }

    static void* operator new(size_t size) noexcept {
        return ExAllocatePool2(POOL_FLAG_NON_PAGED, size, kVsnWaveRtStreamPoolTag);
    }

    static void operator delete(void* memory) noexcept {
        if (memory != nullptr) {
            ExFreePoolWithTag(memory, kVsnWaveRtStreamPoolTag);
        }
    }

    static void operator delete(void* memory, size_t) noexcept {
        operator delete(memory);
    }

    NTSTATUS InitializeScheduler() noexcept;
    void OnSchedulerTick() noexcept;

private:
    void CancelSchedulerAndFlush() noexcept;
    void ShutdownScheduler() noexcept;

    PPORTWAVERTSTREAM port_stream_;
    PMDL buffer_mdl_;
    BYTE* buffer_;
    ULONG buffer_size_;
    ULONG notifications_per_buffer_;
    PKEVENT notification_event_;
    PEX_TIMER scheduler_timer_;
    BYTE* scheduler_frame_;
    BOOLEAN scheduler_started_;
    KSPIN_LOCK lock_;
    WaveRtStreamRuntime runtime_;
};

#pragma code_seg("PAGE")
NTSTATUS VsnVirtualMicWaveRtStream::InitializeScheduler() noexcept {
    PAGED_CODE();

    if (scheduler_timer_ != nullptr || scheduler_frame_ != nullptr) {
        return STATUS_INVALID_DEVICE_STATE;
    }

    scheduler_timer_ = ExAllocateTimer(
        VsnWaveRtSchedulerTimer,
        this,
        EX_TIMER_HIGH_RESOLUTION);
    if (scheduler_timer_ == nullptr) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    scheduler_frame_ = static_cast<BYTE*>(ExAllocatePool2(
        POOL_FLAG_NON_PAGED,
        kWaveRtSchedulerFrameBytes,
        kVsnWaveRtSchedulerPoolTag));
    if (scheduler_frame_ == nullptr) {
        ExDeleteTimer(scheduler_timer_, TRUE, TRUE, nullptr);
        scheduler_timer_ = nullptr;
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    RtlZeroMemory(scheduler_frame_, kWaveRtSchedulerFrameBytes);
    return STATUS_SUCCESS;
}
#pragma code_seg()

void VsnVirtualMicWaveRtStream::CancelSchedulerAndFlush() noexcept {
    BOOLEAN should_cancel = FALSE;

    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    should_cancel = scheduler_started_;
    scheduler_started_ = FALSE;
    KeReleaseSpinLock(&lock_, old_irql);

    if (should_cancel != FALSE && scheduler_timer_ != nullptr) {
        ExCancelTimer(scheduler_timer_, nullptr);
        KeFlushQueuedDpcs();
    }
}

void VsnVirtualMicWaveRtStream::ShutdownScheduler() noexcept {
    NT_ASSERT(KeGetCurrentIrql() <= APC_LEVEL);

    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    scheduler_started_ = FALSE;
    KeReleaseSpinLock(&lock_, old_irql);

    if (scheduler_timer_ != nullptr) {
        ExDeleteTimer(scheduler_timer_, TRUE, TRUE, nullptr);
        scheduler_timer_ = nullptr;
    }
    if (scheduler_frame_ != nullptr) {
        ExFreePoolWithTag(scheduler_frame_, kVsnWaveRtSchedulerPoolTag);
        scheduler_frame_ = nullptr;
    }
}

void VsnVirtualMicWaveRtStream::OnSchedulerTick() noexcept {
    KeAcquireSpinLockAtDpcLevel(&lock_);

    if (scheduler_started_ == FALSE ||
        runtime_.state != WaveRtStreamState::kRun ||
        buffer_ == nullptr ||
        buffer_size_ < kWaveRtSchedulerFrameBytes ||
        scheduler_frame_ == nullptr) {
        KeReleaseSpinLockFromDpcLevel(&lock_);
        return;
    }

    // Always clear the scratch frame before crossing the transport boundary so
    // every failure mode is silence, never bytes retained from a prior tick.
    RtlZeroMemory(scheduler_frame_, kWaveRtSchedulerFrameBytes);
    RingConsumeResult consume_result{};
    const TransportBridgeStatus consume_status = VsnWdmControlConsumeFrame(
        scheduler_frame_,
        kWaveRtSchedulerFrameBytes,
        &consume_result);
    UNREFERENCED_PARAMETER(consume_result);
    if (consume_status != TransportBridgeStatus::kOk &&
        consume_status != TransportBridgeStatus::kSilence &&
        consume_status != TransportBridgeStatus::kUnavailable) {
        RtlZeroMemory(scheduler_frame_, kWaveRtSchedulerFrameBytes);
    }

    CyclicWritePlan write_plan{};
    if (PlanWaveRtCyclicWrite(
            buffer_size_,
            runtime_.cyclic_position_bytes,
            kWaveRtSchedulerFrameBytes,
            &write_plan) != WaveRtSchedulerStatus::kOk) {
        KeReleaseSpinLockFromDpcLevel(&lock_);
        return;
    }

    RtlCopyMemory(
        buffer_ + static_cast<SIZE_T>(write_plan.first_offset),
        scheduler_frame_,
        static_cast<SIZE_T>(write_plan.first_bytes));
    if (write_plan.second_bytes != 0u) {
        RtlCopyMemory(
            buffer_ + static_cast<SIZE_T>(write_plan.second_offset),
            scheduler_frame_ + static_cast<SIZE_T>(write_plan.first_bytes),
            static_cast<SIZE_T>(write_plan.second_bytes));
    }

    uint64_t notifications_due = 0u;
    const WaveRtStreamStatus advance_status = AdvanceWaveRtCapturePosition(
        &runtime_,
        kWaveRtSchedulerFrameBytes,
        &notifications_due);
    if (advance_status == WaveRtStreamStatus::kOk &&
        notifications_due != 0u &&
        notification_event_ != nullptr) {
        KeSetEvent(notification_event_, IO_NO_INCREMENT, FALSE);
    }

    KeReleaseSpinLockFromDpcLevel(&lock_);
}

_Use_decl_annotations_
VOID VsnWaveRtSchedulerTimer(
    PEX_TIMER timer,
    PVOID context) {
    UNREFERENCED_PARAMETER(timer);

    auto* stream = static_cast<VsnVirtualMicWaveRtStream*>(context);
    if (stream != nullptr) {
        stream->OnSchedulerTick();
    }
}

#pragma code_seg("PAGE")
STDMETHODIMP VsnVirtualMicWaveRtStream::NonDelegatingQueryInterface(
    REFIID interface_id,
    PVOID* object) {
    PAGED_CODE();

    if (object == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    *object = nullptr;

    if (IsEqualGUIDAligned(interface_id, IID_IUnknown)) {
        *object = PVOID(PUNKNOWN(PMINIPORTWAVERTSTREAM(this)));
    } else if (IsEqualGUIDAligned(interface_id, IID_IMiniportWaveRTStream)) {
        *object = PVOID(PMINIPORTWAVERTSTREAM(this));
    } else if (IsEqualGUIDAligned(interface_id, IID_IMiniportWaveRTStreamNotification)) {
        *object = PVOID(PMINIPORTWAVERTSTREAMNOTIFICATION(this));
    } else {
        return STATUS_INVALID_PARAMETER;
    }

    PUNKNOWN(*object)->AddRef();
    return STATUS_SUCCESS;
}

STDMETHODIMP VsnVirtualMicWaveRtStream::AllocateAudioBuffer(
    ULONG requested_size,
    PMDL* audio_buffer_mdl,
    ULONG* actual_size,
    ULONG* offset_from_first_page,
    MEMORY_CACHING_TYPE* cache_type) {
    PAGED_CODE();

    if (audio_buffer_mdl == nullptr || actual_size == nullptr ||
        offset_from_first_page == nullptr || cache_type == nullptr ||
        requested_size < kWaveRtSchedulerFrameBytes || buffer_mdl_ != nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    requested_size -= requested_size % kWaveRtBlockAlign;
    if (requested_size < kWaveRtSchedulerFrameBytes) {
        return STATUS_INVALID_PARAMETER;
    }

    PHYSICAL_ADDRESS high_address{};
    high_address.HighPart = 0;
    high_address.LowPart = MAXULONG;

    PMDL mdl = port_stream_->AllocatePagesForMdl(high_address, requested_size);
    if (mdl == nullptr) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    BYTE* mapped = static_cast<BYTE*>(port_stream_->MapAllocatedPages(mdl, MmCached));
    if (mapped == nullptr) {
        port_stream_->FreePagesFromMdl(mdl);
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    RtlZeroMemory(mapped, requested_size);

    WaveRtStreamRuntime initialized{};
    const WaveRtStreamStatus init_status = InitializeWaveRtStreamRuntime(
        &initialized,
        requested_size,
        kWaveRtBlockAlign,
        requested_size);
    if (init_status != WaveRtStreamStatus::kOk) {
        port_stream_->UnmapAllocatedPages(mapped, mdl);
        port_stream_->FreePagesFromMdl(mdl);
        return STATUS_INVALID_PARAMETER;
    }

    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    buffer_mdl_ = mdl;
    buffer_ = mapped;
    buffer_size_ = requested_size;
    notifications_per_buffer_ = 0u;
    runtime_ = initialized;
    KeReleaseSpinLock(&lock_, old_irql);

    *audio_buffer_mdl = mdl;
    *actual_size = requested_size;
    *offset_from_first_page = 0u;
    *cache_type = MmCached;
    return STATUS_SUCCESS;
}

STDMETHODIMP_(VOID) VsnVirtualMicWaveRtStream::FreeAudioBuffer(
    PMDL mdl,
    ULONG size) {
    PAGED_CODE();
    UNREFERENCED_PARAMETER(size);

    if (mdl == nullptr) {
        return;
    }

    CancelSchedulerAndFlush();

    BYTE* mapped = nullptr;
    PMDL owned_mdl = nullptr;
    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    if (mdl == buffer_mdl_) {
        mapped = buffer_;
        owned_mdl = buffer_mdl_;
        buffer_ = nullptr;
        buffer_mdl_ = nullptr;
        buffer_size_ = 0u;
        notifications_per_buffer_ = 0u;
        notification_event_ = nullptr;
        RtlZeroMemory(&runtime_, sizeof(runtime_));
    }
    KeReleaseSpinLock(&lock_, old_irql);

    if (owned_mdl == nullptr) {
        return;
    }
    if (mapped != nullptr) {
        port_stream_->UnmapAllocatedPages(mapped, owned_mdl);
    }
    port_stream_->FreePagesFromMdl(owned_mdl);
}

STDMETHODIMP VsnVirtualMicWaveRtStream::AllocateBufferWithNotification(
    ULONG notification_count,
    ULONG requested_size,
    PMDL* audio_buffer_mdl,
    ULONG* actual_size,
    ULONG* offset_from_first_page,
    MEMORY_CACHING_TYPE* cache_type) {
    PAGED_CODE();

    if (notification_count == 0u ||
        requested_size < kWaveRtSchedulerFrameBytes ||
        requested_size % notification_count != 0u ||
        requested_size % kWaveRtBlockAlign != 0u ||
        buffer_mdl_ != nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    const ULONG notification_bytes = requested_size / notification_count;
    if (ValidateWaveRtStreamGeometry(
            requested_size,
            kWaveRtBlockAlign,
            notification_bytes) != WaveRtStreamStatus::kOk) {
        return STATUS_INVALID_PARAMETER;
    }

    NTSTATUS status = AllocateAudioBuffer(
        requested_size,
        audio_buffer_mdl,
        actual_size,
        offset_from_first_page,
        cache_type);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    WaveRtStreamRuntime initialized{};
    if (InitializeWaveRtStreamRuntime(
            &initialized,
            *actual_size,
            kWaveRtBlockAlign,
            notification_bytes) != WaveRtStreamStatus::kOk) {
        FreeAudioBuffer(*audio_buffer_mdl, *actual_size);
        *audio_buffer_mdl = nullptr;
        *actual_size = 0u;
        return STATUS_INVALID_PARAMETER;
    }

    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    runtime_ = initialized;
    notifications_per_buffer_ = notification_count;
    KeReleaseSpinLock(&lock_, old_irql);
    return STATUS_SUCCESS;
}

STDMETHODIMP_(VOID) VsnVirtualMicWaveRtStream::FreeBufferWithNotification(
    PMDL mdl,
    ULONG size) {
    PAGED_CODE();
    FreeAudioBuffer(mdl, size);
}

STDMETHODIMP VsnVirtualMicWaveRtStream::RegisterNotificationEvent(
    PKEVENT notification_event) {
    PAGED_CODE();

    if (notification_event == nullptr || notifications_per_buffer_ == 0u) {
        return STATUS_INVALID_PARAMETER;
    }

    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    const NTSTATUS status = notification_event_ == nullptr
        ? STATUS_SUCCESS
        : (notification_event_ == notification_event ? STATUS_OBJECT_NAME_EXISTS : STATUS_DEVICE_BUSY);
    if (NT_SUCCESS(status)) {
        notification_event_ = notification_event;
    }
    KeReleaseSpinLock(&lock_, old_irql);
    return status;
}

STDMETHODIMP VsnVirtualMicWaveRtStream::UnregisterNotificationEvent(
    PKEVENT notification_event) {
    PAGED_CODE();

    if (notification_event == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    NTSTATUS status = STATUS_NOT_FOUND;
    if (notification_event_ == notification_event) {
        notification_event_ = nullptr;
        status = STATUS_SUCCESS;
    }
    KeReleaseSpinLock(&lock_, old_irql);
    return status;
}

STDMETHODIMP VsnVirtualMicWaveRtStream::GetClockRegister(
    PKSRTAUDIO_HWREGISTER register_description) {
    PAGED_CODE();
    UNREFERENCED_PARAMETER(register_description);
    return STATUS_NOT_IMPLEMENTED;
}

STDMETHODIMP VsnVirtualMicWaveRtStream::GetPositionRegister(
    PKSRTAUDIO_HWREGISTER register_description) {
    PAGED_CODE();
    UNREFERENCED_PARAMETER(register_description);
    return STATUS_NOT_IMPLEMENTED;
}

STDMETHODIMP_(VOID) VsnVirtualMicWaveRtStream::GetHWLatency(
    PKSRTAUDIO_HWLATENCY latency) {
    PAGED_CODE();
    if (latency != nullptr) {
        latency->ChipsetDelay = 0u;
        latency->CodecDelay = 0u;
        latency->FifoSize = 0u;
    }
}

STDMETHODIMP VsnVirtualMicWaveRtStream::SetFormat(PKSDATAFORMAT data_format) {
    PAGED_CODE();

    if (!IsSupportedCaptureFormat(data_format)) {
        return STATUS_NOT_SUPPORTED;
    }

    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    const bool stopped = runtime_.state == WaveRtStreamState::kStop;
    KeReleaseSpinLock(&lock_, old_irql);
    return stopped ? STATUS_SUCCESS : STATUS_INVALID_DEVICE_STATE;
}
#pragma code_seg()

STDMETHODIMP VsnVirtualMicWaveRtStream::SetState(KSSTATE state) {
    if (KeGetCurrentIrql() != PASSIVE_LEVEL) {
        return STATUS_INVALID_DEVICE_STATE;
    }

    const WaveRtStreamState next_state = ToRuntimeState(state);
    if (!IsValidWaveRtStreamState(next_state)) {
        return STATUS_INVALID_PARAMETER;
    }

    WaveRtStreamState current_state = WaveRtStreamState::kStop;
    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    current_state = runtime_.state;
    const bool buffer_ready = buffer_mdl_ != nullptr &&
        buffer_ != nullptr &&
        buffer_size_ >= kWaveRtSchedulerFrameBytes;
    const bool transition_allowed = IsAllowedWaveRtTransition(current_state, next_state);
    KeReleaseSpinLock(&lock_, old_irql);

    if (next_state != WaveRtStreamState::kStop && !buffer_ready) {
        return STATUS_INVALID_DEVICE_STATE;
    }
    if (!transition_allowed) {
        return STATUS_INVALID_DEVICE_STATE;
    }

    if (current_state == WaveRtStreamState::kRun && next_state != WaveRtStreamState::kRun) {
        CancelSchedulerAndFlush();
    }

    bool start_scheduler = false;
    KeAcquireSpinLock(&lock_, &old_irql);
    NTSTATUS status = STATUS_SUCCESS;
    if (SetWaveRtStreamState(&runtime_, next_state) != WaveRtStreamStatus::kOk) {
        status = STATUS_INVALID_DEVICE_STATE;
    } else if (current_state != WaveRtStreamState::kRun &&
               next_state == WaveRtStreamState::kRun) {
        if (scheduler_timer_ == nullptr || scheduler_frame_ == nullptr) {
            status = STATUS_INVALID_DEVICE_STATE;
            runtime_.state = current_state;
        } else {
            scheduler_started_ = TRUE;
            start_scheduler = true;
        }
    }
    KeReleaseSpinLock(&lock_, old_irql);

    if (NT_SUCCESS(status) && start_scheduler) {
        ExSetTimer(
            scheduler_timer_,
            -kVsnWaveRtSchedulerPeriod100ns,
            kVsnWaveRtSchedulerPeriod100ns,
            nullptr);
    }
    return status;
}

STDMETHODIMP VsnVirtualMicWaveRtStream::GetPosition(KSAUDIO_POSITION* position) {
    if (position == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    KIRQL old_irql;
    KeAcquireSpinLock(&lock_, &old_irql);
    position->PlayOffset = runtime_.cyclic_position_bytes;
    position->WriteOffset = runtime_.cyclic_position_bytes;
    KeReleaseSpinLock(&lock_, old_irql);
    return STATUS_SUCCESS;
}

} // namespace

#pragma code_seg("PAGE")
extern "C" NTSTATUS VsnCreateVirtualMicWaveRtStream(
    PMINIPORTWAVERTSTREAM* out_stream,
    PUNKNOWN unknown_outer,
    PPORTWAVERTSTREAM port_stream,
    PKSDATAFORMAT data_format) noexcept {
    PAGED_CODE();

    if (out_stream == nullptr || port_stream == nullptr ||
        !IsSupportedCaptureFormat(data_format)) {
        return STATUS_INVALID_PARAMETER;
    }
    *out_stream = nullptr;

    auto* stream = new VsnVirtualMicWaveRtStream(unknown_outer, port_stream);
    if (stream == nullptr) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    NTSTATUS status = stream->InitializeScheduler();
    if (!NT_SUCCESS(status)) {
        delete stream;
        return status;
    }

    stream->AddRef();
    *out_stream = PMINIPORTWAVERTSTREAM(stream);
    return STATUS_SUCCESS;
}
#pragma code_seg()
