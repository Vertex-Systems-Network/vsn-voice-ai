#pragma once

#include "vsn_virtual_mic_ring_consumer.h"

#include <stdint.h>

namespace vsn::virtual_mic {

enum class TransportBridgeStatus : uint32_t {
    kOk = 0u,
    kSilence,
    kUnavailable,
    kInvalidOutput,
    kRingFailure,
};

struct TransportGeometry final {
    uint64_t session_generation;
    uint64_t frame_bytes;
    uint32_t frame_duration_micros;
    uint32_t samples_per_frame;
};

static_assert(sizeof(TransportGeometry) == 24u, "TransportGeometry ABI size drifted");
static_assert(alignof(TransportGeometry) == 8u, "TransportGeometry ABI alignment drifted");

// Returns the currently published validated transport geometry without exposing
// the raw shared mapping or control-device extension to the WaveRT stream.
// This function is safe at IRQL <= DISPATCH_LEVEL and performs no allocation,
// wait, retry or user-mode access.
extern "C" TransportBridgeStatus VsnWdmControlGetTransportGeometry(
    TransportGeometry* geometry) noexcept;

// Consumes at most one guarded ring frame from the currently published driver-
// owned mapping. The control module retains mapping ownership and fences
// disconnect/delete against this bounded operation. Unavailable or unstable
// transport produces fresh silence rather than exposing stale/torn bytes.
// This function is safe at IRQL <= DISPATCH_LEVEL and performs no allocation or
// blocking wait.
extern "C" TransportBridgeStatus VsnWdmControlConsumeFrame(
    void* output_frame,
    uint64_t output_frame_bytes,
    RingConsumeResult* result) noexcept;

} // namespace vsn::virtual_mic
