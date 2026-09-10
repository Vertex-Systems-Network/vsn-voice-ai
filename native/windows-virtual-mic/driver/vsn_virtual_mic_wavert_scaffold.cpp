#include <ntifs.h>
#include <wdf.h>
#include <portcls.h>
#include <ksmedia.h>

#include "../include/vsn_virtual_mic_wavert_contract.h"

namespace {

using namespace vsn::virtual_mic;

static_assert(kWaveRtBlockAlign == sizeof(float), "WaveRT F32 frame width drifted");

// The shared ring is F32, so the initial endpoint scaffold advertises exactly
// one matching raw format instead of hiding a conversion inside the miniport.
// Broader Windows mix-format support, if required, must be an explicit later
// conversion/format-negotiation slice with benchmark evidence.
KSDATAFORMAT_WAVEFORMATEXTENSIBLE gVsnCaptureFormat = {
    {
        sizeof(KSDATAFORMAT_WAVEFORMATEXTENSIBLE),
        0u,
        0u,
        0u,
        STATICGUIDOF(KSDATAFORMAT_TYPE_AUDIO),
        STATICGUIDOF(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT),
        STATICGUIDOF(KSDATAFORMAT_SPECIFIER_WAVEFORMATEX),
    },
    {
        {
            WAVE_FORMAT_EXTENSIBLE,
            kWaveRtChannels,
            kWaveRtSampleRateHz,
            kWaveRtAverageBytesPerSecond,
            kWaveRtBlockAlign,
            kWaveRtBitsPerSample,
            sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX),
        },
        kWaveRtBitsPerSample,
        KSAUDIO_SPEAKER_MONO,
        STATICGUIDOF(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT),
    },
};

KSDATARANGE_AUDIO gVsnCaptureDataRange = {
    {
        sizeof(KSDATARANGE_AUDIO),
        0u,
        0u,
        0u,
        STATICGUIDOF(KSDATAFORMAT_TYPE_AUDIO),
        STATICGUIDOF(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT),
        STATICGUIDOF(KSDATAFORMAT_SPECIFIER_WAVEFORMATEX),
    },
    kWaveRtChannels,
    kWaveRtBitsPerSample,
    kWaveRtBitsPerSample,
    kWaveRtSampleRateHz,
    kWaveRtSampleRateHz,
};

KSDATARANGE gVsnBridgeDataRange = {
    sizeof(KSDATARANGE),
    0u,
    0u,
    0u,
    STATICGUIDOF(KSDATAFORMAT_TYPE_AUDIO),
    STATICGUIDOF(KSDATAFORMAT_SUBTYPE_ANALOG),
    STATICGUIDOF(KSDATAFORMAT_SPECIFIER_NONE),
};

PKSDATARANGE gVsnCaptureDataRangePointers[] = {
    reinterpret_cast<PKSDATARANGE>(&gVsnCaptureDataRange),
};

PKSDATARANGE gVsnBridgeDataRangePointers[] = {
    &gVsnBridgeDataRange,
};

PCPIN_DESCRIPTOR gVsnWavePins[] = {
    // Bridge receives audio from the topology filter.
    {
        0u,
        0u,
        0u,
        nullptr,
        {
            0u,
            nullptr,
            0u,
            nullptr,
            ARRAYSIZE(gVsnBridgeDataRangePointers),
            gVsnBridgeDataRangePointers,
            KSPIN_DATAFLOW_IN,
            KSPIN_COMMUNICATION_NONE,
            &KSCATEGORY_AUDIO,
            nullptr,
            0u,
        },
    },
    // Host capture pin exposes exactly one initial stream.
    {
        kWaveRtMaxCaptureStreams,
        kWaveRtMaxCaptureStreams,
        0u,
        nullptr,
        {
            0u,
            nullptr,
            0u,
            nullptr,
            ARRAYSIZE(gVsnCaptureDataRangePointers),
            gVsnCaptureDataRangePointers,
            KSPIN_DATAFLOW_OUT,
            KSPIN_COMMUNICATION_SINK,
            &KSCATEGORY_AUDIO,
            &KSAUDFNAME_RECORDING_CONTROL,
            0u,
        },
    },
};

PCNODE_DESCRIPTOR gVsnWaveNodes[] = {
    {
        0u,
        nullptr,
        &KSNODETYPE_ADC,
        nullptr,
    },
};

PCCONNECTION_DESCRIPTOR gVsnWaveConnections[] = {
    {PCFILTER_NODE, kWaveRtWaveBridgePin, kWaveRtWaveAdcNode, 1u},
    {kWaveRtWaveAdcNode, 0u, PCFILTER_NODE, kWaveRtWaveCapturePin},
};

PCFILTER_DESCRIPTOR gVsnWaveFilter = {
    0u,
    nullptr,
    sizeof(PCPIN_DESCRIPTOR),
    ARRAYSIZE(gVsnWavePins),
    gVsnWavePins,
    sizeof(PCNODE_DESCRIPTOR),
    ARRAYSIZE(gVsnWaveNodes),
    gVsnWaveNodes,
    ARRAYSIZE(gVsnWaveConnections),
    gVsnWaveConnections,
    0u,
    nullptr,
};

// Minimal topology: a virtual microphone source pin connected directly to the
// wave bridge. Volume/mute/jack properties are deliberately omitted until the
// endpoint is actually registered and their behavior can be verified.
PCPIN_DESCRIPTOR gVsnTopologyPins[] = {
    {
        0u,
        0u,
        0u,
        nullptr,
        {
            0u,
            nullptr,
            0u,
            nullptr,
            ARRAYSIZE(gVsnBridgeDataRangePointers),
            gVsnBridgeDataRangePointers,
            KSPIN_DATAFLOW_IN,
            KSPIN_COMMUNICATION_NONE,
            &KSNODETYPE_MICROPHONE,
            nullptr,
            0u,
        },
    },
    {
        0u,
        0u,
        0u,
        nullptr,
        {
            0u,
            nullptr,
            0u,
            nullptr,
            ARRAYSIZE(gVsnBridgeDataRangePointers),
            gVsnBridgeDataRangePointers,
            KSPIN_DATAFLOW_OUT,
            KSPIN_COMMUNICATION_NONE,
            &KSCATEGORY_AUDIO,
            nullptr,
            0u,
        },
    },
};

PCCONNECTION_DESCRIPTOR gVsnTopologyConnections[] = {
    {PCFILTER_NODE, kWaveRtTopologyMicPin, PCFILTER_NODE, kWaveRtTopologyBridgePin},
};

PCFILTER_DESCRIPTOR gVsnTopologyFilter = {
    0u,
    nullptr,
    sizeof(PCPIN_DESCRIPTOR),
    ARRAYSIZE(gVsnTopologyPins),
    gVsnTopologyPins,
    0u,
    0u,
    nullptr,
    ARRAYSIZE(gVsnTopologyConnections),
    gVsnTopologyConnections,
    0u,
    nullptr,
};

} // namespace

extern "C" const PCFILTER_DESCRIPTOR* VsnVirtualMicWaveFilterDescriptor() noexcept {
    return &gVsnWaveFilter;
}

extern "C" const PCFILTER_DESCRIPTOR* VsnVirtualMicTopologyFilterDescriptor() noexcept {
    return &gVsnTopologyFilter;
}

extern "C" const KSDATAFORMAT_WAVEFORMATEXTENSIBLE* VsnVirtualMicCaptureFormat() noexcept {
    return &gVsnCaptureFormat;
}
