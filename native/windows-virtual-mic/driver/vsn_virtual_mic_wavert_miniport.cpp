#include <ntifs.h>
#include <portcls.h>
#include <ksmedia.h>
#pragma warning(push)
#pragma warning(disable : 4996)
#include <stdunk.h>
#pragma warning(pop)

#include "../include/vsn_virtual_mic_wavert_contract.h"
#include "../include/vsn_virtual_mic_wavert_miniport.h"

extern "C" const PCFILTER_DESCRIPTOR* VsnVirtualMicWaveFilterDescriptor() noexcept;
extern "C" const KSDATAFORMAT_WAVEFORMATEXTENSIBLE* VsnVirtualMicCaptureFormat() noexcept;

namespace {

using namespace vsn::virtual_mic;

constexpr ULONG kVsnWaveRtPoolTag = 'WnSV';
static_assert(kWaveRtMaxCaptureStreams == 1u, "minimal WaveRT miniport assumes one capture stream");

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

    const WAVEFORMATEX& requested_wave = requested->WaveFormatExt.Format;
    const WAVEFORMATEX& supported_wave = supported->WaveFormatExt.Format;

    return requested_wave.wFormatTag == supported_wave.wFormatTag &&
           requested_wave.nChannels == supported_wave.nChannels &&
           requested_wave.nSamplesPerSec == supported_wave.nSamplesPerSec &&
           requested_wave.nAvgBytesPerSec == supported_wave.nAvgBytesPerSec &&
           requested_wave.nBlockAlign == supported_wave.nBlockAlign &&
           requested_wave.wBitsPerSample == supported_wave.wBitsPerSample &&
           requested_wave.cbSize == supported_wave.cbSize &&
           requested->WaveFormatExt.Samples.wValidBitsPerSample ==
               supported->WaveFormatExt.Samples.wValidBitsPerSample &&
           requested->WaveFormatExt.dwChannelMask == supported->WaveFormatExt.dwChannelMask &&
           EqualGuid(requested->WaveFormatExt.SubFormat, supported->WaveFormatExt.SubFormat);
}

bool DataRangeCoversSupportedCapture(PKSDATARANGE range) noexcept {
    if (range == nullptr || range->FormatSize < sizeof(KSDATARANGE_AUDIO) ||
        !EqualGuid(range->MajorFormat, KSDATAFORMAT_TYPE_AUDIO) ||
        !EqualGuid(range->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) ||
        !EqualGuid(range->Specifier, KSDATAFORMAT_SPECIFIER_WAVEFORMATEX)) {
        return false;
    }

    const auto* audio = reinterpret_cast<const KSDATARANGE_AUDIO*>(range);
    return audio->MaximumChannels >= kWaveRtChannels &&
           audio->MinimumBitsPerSample <= kWaveRtBitsPerSample &&
           audio->MaximumBitsPerSample >= kWaveRtBitsPerSample &&
           audio->MinimumSampleFrequency <= kWaveRtSampleRateHz &&
           audio->MaximumSampleFrequency >= kWaveRtSampleRateHz;
}

class VsnVirtualMicWaveRtMiniport final :
    public IMiniportWaveRT,
    public CUnknown {
public:
    DECLARE_STD_UNKNOWN();
    IMP_IMiniportWaveRT;

    explicit VsnVirtualMicWaveRtMiniport(PUNKNOWN unknown_outer) noexcept
        : CUnknown(unknown_outer), stream_gate_(0) {}

    static void* operator new(size_t size) noexcept {
        return ExAllocatePool2(POOL_FLAG_NON_PAGED, size, kVsnWaveRtPoolTag);
    }

    static void operator delete(void* memory) noexcept {
        if (memory != nullptr) {
            ExFreePoolWithTag(memory, kVsnWaveRtPoolTag);
        }
    }

    static void operator delete(void* memory, size_t) noexcept {
        operator delete(memory);
    }

private:
    volatile LONG stream_gate_;
};

#pragma code_seg("PAGE")
STDMETHODIMP VsnVirtualMicWaveRtMiniport::NonDelegatingQueryInterface(
    REFIID interface_id,
    PVOID* object) {
    PAGED_CODE();

    if (object == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    *object = nullptr;

    if (IsEqualGUIDAligned(interface_id, IID_IUnknown)) {
        *object = PVOID(PUNKNOWN(PMINIPORTWAVERT(this)));
    } else if (IsEqualGUIDAligned(interface_id, IID_IMiniport)) {
        *object = PVOID(PMINIPORT(this));
    } else if (IsEqualGUIDAligned(interface_id, IID_IMiniportWaveRT)) {
        *object = PVOID(PMINIPORTWAVERT(this));
    } else {
        return STATUS_INVALID_PARAMETER;
    }

    PUNKNOWN(*object)->AddRef();
    return STATUS_SUCCESS;
}

STDMETHODIMP VsnVirtualMicWaveRtMiniport::DataRangeIntersection(
    ULONG pin_id,
    PKSDATARANGE client_data_range,
    PKSDATARANGE my_data_range,
    ULONG output_buffer_length,
    PVOID resultant_format,
    PULONG resultant_format_length) {
    PAGED_CODE();

    if (resultant_format_length == nullptr ||
        pin_id != kWaveRtWaveCapturePin ||
        !DataRangeCoversSupportedCapture(client_data_range) ||
        !DataRangeCoversSupportedCapture(my_data_range)) {
        return STATUS_NO_MATCH;
    }

    const ULONG required_size = sizeof(KSDATAFORMAT_WAVEFORMATEXTENSIBLE);
    *resultant_format_length = required_size;

    if (output_buffer_length == 0u) {
        return STATUS_BUFFER_OVERFLOW;
    }
    if (resultant_format == nullptr || output_buffer_length < required_size) {
        return STATUS_BUFFER_TOO_SMALL;
    }

    const auto* supported = VsnVirtualMicCaptureFormat();
    if (supported == nullptr) {
        return STATUS_INVALID_DEVICE_STATE;
    }

    RtlCopyMemory(resultant_format, supported, required_size);
    return STATUS_SUCCESS;
}

STDMETHODIMP VsnVirtualMicWaveRtMiniport::GetDescription(
    PPCFILTER_DESCRIPTOR* out_filter_descriptor) {
    PAGED_CODE();

    if (out_filter_descriptor == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    *out_filter_descriptor =
        const_cast<PPCFILTER_DESCRIPTOR>(VsnVirtualMicWaveFilterDescriptor());
    return *out_filter_descriptor != nullptr ? STATUS_SUCCESS : STATUS_INVALID_DEVICE_STATE;
}

STDMETHODIMP VsnVirtualMicWaveRtMiniport::Init(
    PUNKNOWN unknown_adapter,
    PRESOURCELIST resource_list,
    PPORTWAVERT port) {
    PAGED_CODE();

    UNREFERENCED_PARAMETER(unknown_adapter);
    UNREFERENCED_PARAMETER(resource_list);

    stream_gate_ = 0;
    return port != nullptr ? STATUS_SUCCESS : STATUS_INVALID_PARAMETER;
}

STDMETHODIMP VsnVirtualMicWaveRtMiniport::NewStream(
    PMINIPORTWAVERTSTREAM* out_stream,
    PPORTWAVERTSTREAM outer_unknown,
    ULONG pin,
    BOOLEAN capture,
    PKSDATAFORMAT data_format) {
    PAGED_CODE();

    UNREFERENCED_PARAMETER(outer_unknown);

    if (out_stream == nullptr || data_format == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    *out_stream = nullptr;

    if (capture == FALSE || pin != kWaveRtWaveCapturePin || !IsSupportedCaptureFormat(data_format)) {
        return STATUS_NOT_SUPPORTED;
    }

    if (InterlockedCompareExchange(&stream_gate_, 1, 0) != 0) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    // SLOT-004 owns the concrete IMiniportWaveRTStream implementation. Release
    // the reservation before failing closed so this shell can never leak the
    // single-stream capacity while no stream object exists yet.
    InterlockedExchange(&stream_gate_, 0);
    return STATUS_NOT_SUPPORTED;
}

STDMETHODIMP VsnVirtualMicWaveRtMiniport::GetDeviceDescription(
    PDEVICE_DESCRIPTION device_description) {
    PAGED_CODE();

    if (device_description == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    RtlZeroMemory(device_description, sizeof(*device_description));
    device_description->Version = DEVICE_DESCRIPTION_VERSION;
    device_description->Master = TRUE;
    device_description->ScatterGather = TRUE;
    device_description->Dma32BitAddresses = TRUE;
    device_description->InterfaceType = Internal;
    device_description->MaximumLength = MAXULONG;
    return STATUS_SUCCESS;
}
#pragma code_seg()

} // namespace

#pragma code_seg("PAGE")
extern "C" NTSTATUS VsnCreateVirtualMicWaveRtMiniport(
    PUNKNOWN* out_unknown,
    PUNKNOWN unknown_outer) noexcept {
    PAGED_CODE();

    if (out_unknown == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    *out_unknown = nullptr;

    auto* miniport = new VsnVirtualMicWaveRtMiniport(unknown_outer);
    if (miniport == nullptr) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    miniport->AddRef();
    *out_unknown = PUNKNOWN(PMINIPORTWAVERT(miniport));
    return STATUS_SUCCESS;
}
#pragma code_seg()
