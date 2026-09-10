#pragma once

#include "vsn_virtual_mic_cursor_sync.h"

#include <stdint.h>

namespace vsn::virtual_mic {

enum class SlotSyncStatus : uint32_t {
    kOk = 0u,
    kNullStamps,
    kInvalidCapacity,
    kFrameSequenceOverflow,
    kSlotStateMismatch,
};

inline uint32_t SlotIndexForSequence(uint64_t sequence, uint32_t capacity_frames) noexcept {
    return static_cast<uint32_t>(sequence % static_cast<uint64_t>(capacity_frames));
}

inline SlotSyncStatus BeginSlotWrite(
    FrameSlotStamp* stamps,
    uint32_t capacity_frames,
    uint64_t sequence) noexcept {
    if (stamps == nullptr) {
        return SlotSyncStatus::kNullStamps;
    }
    if (capacity_frames == 0u) {
        return SlotSyncStatus::kInvalidCapacity;
    }
    if (!CanEncodeFrameSequence(sequence)) {
        return SlotSyncStatus::kFrameSequenceOverflow;
    }

    const uint32_t slot = SlotIndexForSequence(sequence, capacity_frames);
    AtomicStore64(&stamps[slot].value, EncodeWritingSlotStamp(sequence));
    return SlotSyncStatus::kOk;
}

inline SlotSyncStatus CommitSlotWrite(
    FrameSlotStamp* stamps,
    uint32_t capacity_frames,
    uint64_t sequence) noexcept {
    if (stamps == nullptr) {
        return SlotSyncStatus::kNullStamps;
    }
    if (capacity_frames == 0u) {
        return SlotSyncStatus::kInvalidCapacity;
    }
    if (!CanEncodeFrameSequence(sequence)) {
        return SlotSyncStatus::kFrameSequenceOverflow;
    }

    const uint32_t slot = SlotIndexForSequence(sequence, capacity_frames);
    const uint64_t expected_writing = EncodeWritingSlotStamp(sequence);
    if (AtomicLoad64(&stamps[slot].value) != expected_writing) {
        return SlotSyncStatus::kSlotStateMismatch;
    }

    // Producer must finish the complete PCM slot before this publication.
    // InterlockedExchange64 in AtomicStore64 is the full publication barrier.
    AtomicStore64(&stamps[slot].value, EncodeStableSlotStamp(sequence));
    return SlotSyncStatus::kOk;
}

inline SlotSyncStatus ReadSlotStamp(
    const FrameSlotStamp* stamps,
    uint32_t capacity_frames,
    uint64_t sequence,
    uint64_t* output) noexcept {
    if (stamps == nullptr || output == nullptr) {
        return SlotSyncStatus::kNullStamps;
    }
    if (capacity_frames == 0u) {
        return SlotSyncStatus::kInvalidCapacity;
    }
    if (!CanEncodeFrameSequence(sequence)) {
        return SlotSyncStatus::kFrameSequenceOverflow;
    }

    const uint32_t slot = SlotIndexForSequence(sequence, capacity_frames);
    *output = AtomicLoad64(&stamps[slot].value);
    return SlotSyncStatus::kOk;
}

inline bool SlotIsStableForSequence(
    const FrameSlotStamp* stamps,
    uint32_t capacity_frames,
    uint64_t sequence) noexcept {
    uint64_t observed = 0u;
    return ReadSlotStamp(stamps, capacity_frames, sequence, &observed) == SlotSyncStatus::kOk &&
        observed == EncodeStableSlotStamp(sequence);
}

} // namespace vsn::virtual_mic
