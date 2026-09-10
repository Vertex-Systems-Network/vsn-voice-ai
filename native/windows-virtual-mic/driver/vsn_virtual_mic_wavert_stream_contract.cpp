#include <ntifs.h>
#include <wdf.h>
#include <portcls.h>

#include "../include/vsn_virtual_mic_wavert_stream_contract.h"

namespace {

using namespace vsn::virtual_mic;

static_assert(
    static_cast<uint32_t>(WaveRtStreamState::kStop) == static_cast<uint32_t>(KSSTATE_STOP),
    "WaveRT STOP state mapping drifted");
static_assert(
    static_cast<uint32_t>(WaveRtStreamState::kAcquire) == static_cast<uint32_t>(KSSTATE_ACQUIRE),
    "WaveRT ACQUIRE state mapping drifted");
static_assert(
    static_cast<uint32_t>(WaveRtStreamState::kPause) == static_cast<uint32_t>(KSSTATE_PAUSE),
    "WaveRT PAUSE state mapping drifted");
static_assert(
    static_cast<uint32_t>(WaveRtStreamState::kRun) == static_cast<uint32_t>(KSSTATE_RUN),
    "WaveRT RUN state mapping drifted");

} // namespace

extern "C" NTSTATUS VsnWaveRtStreamContractCompileProbe() noexcept {
    using namespace vsn::virtual_mic;

    WaveRtStreamRuntime runtime{};
    if (InitializeWaveRtStreamRuntime(&runtime, 7'680u, 4u, 1'920u) !=
        WaveRtStreamStatus::kOk) {
        return STATUS_DATA_ERROR;
    }
    if (SetWaveRtStreamState(&runtime, WaveRtStreamState::kAcquire) !=
            WaveRtStreamStatus::kOk ||
        SetWaveRtStreamState(&runtime, WaveRtStreamState::kPause) !=
            WaveRtStreamStatus::kOk ||
        SetWaveRtStreamState(&runtime, WaveRtStreamState::kRun) !=
            WaveRtStreamStatus::kOk) {
        return STATUS_DATA_ERROR;
    }

    uint64_t notifications_due = 0u;
    if (AdvanceWaveRtCapturePosition(&runtime, 1'920u, &notifications_due) !=
            WaveRtStreamStatus::kOk ||
        runtime.cyclic_position_bytes != 1'920u ||
        runtime.linear_position_bytes != 1'920u ||
        notifications_due != 1u) {
        return STATUS_DATA_ERROR;
    }

    return STATUS_SUCCESS;
}
