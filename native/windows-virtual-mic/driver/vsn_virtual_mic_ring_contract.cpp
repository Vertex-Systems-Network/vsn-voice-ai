#include <ntifs.h>
#include <wdf.h>

#include "../include/vsn_virtual_mic_ring_consumer.h"

using namespace vsn::virtual_mic;

// Compile/link probe for the shared ring-consumer contract in the real WDK
// translation environment. The WaveRT miniport will call the same bounded
// helper once its capture stream/position contract is wired in a later slice.
extern "C" RingConsumeStatus VsnVirtualMicConsumeOneFrameContract(
    const ProtocolHeader& authoritative_header,
    uint64_t expected_generation,
    void* shared_region,
    uint64_t shared_region_bytes,
    void* output_frame,
    uint64_t output_frame_bytes,
    RingConsumeResult* result) noexcept {
    return ConsumeOneRingFrame(
        authoritative_header,
        expected_generation,
        shared_region,
        shared_region_bytes,
        output_frame,
        output_frame_bytes,
        result);
}
