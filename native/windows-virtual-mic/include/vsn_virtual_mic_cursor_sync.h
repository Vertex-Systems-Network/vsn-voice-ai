#pragma once

#include "vsn_virtual_mic_protocol.h"

#if !defined(_WIN32)
#error "VSN virtual microphone cursor synchronization is Windows-only"
#endif

#if defined(_NTDDK_) || defined(_WDMDDK_) || defined(_NTIFS_)
// Kernel-mode callers include WDF/NT headers before this shared helper.
#else
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <Windows.h>
#endif

#include <stdint.h>

namespace vsn::virtual_mic {

// CursorSnapshot doubles as the shared cursor block for the initial x64 transport
// contract. Each mutable 64-bit field is accessed through Windows Interlocked
// operations so publication carries a full memory barrier. The transport remains
// single-producer/single-consumer: user mode owns producer_sequence, the driver
// owns consumer_sequence, and session reset must occur only after both endpoints
// are quiesced.
static_assert(alignof(CursorSnapshot) >= 8u, "shared cursor block must remain 64-bit aligned");
static_assert(offsetof(CursorSnapshot, producer_sequence) % 8u == 0u, "producer cursor must remain 64-bit aligned");
static_assert(offsetof(CursorSnapshot, consumer_sequence) % 8u == 0u, "consumer cursor must remain 64-bit aligned");
static_assert(offsetof(CursorSnapshot, overrun_drops) % 8u == 0u, "overrun counter must remain 64-bit aligned");
static_assert(offsetof(CursorSnapshot, underruns) % 8u == 0u, "underrun counter must remain 64-bit aligned");

constexpr uint32_t kStableSnapshotAttempts = 8u;

enum class CursorSyncStatus : uint32_t {
    kOk = 0u,
    kNullSharedState,
    kNullOutput,
    kInvalidSessionGeneration,
    kSessionGenerationMismatch,
    kProducerSequenceRegression,
    kConsumerSequenceRegression,
    kConsumerAheadOfProducer,
    kFrameSequenceOverflow,
    kSnapshotUnstable,
};

inline volatile LONG64* InterlockedAddress(uint64_t* value) noexcept {
    static_assert(sizeof(LONG64) == sizeof(uint64_t), "Windows LONG64 width changed");
    return reinterpret_cast<volatile LONG64*>(value);
}

inline volatile LONG64* InterlockedAddress(const uint64_t* value) noexcept {
    return InterlockedAddress(const_cast<uint64_t*>(value));
}

inline uint64_t AtomicLoad64(const uint64_t* value) noexcept {
    const LONG64 observed = InterlockedCompareExchange64(InterlockedAddress(value), 0, 0);
    return static_cast<uint64_t>(observed);
}

inline void AtomicStore64(uint64_t* value, uint64_t next) noexcept {
    (void)InterlockedExchange64(InterlockedAddress(value), static_cast<LONG64>(next));
}

inline uint64_t AtomicIncrement64(uint64_t* value) noexcept {
    const LONG64 next = InterlockedIncrement64(InterlockedAddress(value));
    return static_cast<uint64_t>(next);
}

inline uint64_t AtomicAdd64(uint64_t* value, uint64_t amount) noexcept {
    if (amount == 0u) {
        return AtomicLoad64(value);
    }
    const LONG64 previous = InterlockedExchangeAdd64(
        InterlockedAddress(value),
        static_cast<LONG64>(amount));
    return static_cast<uint64_t>(previous) + amount;
}

inline CursorSyncStatus ReadStableCursorSnapshot(
    const CursorSnapshot* shared,
    CursorSnapshot* output,
    uint32_t max_attempts = kStableSnapshotAttempts) noexcept {
    if (shared == nullptr) {
        return CursorSyncStatus::kNullSharedState;
    }
    if (output == nullptr) {
        return CursorSyncStatus::kNullOutput;
    }

    for (uint32_t attempt = 0u; attempt < max_attempts; ++attempt) {
        const uint64_t generation_before = AtomicLoad64(&shared->session_generation);
        if (generation_before == 0u) {
            return CursorSyncStatus::kInvalidSessionGeneration;
        }

        const uint64_t producer = AtomicLoad64(&shared->producer_sequence);
        const uint64_t consumer = AtomicLoad64(&shared->consumer_sequence);
        const uint64_t overrun_drops = AtomicLoad64(&shared->overrun_drops);
        const uint64_t underruns = AtomicLoad64(&shared->underruns);
        const uint64_t generation_after = AtomicLoad64(&shared->session_generation);

        if (generation_before != generation_after || producer < consumer) {
            continue;
        }

        *output = CursorSnapshot{
            generation_before,
            producer,
            consumer,
            overrun_drops,
            underruns,
        };
        return CursorSyncStatus::kOk;
    }

    return CursorSyncStatus::kSnapshotUnstable;
}

inline CursorSyncStatus InitializeCursorSession(
    CursorSnapshot* shared,
    uint64_t session_generation) noexcept {
    if (shared == nullptr) {
        return CursorSyncStatus::kNullSharedState;
    }
    if (session_generation == 0u) {
        return CursorSyncStatus::kInvalidSessionGeneration;
    }

    // Zero is an invalid generation and acts as a bounded reset marker. The
    // caller must have quiesced producer and consumer endpoints before reset.
    AtomicStore64(&shared->session_generation, 0u);
    AtomicStore64(&shared->producer_sequence, 0u);
    AtomicStore64(&shared->consumer_sequence, 0u);
    AtomicStore64(&shared->overrun_drops, 0u);
    AtomicStore64(&shared->underruns, 0u);
    AtomicStore64(&shared->session_generation, session_generation);
    return CursorSyncStatus::kOk;
}

inline CursorSyncStatus PublishProducerSequence(
    CursorSnapshot* shared,
    uint64_t expected_generation,
    uint64_t next_sequence) noexcept {
    if (shared == nullptr) {
        return CursorSyncStatus::kNullSharedState;
    }
    if (expected_generation == 0u) {
        return CursorSyncStatus::kInvalidSessionGeneration;
    }
    if (next_sequence > kMaxFrameSequence + 1u) {
        return CursorSyncStatus::kFrameSequenceOverflow;
    }
    if (AtomicLoad64(&shared->session_generation) != expected_generation) {
        return CursorSyncStatus::kSessionGenerationMismatch;
    }

    const uint64_t current = AtomicLoad64(&shared->producer_sequence);
    const uint64_t consumer = AtomicLoad64(&shared->consumer_sequence);
    if (next_sequence < current) {
        return CursorSyncStatus::kProducerSequenceRegression;
    }
    if (next_sequence < consumer) {
        return CursorSyncStatus::kConsumerAheadOfProducer;
    }

    // User mode must commit the per-slot stable stamp only after the complete
    // PCM slot write, then publish this global cursor. AtomicStore64 is the
    // publication barrier on Windows.
    AtomicStore64(&shared->producer_sequence, next_sequence);
    return CursorSyncStatus::kOk;
}

inline CursorSyncStatus PublishConsumerSequence(
    CursorSnapshot* shared,
    uint64_t expected_generation,
    uint64_t next_sequence) noexcept {
    if (shared == nullptr) {
        return CursorSyncStatus::kNullSharedState;
    }
    if (expected_generation == 0u) {
        return CursorSyncStatus::kInvalidSessionGeneration;
    }
    if (next_sequence > kMaxFrameSequence + 1u) {
        return CursorSyncStatus::kFrameSequenceOverflow;
    }
    if (AtomicLoad64(&shared->session_generation) != expected_generation) {
        return CursorSyncStatus::kSessionGenerationMismatch;
    }

    const uint64_t current = AtomicLoad64(&shared->consumer_sequence);
    const uint64_t producer = AtomicLoad64(&shared->producer_sequence);
    if (next_sequence < current) {
        return CursorSyncStatus::kConsumerSequenceRegression;
    }
    if (next_sequence > producer) {
        return CursorSyncStatus::kConsumerAheadOfProducer;
    }

    // The consumer must finish validating/copying the PCM slot before
    // publishing this cursor. The full barrier prevents slot reuse from racing
    // ahead of completed reads.
    AtomicStore64(&shared->consumer_sequence, next_sequence);
    return CursorSyncStatus::kOk;
}

inline CursorSyncStatus RecordOverrunDrops(
    CursorSnapshot* shared,
    uint64_t dropped_frames) noexcept {
    if (shared == nullptr) {
        return CursorSyncStatus::kNullSharedState;
    }
    (void)AtomicAdd64(&shared->overrun_drops, dropped_frames);
    return CursorSyncStatus::kOk;
}

inline CursorSyncStatus RecordOverrunDrop(CursorSnapshot* shared) noexcept {
    return RecordOverrunDrops(shared, 1u);
}

inline CursorSyncStatus RecordUnderrun(CursorSnapshot* shared) noexcept {
    if (shared == nullptr) {
        return CursorSyncStatus::kNullSharedState;
    }
    (void)AtomicIncrement64(&shared->underruns);
    return CursorSyncStatus::kOk;
}

} // namespace vsn::virtual_mic
