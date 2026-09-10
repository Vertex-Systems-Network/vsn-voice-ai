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

} // namespace vsn::virtual_mic
