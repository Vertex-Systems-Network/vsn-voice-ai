#pragma once

#include <stdint.h>

namespace vsn::virtual_mic {

enum class WaveRtSchedulerStatus : uint32_t {
    kOk = 0u,
    kNullPlan,
    kInvalidBufferBytes,
    kInvalidFrameBytes,
    kInvalidPosition,
};

struct CyclicWritePlan final {
    uint64_t first_offset;
    uint64_t first_bytes;
    uint64_t second_offset;
    uint64_t second_bytes;
};

static_assert(sizeof(CyclicWritePlan) == 32u, "CyclicWritePlan size drifted");
static_assert(alignof(CyclicWritePlan) == 8u, "CyclicWritePlan alignment drifted");

constexpr WaveRtSchedulerStatus PlanWaveRtCyclicWrite(
    uint64_t buffer_bytes,
    uint64_t cyclic_position_bytes,
    uint64_t frame_bytes,
    CyclicWritePlan* plan) noexcept {
    if (plan == nullptr) {
        return WaveRtSchedulerStatus::kNullPlan;
    }
    *plan = CyclicWritePlan{};

    if (buffer_bytes == 0u) {
        return WaveRtSchedulerStatus::kInvalidBufferBytes;
    }
    if (frame_bytes == 0u || frame_bytes > buffer_bytes) {
        return WaveRtSchedulerStatus::kInvalidFrameBytes;
    }
    if (cyclic_position_bytes >= buffer_bytes) {
        return WaveRtSchedulerStatus::kInvalidPosition;
    }

    const uint64_t remaining = buffer_bytes - cyclic_position_bytes;
    const uint64_t first = frame_bytes < remaining ? frame_bytes : remaining;
    const uint64_t second = frame_bytes - first;

    plan->first_offset = cyclic_position_bytes;
    plan->first_bytes = first;
    plan->second_offset = 0u;
    plan->second_bytes = second;
    return WaveRtSchedulerStatus::kOk;
}

} // namespace vsn::virtual_mic
