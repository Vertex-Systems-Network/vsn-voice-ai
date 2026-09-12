#pragma once

#include <stdint.h>

namespace vsn::virtual_mic {

constexpr uint32_t kWaveRtSampleRateHz = 48'000u;
constexpr uint16_t kWaveRtChannels = 1u;
constexpr uint16_t kWaveRtBitsPerSample = 32u;
constexpr uint16_t kWaveRtBytesPerSample = kWaveRtBitsPerSample / 8u;
constexpr uint16_t kWaveRtBlockAlign = kWaveRtChannels * kWaveRtBytesPerSample;
constexpr uint32_t kWaveRtAverageBytesPerSecond =
    kWaveRtSampleRateHz * static_cast<uint32_t>(kWaveRtBlockAlign);
constexpr uint32_t kWaveRtMaxCaptureStreams = 1u;

// The first production capture scheduler intentionally uses one fixed 10 ms
// quantum. Keeping transport packet cadence equal to the WaveRT scheduling
// cadence avoids hidden resampling, partial-frame carry state, or variable-rate
// timer behavior in the realtime path.
constexpr uint32_t kWaveRtSchedulerFrameDurationMicros = 10'000u;
constexpr uint32_t kWaveRtSchedulerPeriodMs =
    kWaveRtSchedulerFrameDurationMicros / 1'000u;
constexpr uint32_t kWaveRtSchedulerSamplesPerFrame =
    (kWaveRtSampleRateHz * kWaveRtSchedulerPeriodMs) / 1'000u;
constexpr uint32_t kWaveRtSchedulerFrameBytes =
    kWaveRtSchedulerSamplesPerFrame * static_cast<uint32_t>(kWaveRtBlockAlign);

constexpr uint32_t kWaveRtWaveBridgePin = 0u;
constexpr uint32_t kWaveRtWaveCapturePin = 1u;
constexpr uint32_t kWaveRtWaveAdcNode = 0u;
constexpr uint32_t kWaveRtTopologyMicPin = 0u;
constexpr uint32_t kWaveRtTopologyBridgePin = 1u;

static_assert(kWaveRtSampleRateHz == 48'000u, "initial WaveRT contract must remain 48 kHz");
static_assert(kWaveRtChannels == 1u, "initial WaveRT contract must remain mono");
static_assert(kWaveRtBitsPerSample == 32u, "initial WaveRT contract must remain F32-width");
static_assert(kWaveRtBlockAlign == 4u, "initial WaveRT block alignment drifted");
static_assert(kWaveRtAverageBytesPerSecond == 192'000u, "initial WaveRT byte rate drifted");
static_assert(kWaveRtMaxCaptureStreams == 1u, "initial WaveRT stream-count contract drifted");
static_assert(kWaveRtSchedulerFrameDurationMicros == 10'000u, "scheduler cadence drifted");
static_assert(kWaveRtSchedulerPeriodMs == 10u, "scheduler period drifted");
static_assert(kWaveRtSchedulerSamplesPerFrame == 480u, "scheduler sample quantum drifted");
static_assert(kWaveRtSchedulerFrameBytes == 1'920u, "scheduler byte quantum drifted");

} // namespace vsn::virtual_mic
