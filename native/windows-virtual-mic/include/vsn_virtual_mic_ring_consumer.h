#pragma once

#include "vsn_virtual_mic_region_layout.h"
#include "vsn_virtual_mic_slot_sync.h"

#if !defined(_WIN32)
#error "VSN virtual microphone ring consumer is Windows-only"
#endif

#if !defined(_NTDDK_) && !defined(_WDMDDK_) && !defined(_NTIFS_)
#include <cstring>
#endif

#include <stdint.h>

namespace vsn::virtual_mic {

enum class RingConsumeStatus : uint32_t {
    kOk = 0u,
    kUnderrun,
    kSlotUnstable,
    kNullRegion,
    kNullOutput,
    kNullResult,
    kInvalidHeader,
    kGenerationMismatch,
    kRegionTooSmall,
    kOutputSizeMismatch,
    kCursorReadFailed,
    kRingPlanFailed,
    kCursorPublishFailed,
    kFrameSequenceOverflow,
};

struct RingConsumeResult final {
    uint64_t frame_sequence;
    uint64_t dropped_frames;
    uint32_t slot_index;
    uint32_t produced_silence;
};

inline void CopyRingBytes(void* destination, const void* source, uint64_t bytes) noexcept {
#if defined(_NTDDK_) || defined(_WDMDDK_) || defined(_NTIFS_)
    RtlCopyMemory(destination, source, static_cast<SIZE_T>(bytes));
#else
    std::memcpy(destination, source, static_cast<size_t>(bytes));
#endif
}

inline void ZeroRingBytes(void* destination, uint64_t bytes) noexcept {
#if defined(_NTDDK_) || defined(_WDMDDK_) || defined(_NTIFS_)
    RtlZeroMemory(destination, static_cast<SIZE_T>(bytes));
#else
    std::memset(destination, 0, static_cast<size_t>(bytes));
#endif
}

inline void RingReadBarrier() noexcept {
#if defined(_NTDDK_) || defined(_WDMDDK_) || defined(_NTIFS_)
    KeMemoryBarrier();
#else
    MemoryBarrier();
#endif
}

// Consumes at most one complete PCM frame. This helper never trusts the mutable
// protocol bytes in the shared region: authoritative_header must be the
// validated immutable copy retained by the driver at CONNECT time.
//
// If a producer has overrun the consumer, the logical consumer cursor is first
// advanced to the oldest still-retained frame and the exact number of dropped
// frames is accounted. A per-slot v2 stamp is checked before and after the PCM
// copy. If the producer is concurrently reusing the slot, no torn frame is
// exposed: the output is zeroed and kSlotUnstable is returned for the realtime
// caller to handle without blocking.
inline RingConsumeStatus ConsumeOneRingFrame(
    const ProtocolHeader& authoritative_header,
    uint64_t expected_generation,
    void* shared_region,
    uint64_t shared_region_bytes,
    void* output_frame,
    uint64_t output_frame_bytes,
    RingConsumeResult* result) noexcept {
    if (shared_region == nullptr) {
        return RingConsumeStatus::kNullRegion;
    }
    if (output_frame == nullptr) {
        return RingConsumeStatus::kNullOutput;
    }
    if (result == nullptr) {
        return RingConsumeStatus::kNullResult;
    }

    *result = RingConsumeResult{};

    if (ValidateHeader(authoritative_header) != ContractStatus::kOk) {
        return RingConsumeStatus::kInvalidHeader;
    }
    if (expected_generation == 0u ||
        authoritative_header.session_generation != expected_generation) {
        return RingConsumeStatus::kGenerationMismatch;
    }

    SharedRegionLayout layout{};
    if (PlanSharedRegionLayout(authoritative_header, &layout) != SharedRegionStatus::kOk) {
        return RingConsumeStatus::kInvalidHeader;
    }
    if (shared_region_bytes < layout.total_bytes) {
        return RingConsumeStatus::kRegionTooSmall;
    }
    if (output_frame_bytes != layout.frame_bytes) {
        return RingConsumeStatus::kOutputSizeMismatch;
    }

    auto* bytes = static_cast<uint8_t*>(shared_region);
    auto* cursors = reinterpret_cast<CursorSnapshot*>(bytes + layout.cursor_offset);
    auto* stamps = reinterpret_cast<FrameSlotStamp*>(bytes + layout.slot_stamps_offset);
    auto* audio = bytes + layout.audio_offset;

    CursorSnapshot snapshot{};
    if (ReadStableCursorSnapshot(cursors, &snapshot) != CursorSyncStatus::kOk) {
        return RingConsumeStatus::kCursorReadFailed;
    }
    if (snapshot.session_generation != expected_generation) {
        return RingConsumeStatus::kGenerationMismatch;
    }

    RingWindow window{};
    const ContractStatus plan_status = PlanRingWindow(authoritative_header, snapshot, &window);
    if (plan_status == ContractStatus::kFrameSequenceOverflow) {
        return RingConsumeStatus::kFrameSequenceOverflow;
    }
    if (plan_status != ContractStatus::kOk) {
        return RingConsumeStatus::kRingPlanFailed;
    }

    if (window.dropped_frames != 0u) {
        if (PublishConsumerSequence(
                cursors,
                expected_generation,
                window.normalized_consumer_sequence) != CursorSyncStatus::kOk) {
            return RingConsumeStatus::kCursorPublishFailed;
        }
        if (RecordOverrunDrops(cursors, window.dropped_frames) != CursorSyncStatus::kOk) {
            return RingConsumeStatus::kCursorPublishFailed;
        }
        result->dropped_frames = window.dropped_frames;
    }

    if (window.buffered_frames == 0u) {
        ZeroRingBytes(output_frame, output_frame_bytes);
        if (RecordUnderrun(cursors) != CursorSyncStatus::kOk) {
            return RingConsumeStatus::kCursorPublishFailed;
        }
        result->frame_sequence = window.normalized_consumer_sequence;
        result->slot_index = window.consumer_slot;
        result->produced_silence = 1u;
        return RingConsumeStatus::kUnderrun;
    }

    const uint64_t sequence = window.normalized_consumer_sequence;
    if (!CanEncodeFrameSequence(sequence)) {
        ZeroRingBytes(output_frame, output_frame_bytes);
        return RingConsumeStatus::kFrameSequenceOverflow;
    }

    const uint32_t slot = SlotIndexForSequence(sequence, authoritative_header.capacity_frames);
    const uint64_t expected_stamp = EncodeStableSlotStamp(sequence);
    const uint64_t stamp_before = AtomicLoad64(&stamps[slot].value);
    if (stamp_before != expected_stamp) {
        ZeroRingBytes(output_frame, output_frame_bytes);
        result->frame_sequence = sequence;
        result->slot_index = slot;
        result->produced_silence = 1u;
        return RingConsumeStatus::kSlotUnstable;
    }

    const uint64_t slot_offset = static_cast<uint64_t>(slot) * layout.frame_bytes;
    CopyRingBytes(output_frame, audio + slot_offset, layout.frame_bytes);
    RingReadBarrier();

    const uint64_t stamp_after = AtomicLoad64(&stamps[slot].value);
    if (stamp_after != expected_stamp) {
        ZeroRingBytes(output_frame, output_frame_bytes);
        result->frame_sequence = sequence;
        result->slot_index = slot;
        result->produced_silence = 1u;
        return RingConsumeStatus::kSlotUnstable;
    }

    if (PublishConsumerSequence(
            cursors,
            expected_generation,
            sequence + 1u) != CursorSyncStatus::kOk) {
        ZeroRingBytes(output_frame, output_frame_bytes);
        return RingConsumeStatus::kCursorPublishFailed;
    }

    result->frame_sequence = sequence;
    result->slot_index = slot;
    result->produced_silence = 0u;
    return RingConsumeStatus::kOk;
}

} // namespace vsn::virtual_mic
