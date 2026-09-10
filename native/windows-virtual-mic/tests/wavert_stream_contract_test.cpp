#include "vsn_virtual_mic_wavert_stream_contract.h"

#include <cstdio>
#include <cstdint>

namespace {

using vsn::virtual_mic::AdvanceWaveRtCapturePosition;
using vsn::virtual_mic::InitializeWaveRtStreamRuntime;
using vsn::virtual_mic::SetWaveRtStreamState;
using vsn::virtual_mic::ValidateWaveRtStreamGeometry;
using vsn::virtual_mic::WaveRtStreamRuntime;
using vsn::virtual_mic::WaveRtStreamState;
using vsn::virtual_mic::WaveRtStreamStatus;

int Require(bool condition, const char* message) {
    if (condition) {
        return 0;
    }
    std::fprintf(stderr, "WaveRT stream contract validation failed: %s\n", message);
    return 1;
}

} // namespace

int main() {
    if (Require(static_cast<uint32_t>(WaveRtStreamState::kStop) == 0u, "STOP numeric value drifted") ||
        Require(static_cast<uint32_t>(WaveRtStreamState::kAcquire) == 1u, "ACQUIRE numeric value drifted") ||
        Require(static_cast<uint32_t>(WaveRtStreamState::kPause) == 2u, "PAUSE numeric value drifted") ||
        Require(static_cast<uint32_t>(WaveRtStreamState::kRun) == 3u, "RUN numeric value drifted")) {
        return 1;
    }

    if (Require(
            ValidateWaveRtStreamGeometry(7'680u, 4u, 1'920u) == WaveRtStreamStatus::kOk,
            "reference geometry rejected") ||
        Require(
            ValidateWaveRtStreamGeometry(0u, 4u, 1'920u) ==
                WaveRtStreamStatus::kInvalidBufferBytes,
            "zero buffer accepted") ||
        Require(
            ValidateWaveRtStreamGeometry(7'681u, 4u, 1'920u) ==
                WaveRtStreamStatus::kInvalidBufferBytes,
            "unaligned buffer accepted") ||
        Require(
            ValidateWaveRtStreamGeometry(7'680u, 0u, 1'920u) ==
                WaveRtStreamStatus::kInvalidBlockAlign,
            "zero block align accepted") ||
        Require(
            ValidateWaveRtStreamGeometry(7'680u, 4u, 0u) ==
                WaveRtStreamStatus::kInvalidNotificationBytes,
            "zero notification interval accepted") ||
        Require(
            ValidateWaveRtStreamGeometry(7'680u, 4u, 7'684u) ==
                WaveRtStreamStatus::kInvalidNotificationBytes,
            "oversized notification interval accepted")) {
        return 1;
    }

    WaveRtStreamRuntime runtime{};
    if (Require(
            InitializeWaveRtStreamRuntime(&runtime, 7'680u, 4u, 1'920u) ==
                WaveRtStreamStatus::kOk,
            "reference runtime initialization failed") ||
        Require(runtime.state == WaveRtStreamState::kStop, "initial state was not STOP") ||
        Require(runtime.cyclic_position_bytes == 0u, "initial cyclic position was non-zero") ||
        Require(runtime.linear_position_bytes == 0u, "initial linear position was non-zero") ||
        Require(runtime.notifications_due_total == 0u, "initial notification count was non-zero")) {
        return 1;
    }

    if (Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kRun) ==
                WaveRtStreamStatus::kInvalidTransition,
            "STOP to RUN transition was accepted") ||
        Require(runtime.state == WaveRtStreamState::kStop, "failed transition changed state")) {
        return 1;
    }

    if (Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kAcquire) ==
                WaveRtStreamStatus::kOk,
            "STOP to ACQUIRE failed") ||
        Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kPause) ==
                WaveRtStreamStatus::kOk,
            "ACQUIRE to PAUSE failed") ||
        Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kRun) ==
                WaveRtStreamStatus::kOk,
            "PAUSE to RUN failed")) {
        return 1;
    }

    for (uint64_t iteration = 1u; iteration <= 4u; ++iteration) {
        uint64_t due = 0u;
        if (Require(
                AdvanceWaveRtCapturePosition(&runtime, 1'920u, &due) ==
                    WaveRtStreamStatus::kOk,
                "position advance failed") ||
            Require(due == 1u, "notification cadence mismatch") ||
            Require(
                runtime.linear_position_bytes == iteration * 1'920u,
                "linear position mismatch") ||
            Require(
                runtime.notifications_due_total == iteration,
                "notification total mismatch")) {
            return 1;
        }
    }

    if (Require(runtime.cyclic_position_bytes == 0u, "cyclic position did not wrap") ||
        Require(runtime.linear_position_bytes == 7'680u, "linear position did not remain monotonic")) {
        return 1;
    }

    if (Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kPause) ==
                WaveRtStreamStatus::kOk,
            "RUN to PAUSE failed") ||
        Require(
            AdvanceWaveRtCapturePosition(&runtime, 1'920u) ==
                WaveRtStreamStatus::kInvalidState,
            "position advanced while paused") ||
        Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kAcquire) ==
                WaveRtStreamStatus::kOk,
            "PAUSE to ACQUIRE failed") ||
        Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kStop) ==
                WaveRtStreamStatus::kOk,
            "ACQUIRE to STOP failed") ||
        Require(runtime.cyclic_position_bytes == 0u, "STOP did not reset cyclic position") ||
        Require(runtime.linear_position_bytes == 0u, "STOP did not reset linear position") ||
        Require(runtime.notifications_due_total == 0u, "STOP did not reset notification total")) {
        return 1;
    }

    if (Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kAcquire) ==
                WaveRtStreamStatus::kOk,
            "second STOP to ACQUIRE failed") ||
        Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kPause) ==
                WaveRtStreamStatus::kOk,
            "second ACQUIRE to PAUSE failed") ||
        Require(
            SetWaveRtStreamState(&runtime, WaveRtStreamState::kRun) ==
                WaveRtStreamStatus::kOk,
            "second PAUSE to RUN failed") ||
        Require(
            AdvanceWaveRtCapturePosition(&runtime, 2u) ==
                WaveRtStreamStatus::kInvalidAdvanceBytes,
            "unaligned position advance accepted") ||
        Require(
            AdvanceWaveRtCapturePosition(&runtime, 7'684u) ==
                WaveRtStreamStatus::kInvalidAdvanceBytes,
            "oversized position advance accepted")) {
        return 1;
    }

    runtime.linear_position_bytes = UINT64_MAX - 1'000u;
    const uint64_t cyclic_before = runtime.cyclic_position_bytes;
    const uint64_t notifications_before = runtime.notifications_due_total;
    if (Require(
            AdvanceWaveRtCapturePosition(&runtime, 1'920u) ==
                WaveRtStreamStatus::kPositionOverflow,
            "linear position overflow was accepted") ||
        Require(
            runtime.linear_position_bytes == UINT64_MAX - 1'000u,
            "overflow failure mutated linear position") ||
        Require(runtime.cyclic_position_bytes == cyclic_before, "overflow failure mutated cyclic position") ||
        Require(runtime.notifications_due_total == notifications_before, "overflow failure mutated notification total")) {
        return 1;
    }

    if (Require(
            InitializeWaveRtStreamRuntime(nullptr, 7'680u, 4u, 1'920u) ==
                WaveRtStreamStatus::kNullState,
            "null runtime initialization accepted")) {
        return 1;
    }

    std::puts("VSN WaveRT stream lifecycle contract validation passed.");
    return 0;
}
