#pragma once

#include <stddef.h>
#include <stdint.h>

namespace vsn::virtual_mic {

enum class WaveRtStreamState : uint32_t {
    kStop = 0u,
    kAcquire = 1u,
    kPause = 2u,
    kRun = 3u,
};

enum class WaveRtStreamStatus : uint32_t {
    kOk = 0u,
    kNullState,
    kInvalidBufferBytes,
    kInvalidBlockAlign,
    kInvalidNotificationBytes,
    kInvalidState,
    kInvalidTransition,
    kInvalidAdvanceBytes,
    kPositionOverflow,
};

struct alignas(8) WaveRtStreamRuntime final {
    WaveRtStreamState state;
    uint32_t reserved;
    uint64_t buffer_bytes;
    uint64_t block_align_bytes;
    uint64_t notification_bytes;
    uint64_t cyclic_position_bytes;
    uint64_t linear_position_bytes;
    uint64_t notification_accumulator_bytes;
    uint64_t notifications_due_total;
};

static_assert(sizeof(WaveRtStreamRuntime) == 64u, "WaveRtStreamRuntime size drifted");
static_assert(alignof(WaveRtStreamRuntime) == 8u, "WaveRtStreamRuntime alignment drifted");
static_assert(offsetof(WaveRtStreamRuntime, state) == 0u, "WaveRtStreamRuntime.state offset drifted");
static_assert(offsetof(WaveRtStreamRuntime, buffer_bytes) == 8u, "WaveRtStreamRuntime.buffer_bytes offset drifted");
static_assert(offsetof(WaveRtStreamRuntime, cyclic_position_bytes) == 32u, "WaveRtStreamRuntime.cyclic position offset drifted");
static_assert(offsetof(WaveRtStreamRuntime, linear_position_bytes) == 40u, "WaveRtStreamRuntime.linear position offset drifted");

constexpr bool IsValidWaveRtStreamState(WaveRtStreamState state) noexcept {
    return static_cast<uint32_t>(state) <= static_cast<uint32_t>(WaveRtStreamState::kRun);
}

constexpr bool IsAllowedWaveRtTransition(
    WaveRtStreamState from,
    WaveRtStreamState to) noexcept {
    if (!IsValidWaveRtStreamState(from) || !IsValidWaveRtStreamState(to)) {
        return false;
    }
    if (from == to) {
        return true;
    }

    const uint32_t from_value = static_cast<uint32_t>(from);
    const uint32_t to_value = static_cast<uint32_t>(to);
    return from_value + 1u == to_value || to_value + 1u == from_value;
}

constexpr WaveRtStreamStatus ValidateWaveRtStreamGeometry(
    uint64_t buffer_bytes,
    uint64_t block_align_bytes,
    uint64_t notification_bytes) noexcept {
    if (block_align_bytes == 0u) {
        return WaveRtStreamStatus::kInvalidBlockAlign;
    }
    if (buffer_bytes == 0u || buffer_bytes % block_align_bytes != 0u) {
        return WaveRtStreamStatus::kInvalidBufferBytes;
    }
    if (notification_bytes == 0u ||
        notification_bytes > buffer_bytes ||
        notification_bytes % block_align_bytes != 0u) {
        return WaveRtStreamStatus::kInvalidNotificationBytes;
    }
    return WaveRtStreamStatus::kOk;
}

inline WaveRtStreamStatus InitializeWaveRtStreamRuntime(
    WaveRtStreamRuntime* runtime,
    uint64_t buffer_bytes,
    uint64_t block_align_bytes,
    uint64_t notification_bytes) noexcept {
    if (runtime == nullptr) {
        return WaveRtStreamStatus::kNullState;
    }
    const WaveRtStreamStatus geometry = ValidateWaveRtStreamGeometry(
        buffer_bytes,
        block_align_bytes,
        notification_bytes);
    if (geometry != WaveRtStreamStatus::kOk) {
        return geometry;
    }

    *runtime = WaveRtStreamRuntime{
        WaveRtStreamState::kStop,
        0u,
        buffer_bytes,
        block_align_bytes,
        notification_bytes,
        0u,
        0u,
        0u,
        0u,
    };
    return WaveRtStreamStatus::kOk;
}

inline WaveRtStreamStatus SetWaveRtStreamState(
    WaveRtStreamRuntime* runtime,
    WaveRtStreamState next_state) noexcept {
    if (runtime == nullptr) {
        return WaveRtStreamStatus::kNullState;
    }
    if (!IsValidWaveRtStreamState(runtime->state) || !IsValidWaveRtStreamState(next_state)) {
        return WaveRtStreamStatus::kInvalidState;
    }
    if (!IsAllowedWaveRtTransition(runtime->state, next_state)) {
        return WaveRtStreamStatus::kInvalidTransition;
    }

    runtime->state = next_state;
    if (next_state == WaveRtStreamState::kStop) {
        runtime->cyclic_position_bytes = 0u;
        runtime->linear_position_bytes = 0u;
        runtime->notification_accumulator_bytes = 0u;
        runtime->notifications_due_total = 0u;
    }
    return WaveRtStreamStatus::kOk;
}

inline WaveRtStreamStatus AdvanceWaveRtCapturePosition(
    WaveRtStreamRuntime* runtime,
    uint64_t advance_bytes,
    uint64_t* notifications_due_now = nullptr) noexcept {
    if (runtime == nullptr) {
        return WaveRtStreamStatus::kNullState;
    }
    if (runtime->state != WaveRtStreamState::kRun) {
        return WaveRtStreamStatus::kInvalidState;
    }
    if (advance_bytes == 0u ||
        advance_bytes % runtime->block_align_bytes != 0u ||
        advance_bytes > runtime->buffer_bytes) {
        return WaveRtStreamStatus::kInvalidAdvanceBytes;
    }
    if (UINT64_MAX - runtime->linear_position_bytes < advance_bytes ||
        UINT64_MAX - runtime->notification_accumulator_bytes < advance_bytes) {
        return WaveRtStreamStatus::kPositionOverflow;
    }

    runtime->linear_position_bytes += advance_bytes;
    runtime->cyclic_position_bytes =
        (runtime->cyclic_position_bytes + advance_bytes) % runtime->buffer_bytes;
    runtime->notification_accumulator_bytes += advance_bytes;

    const uint64_t due =
        runtime->notification_accumulator_bytes / runtime->notification_bytes;
    runtime->notification_accumulator_bytes %= runtime->notification_bytes;
    if (UINT64_MAX - runtime->notifications_due_total < due) {
        return WaveRtStreamStatus::kPositionOverflow;
    }
    runtime->notifications_due_total += due;
    if (notifications_due_now != nullptr) {
        *notifications_due_now = due;
    }
    return WaveRtStreamStatus::kOk;
}

} // namespace vsn::virtual_mic
