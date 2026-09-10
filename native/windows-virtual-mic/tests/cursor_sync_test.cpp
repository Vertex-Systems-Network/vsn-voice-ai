#include "vsn_virtual_mic_cursor_sync.h"
#include "vsn_virtual_mic_region_layout.h"

#include <cstdio>

namespace {

using vsn::virtual_mic::CursorSnapshot;
using vsn::virtual_mic::CursorSyncStatus;
using vsn::virtual_mic::InitializeCursorSession;
using vsn::virtual_mic::PlanSharedRegionLayout;
using vsn::virtual_mic::ProtocolHeader;
using vsn::virtual_mic::PublishConsumerSequence;
using vsn::virtual_mic::PublishProducerSequence;
using vsn::virtual_mic::ReadStableCursorSnapshot;
using vsn::virtual_mic::RecordOverrunDrop;
using vsn::virtual_mic::RecordUnderrun;
using vsn::virtual_mic::SharedRegionLayout;
using vsn::virtual_mic::SharedRegionStatus;
using vsn::virtual_mic::kProtocolMagic;
using vsn::virtual_mic::kProtocolVersion;
using vsn::virtual_mic::kSampleFormatF32Le;

int Require(bool condition, const char* message) {
    if (condition) {
        return 0;
    }
    std::fprintf(stderr, "virtual-mic cursor synchronization validation failed: %s\n", message);
    return 1;
}

ProtocolHeader ReferenceHeader() {
    return ProtocolHeader{
        kProtocolMagic,
        kProtocolVersion,
        static_cast<uint16_t>(sizeof(ProtocolHeader)),
        11u,
        48'000u,
        1u,
        kSampleFormatF32Le,
        10'000u,
        4u,
        480u,
        0u,
    };
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

    const ProtocolHeader reference = ReferenceHeader();
    SharedRegionLayout layout{};
    if (Require(
            PlanSharedRegionLayout(reference, &layout) == SharedRegionStatus::kOk,
            "reference shared-region layout rejected") ||
        Require(layout.header_offset == 0u, "header offset mismatch") ||
        Require(layout.header_bytes == 40u, "header byte size mismatch") ||
        Require(layout.cursor_offset == 64u, "cursor offset mismatch") ||
        Require(layout.cursor_bytes == 40u, "cursor byte size mismatch") ||
        Require(layout.audio_offset == 128u, "audio offset mismatch") ||
        Require(layout.frame_bytes == 1'920u, "frame byte size mismatch") ||
        Require(layout.ring_bytes == 7'680u, "ring byte size mismatch") ||
        Require(layout.total_bytes == 7'808u, "shared-region total byte size mismatch")) {
        return 1;
    }

    ProtocolHeader invalid_header = reference;
    invalid_header.magic = 0u;
    if (Require(
            PlanSharedRegionLayout(invalid_header, &layout) ==
                SharedRegionStatus::kInvalidHeader,
            "invalid protocol header produced a shared-region layout") ||
        Require(
            PlanSharedRegionLayout(reference, nullptr) == SharedRegionStatus::kNullOutput,
            "null shared-region output was accepted")) {
        return 1;
    }

    ProtocolHeader oversized = reference;
    oversized.sample_rate_hz = 4'000'000'000u;
    oversized.channels = 100u;
    oversized.samples_per_frame = 4'000'000'000u;
    oversized.capacity_frames = UINT32_MAX;
    if (Require(
            PlanSharedRegionLayout(oversized, &layout) == SharedRegionStatus::kSizeOverflow,
            "overflowing shared-region size was accepted")) {
        return 1;
    }

    std::puts("VSN virtual microphone shared cursor synchronization validation passed.");
    return 0;
}
