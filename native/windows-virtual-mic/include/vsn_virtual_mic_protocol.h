#pragma once

#include <stddef.h>
#include <stdint.h>

namespace vsn::virtual_mic {

constexpr uint32_t kProtocolMagic = 0x4D4E5356u; // Little-endian bytes: "VSNM".
constexpr uint16_t kProtocolVersion = 1u;
constexpr uint16_t kSampleFormatF32Le = 1u;

struct alignas(8) ProtocolHeader final {
    uint32_t magic;
    uint16_t version;
    uint16_t header_bytes;
    uint64_t session_generation;
    uint32_t sample_rate_hz;
    uint16_t channels;
    uint16_t sample_format;
    uint32_t frame_duration_micros;
    uint32_t capacity_frames;
    uint32_t samples_per_frame;
    uint32_t reserved;
};

struct alignas(8) CursorSnapshot final {
    uint64_t session_generation;
    uint64_t producer_sequence;
    uint64_t consumer_sequence;
    uint64_t overrun_drops;
    uint64_t underruns;
};

static_assert(sizeof(ProtocolHeader) == 40u, "ProtocolHeader ABI size drifted");
static_assert(alignof(ProtocolHeader) == 8u, "ProtocolHeader ABI alignment drifted");
static_assert(offsetof(ProtocolHeader, magic) == 0u, "ProtocolHeader.magic offset drifted");
static_assert(offsetof(ProtocolHeader, version) == 4u, "ProtocolHeader.version offset drifted");
static_assert(offsetof(ProtocolHeader, header_bytes) == 6u, "ProtocolHeader.header_bytes offset drifted");
static_assert(offsetof(ProtocolHeader, session_generation) == 8u, "ProtocolHeader.session_generation offset drifted");
static_assert(offsetof(ProtocolHeader, sample_rate_hz) == 16u, "ProtocolHeader.sample_rate_hz offset drifted");
static_assert(offsetof(ProtocolHeader, channels) == 20u, "ProtocolHeader.channels offset drifted");
static_assert(offsetof(ProtocolHeader, sample_format) == 22u, "ProtocolHeader.sample_format offset drifted");
static_assert(offsetof(ProtocolHeader, frame_duration_micros) == 24u, "ProtocolHeader.frame_duration_micros offset drifted");
static_assert(offsetof(ProtocolHeader, capacity_frames) == 28u, "ProtocolHeader.capacity_frames offset drifted");
static_assert(offsetof(ProtocolHeader, samples_per_frame) == 32u, "ProtocolHeader.samples_per_frame offset drifted");
static_assert(offsetof(ProtocolHeader, reserved) == 36u, "ProtocolHeader.reserved offset drifted");

static_assert(sizeof(CursorSnapshot) == 40u, "CursorSnapshot ABI size drifted");
static_assert(alignof(CursorSnapshot) == 8u, "CursorSnapshot ABI alignment drifted");
static_assert(offsetof(CursorSnapshot, session_generation) == 0u, "CursorSnapshot.session_generation offset drifted");
static_assert(offsetof(CursorSnapshot, producer_sequence) == 8u, "CursorSnapshot.producer_sequence offset drifted");
static_assert(offsetof(CursorSnapshot, consumer_sequence) == 16u, "CursorSnapshot.consumer_sequence offset drifted");
static_assert(offsetof(CursorSnapshot, overrun_drops) == 24u, "CursorSnapshot.overrun_drops offset drifted");
static_assert(offsetof(CursorSnapshot, underruns) == 32u, "CursorSnapshot.underruns offset drifted");

enum class ContractStatus : uint32_t {
    kOk = 0u,
    kMagicMismatch,
    kVersionMismatch,
    kHeaderSizeMismatch,
    kInvalidSessionGeneration,
    kInvalidCapacity,
    kUnsupportedSampleFormat,
    kInvalidFrameDuration,
    kInvalidSampleRate,
    kInvalidChannelCount,
    kNonIntegralFrameSize,
    kSamplesPerFrameMismatch,
    kReservedFieldNonZero,
    kSessionGenerationMismatch,
    kCursorOrderInvalid,
    kNullOutput,
};

struct RingWindow final {
    uint64_t capacity_frames;
    uint64_t buffered_frames;
    uint32_t producer_slot;
    uint32_t consumer_slot;
    uint64_t normalized_consumer_sequence;
    uint64_t dropped_frames;
};

constexpr ContractStatus ValidateHeader(const ProtocolHeader& header) noexcept {
    if (header.magic != kProtocolMagic) {
        return ContractStatus::kMagicMismatch;
    }
    if (header.version != kProtocolVersion) {
        return ContractStatus::kVersionMismatch;
    }
    if (header.header_bytes != sizeof(ProtocolHeader)) {
        return ContractStatus::kHeaderSizeMismatch;
    }
    if (header.session_generation == 0u) {
        return ContractStatus::kInvalidSessionGeneration;
    }
    if (header.capacity_frames == 0u) {
        return ContractStatus::kInvalidCapacity;
    }
    if (header.sample_format != kSampleFormatF32Le) {
        return ContractStatus::kUnsupportedSampleFormat;
    }
    if (header.frame_duration_micros == 0u || header.frame_duration_micros % 1000u != 0u) {
        return ContractStatus::kInvalidFrameDuration;
    }

    const uint32_t frame_duration_ms = header.frame_duration_micros / 1000u;
    if (frame_duration_ms == 0u || frame_duration_ms > 100u) {
        return ContractStatus::kInvalidFrameDuration;
    }
    if (header.sample_rate_hz == 0u) {
        return ContractStatus::kInvalidSampleRate;
    }
    if (header.channels == 0u) {
        return ContractStatus::kInvalidChannelCount;
    }

    const uint64_t per_channel_numerator =
        static_cast<uint64_t>(header.sample_rate_hz) * static_cast<uint64_t>(frame_duration_ms);
    if (per_channel_numerator % 1000u != 0u) {
        return ContractStatus::kNonIntegralFrameSize;
    }

    const uint64_t samples_per_channel = per_channel_numerator / 1000u;
    const uint64_t expected_samples = samples_per_channel * static_cast<uint64_t>(header.channels);
    if (expected_samples > UINT32_MAX || header.samples_per_frame != expected_samples) {
        return ContractStatus::kSamplesPerFrameMismatch;
    }
    if (header.reserved != 0u) {
        return ContractStatus::kReservedFieldNonZero;
    }

    return ContractStatus::kOk;
}

constexpr ContractStatus PlanRingWindow(
    const ProtocolHeader& header,
    const CursorSnapshot& cursors,
    RingWindow* output) noexcept {
    if (output == nullptr) {
        return ContractStatus::kNullOutput;
    }

    const ContractStatus header_status = ValidateHeader(header);
    if (header_status != ContractStatus::kOk) {
        return header_status;
    }
    if (cursors.session_generation != header.session_generation) {
        return ContractStatus::kSessionGenerationMismatch;
    }
    if (cursors.producer_sequence < cursors.consumer_sequence) {
        return ContractStatus::kCursorOrderInvalid;
    }

    const uint64_t capacity = header.capacity_frames;
    const uint64_t raw_buffered = cursors.producer_sequence - cursors.consumer_sequence;
    const uint64_t dropped = raw_buffered > capacity ? raw_buffered - capacity : 0u;
    const uint64_t normalized_consumer =
        dropped == 0u ? cursors.consumer_sequence : cursors.producer_sequence - capacity;
    const uint64_t buffered = raw_buffered < capacity ? raw_buffered : capacity;

    output->capacity_frames = capacity;
    output->buffered_frames = buffered;
    output->producer_slot = static_cast<uint32_t>(cursors.producer_sequence % capacity);
    output->consumer_slot = static_cast<uint32_t>(normalized_consumer % capacity);
    output->normalized_consumer_sequence = normalized_consumer;
    output->dropped_frames = dropped;
    return ContractStatus::kOk;
}

} // namespace vsn::virtual_mic
