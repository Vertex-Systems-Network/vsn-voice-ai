#include "vsn_virtual_mic_cursor_sync.h"

#include <cstdio>

namespace {

using vsn::virtual_mic::CursorSnapshot;
using vsn::virtual_mic::CursorSyncStatus;
using vsn::virtual_mic::InitializeCursorSession;
using vsn::virtual_mic::PublishConsumerSequence;
using vsn::virtual_mic::PublishProducerSequence;
using vsn::virtual_mic::ReadStableCursorSnapshot;
using vsn::virtual_mic::RecordOverrunDrop;
using vsn::virtual_mic::RecordUnderrun;

int Require(bool condition, const char* message) {
    if (condition) {
        return 0;
    }
    std::fprintf(stderr, "virtual-mic cursor synchronization validation failed: %s\n", message);
    return 1;
}

} // namespace

int main() {
    CursorSnapshot shared{};
    if (Require(
            InitializeCursorSession(&shared, 11u) == CursorSyncStatus::kOk,
            "session initialization failed")) {
        return 1;
    }

    CursorSnapshot snapshot{};
    if (Require(
            ReadStableCursorSnapshot(&shared, &snapshot) == CursorSyncStatus::kOk,
            "stable initial snapshot rejected") ||
        Require(snapshot.session_generation == 11u, "session generation mismatch") ||
        Require(snapshot.producer_sequence == 0u, "producer did not reset") ||
        Require(snapshot.consumer_sequence == 0u, "consumer did not reset")) {
        return 1;
    }

    if (Require(
            PublishProducerSequence(&shared, 11u, 1u) == CursorSyncStatus::kOk,
            "producer publication failed") ||
        Require(
            PublishProducerSequence(&shared, 11u, 3u) == CursorSyncStatus::kOk,
            "producer advance failed") ||
        Require(
            PublishConsumerSequence(&shared, 11u, 2u) == CursorSyncStatus::kOk,
            "consumer publication failed")) {
        return 1;
    }

    if (Require(
            RecordOverrunDrop(&shared) == CursorSyncStatus::kOk,
            "overrun counter update failed") ||
        Require(
            RecordUnderrun(&shared) == CursorSyncStatus::kOk,
            "underrun counter update failed")) {
        return 1;
    }

    if (Require(
            ReadStableCursorSnapshot(&shared, &snapshot) == CursorSyncStatus::kOk,
            "advanced stable snapshot rejected") ||
        Require(snapshot.producer_sequence == 3u, "producer snapshot mismatch") ||
        Require(snapshot.consumer_sequence == 2u, "consumer snapshot mismatch") ||
        Require(snapshot.overrun_drops == 1u, "overrun snapshot mismatch") ||
        Require(snapshot.underruns == 1u, "underrun snapshot mismatch")) {
        return 1;
    }

    if (Require(
            PublishProducerSequence(&shared, 11u, 2u) ==
                CursorSyncStatus::kProducerSequenceRegression,
            "producer regression was accepted") ||
        Require(
            PublishConsumerSequence(&shared, 11u, 1u) ==
                CursorSyncStatus::kConsumerSequenceRegression,
            "consumer regression was accepted") ||
        Require(
            PublishConsumerSequence(&shared, 11u, 4u) ==
                CursorSyncStatus::kConsumerAheadOfProducer,
            "consumer advance beyond producer was accepted")) {
        return 1;
    }

    if (Require(
            PublishProducerSequence(&shared, 12u, 4u) ==
                CursorSyncStatus::kSessionGenerationMismatch,
            "stale producer generation was accepted") ||
        Require(
            PublishConsumerSequence(&shared, 12u, 3u) ==
                CursorSyncStatus::kSessionGenerationMismatch,
            "stale consumer generation was accepted")) {
        return 1;
    }

    if (Require(
            InitializeCursorSession(&shared, 12u) == CursorSyncStatus::kOk,
            "session rollover failed") ||
        Require(
            ReadStableCursorSnapshot(&shared, &snapshot) == CursorSyncStatus::kOk,
            "rolled session snapshot rejected") ||
        Require(snapshot.session_generation == 12u, "rolled generation mismatch") ||
        Require(snapshot.producer_sequence == 0u, "rolled producer did not reset") ||
        Require(snapshot.consumer_sequence == 0u, "rolled consumer did not reset") ||
        Require(snapshot.overrun_drops == 0u, "rolled overrun counter did not reset") ||
        Require(snapshot.underruns == 0u, "rolled underrun counter did not reset")) {
        return 1;
    }

    if (Require(
            InitializeCursorSession(&shared, 0u) == CursorSyncStatus::kInvalidSessionGeneration,
            "zero generation was accepted") ||
        Require(
            ReadStableCursorSnapshot(nullptr, &snapshot) == CursorSyncStatus::kNullSharedState,
            "null shared state was accepted") ||
        Require(
            ReadStableCursorSnapshot(&shared, nullptr) == CursorSyncStatus::kNullOutput,
            "null snapshot output was accepted")) {
        return 1;
    }

    std::puts("VSN virtual microphone shared cursor synchronization validation passed.");
    return 0;
}
