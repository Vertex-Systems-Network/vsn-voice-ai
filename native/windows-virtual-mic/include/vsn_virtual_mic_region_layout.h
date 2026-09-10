#pragma once

#include "vsn_virtual_mic_protocol.h"

#include <stdint.h>

namespace vsn::virtual_mic {

constexpr uint64_t kSharedRegionAlignment = 64u;
constexpr uint64_t kF32SampleBytes = 4u;

static_assert((kSharedRegionAlignment & (kSharedRegionAlignment - 1u)) == 0u,
              "shared region alignment must remain a power of two");
static_assert(sizeof(float) == kF32SampleBytes,
              "virtual microphone F32 sample width drifted");

enum class SharedRegionStatus : uint32_t {
    kOk = 0u,
    kInvalidHeader,
    kSizeOverflow,
    kNullOutput,
};

struct SharedRegionLayout final {
    uint64_t header_offset;
    uint64_t header_bytes;
    uint64_t cursor_offset;
    uint64_t cursor_bytes;
    uint64_t audio_offset;
    uint64_t frame_bytes;
    uint64_t ring_bytes;
    uint64_t total_bytes;
};

constexpr bool CheckedAlignUp(
    uint64_t value,
    uint64_t alignment,
    uint64_t* output) noexcept {
    if (output == nullptr || alignment == 0u || (alignment & (alignment - 1u)) != 0u) {
        return false;
    }

    const uint64_t mask = alignment - 1u;
    if (value > UINT64_MAX - mask) {
        return false;
    }

    *output = (value + mask) & ~mask;
    return true;
}

constexpr SharedRegionStatus PlanSharedRegionLayout(
    const ProtocolHeader& header,
    SharedRegionLayout* output) noexcept {
    if (output == nullptr) {
        return SharedRegionStatus::kNullOutput;
    }
    if (ValidateHeader(header) != ContractStatus::kOk) {
        return SharedRegionStatus::kInvalidHeader;
    }

    uint64_t cursor_offset = 0u;
    if (!CheckedAlignUp(sizeof(ProtocolHeader), kSharedRegionAlignment, &cursor_offset)) {
        return SharedRegionStatus::kSizeOverflow;
    }

    if (cursor_offset > UINT64_MAX - sizeof(CursorSnapshot)) {
        return SharedRegionStatus::kSizeOverflow;
    }
    const uint64_t cursor_end = cursor_offset + sizeof(CursorSnapshot);

    uint64_t audio_offset = 0u;
    if (!CheckedAlignUp(cursor_end, kSharedRegionAlignment, &audio_offset)) {
        return SharedRegionStatus::kSizeOverflow;
    }

    const uint64_t samples_per_frame = header.samples_per_frame;
    if (samples_per_frame > UINT64_MAX / kF32SampleBytes) {
        return SharedRegionStatus::kSizeOverflow;
    }
    const uint64_t frame_bytes = samples_per_frame * kF32SampleBytes;

    const uint64_t capacity_frames = header.capacity_frames;
    if (frame_bytes != 0u && capacity_frames > UINT64_MAX / frame_bytes) {
        return SharedRegionStatus::kSizeOverflow;
    }
    const uint64_t ring_bytes = capacity_frames * frame_bytes;

    if (audio_offset > UINT64_MAX - ring_bytes) {
        return SharedRegionStatus::kSizeOverflow;
    }

    output->header_offset = 0u;
    output->header_bytes = sizeof(ProtocolHeader);
    output->cursor_offset = cursor_offset;
    output->cursor_bytes = sizeof(CursorSnapshot);
    output->audio_offset = audio_offset;
    output->frame_bytes = frame_bytes;
    output->ring_bytes = ring_bytes;
    output->total_bytes = audio_offset + ring_bytes;
    return SharedRegionStatus::kOk;
}

} // namespace vsn::virtual_mic
