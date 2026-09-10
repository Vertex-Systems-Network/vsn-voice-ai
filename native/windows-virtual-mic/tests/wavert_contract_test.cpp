#include "vsn_virtual_mic_wavert_contract.h"

#include <cstdio>

namespace {

using namespace vsn::virtual_mic;

int Require(bool condition, const char* message) {
    if (condition) {
        return 0;
    }
    std::fprintf(stderr, "virtual-mic WaveRT contract validation failed: %s\n", message);
    return 1;
}

} // namespace

int main() {
    if (Require(kWaveRtSampleRateHz == 48'000u, "sample rate mismatch") ||
        Require(kWaveRtChannels == 1u, "channel count mismatch") ||
        Require(kWaveRtBitsPerSample == 32u, "sample width mismatch") ||
        Require(kWaveRtBytesPerSample == sizeof(float), "F32 byte width mismatch") ||
        Require(kWaveRtBlockAlign == 4u, "block alignment mismatch") ||
        Require(kWaveRtAverageBytesPerSecond == 192'000u, "average byte rate mismatch") ||
        Require(kWaveRtMaxCaptureStreams == 1u, "capture stream count mismatch") ||
        Require(kWaveRtWaveBridgePin == 0u, "wave bridge pin index mismatch") ||
        Require(kWaveRtWaveCapturePin == 1u, "wave capture pin index mismatch") ||
        Require(kWaveRtWaveAdcNode == 0u, "wave ADC node index mismatch") ||
        Require(kWaveRtTopologyMicPin == 0u, "topology microphone pin index mismatch") ||
        Require(kWaveRtTopologyBridgePin == 1u, "topology bridge pin index mismatch")) {
        return 1;
    }

    std::puts("VSN virtual microphone WaveRT descriptor contract validation passed.");
    return 0;
}
