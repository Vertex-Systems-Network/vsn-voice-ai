#include "vsn_virtual_mic_wavert_contract.h"
#include "vsn_virtual_mic_wavert_scheduler.h"

#include <cstdio>

namespace {

using namespace vsn::virtual_mic;

int Require(bool condition, const char* message) {
    if (condition) {
        return 0;
    }
    std::fprintf(stderr, "WaveRT scheduler validation failed: %s\n", message);
    return 1;
}

} // namespace

int main() {
    if (Require(kWaveRtSchedulerFrameDurationMicros == 10'000u, "frame cadence mismatch") ||
        Require(kWaveRtSchedulerPeriodMs == 10u, "timer period mismatch") ||
        Require(kWaveRtSchedulerSamplesPerFrame == 480u, "sample quantum mismatch") ||
        Require(kWaveRtSchedulerFrameBytes == 1'920u, "byte quantum mismatch")) {
        return 1;
    }

    CyclicWritePlan plan{};
    if (Require(
            PlanWaveRtCyclicWrite(7'680u, 1'920u, 1'920u, &plan) == WaveRtSchedulerStatus::kOk,
            "contiguous plan rejected") ||
        Require(plan.first_offset == 1'920u, "contiguous first offset mismatch") ||
        Require(plan.first_bytes == 1'920u, "contiguous first bytes mismatch") ||
        Require(plan.second_bytes == 0u, "contiguous plan unexpectedly wrapped")) {
        return 1;
    }

    plan = {};
    if (Require(
            PlanWaveRtCyclicWrite(4'096u, 3'500u, 1'920u, &plan) == WaveRtSchedulerStatus::kOk,
            "wrapped plan rejected") ||
        Require(plan.first_offset == 3'500u, "wrapped first offset mismatch") ||
        Require(plan.first_bytes == 596u, "wrapped first bytes mismatch") ||
        Require(plan.second_offset == 0u, "wrapped second offset mismatch") ||
        Require(plan.second_bytes == 1'324u, "wrapped second bytes mismatch") ||
        Require(plan.first_bytes + plan.second_bytes == 1'920u, "wrapped byte total mismatch")) {
        return 1;
    }

    if (Require(
            PlanWaveRtCyclicWrite(1'919u, 0u, 1'920u, &plan) == WaveRtSchedulerStatus::kInvalidFrameBytes,
            "oversized frame accepted") ||
        Require(
            PlanWaveRtCyclicWrite(4'096u, 4'096u, 1'920u, &plan) == WaveRtSchedulerStatus::kInvalidPosition,
            "out-of-range position accepted") ||
        Require(
            PlanWaveRtCyclicWrite(4'096u, 0u, 1'920u, nullptr) == WaveRtSchedulerStatus::kNullPlan,
            "null plan accepted")) {
        return 1;
    }

    std::puts("VSN WaveRT scheduler contract validation passed.");
    return 0;
}
