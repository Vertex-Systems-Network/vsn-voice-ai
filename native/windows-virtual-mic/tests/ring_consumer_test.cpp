#include "vsn_virtual_mic_ring_consumer.h"

#include <cstdio>
#include <cstring>
#include <vector>

namespace {

using namespace vsn::virtual_mic;

int Require(bool condition, const char* message) {
    if (condition) {
        return 0;
    }
    std::fprintf(stderr, "virtual-mic ring consumer validation failed: %s\n", message);
    return 1;
}

ProtocolHeader ReferenceHeader(uint32_t capacity_frames = 4u) {
    return ProtocolHeader{
        kProtocolMagic,
        kProtocolVersion,
        static_cast<uint16_t>(sizeof(ProtocolHeader)),
        31u,
        48'000u,
        1u,
        kSampleFormatF32Le,
        10'000u,
        capacity_frames,
        480u,
        0u,
    };
}

struct RegionFixture final {
    ProtocolHeader header{};
    SharedRegionLayout layout{};
    std::vector<uint8_t> bytes;

    CursorSnapshot* cursors() noexcept {
        return reinterpret_cast<CursorSnapshot*>(bytes.data() + layout.cursor_offset);
    }

    FrameSlotStamp* stamps() noexcept {
        return reinterpret_cast<FrameSlotStamp*>(bytes.data() + layout.slot_stamps_offset);
    }

    uint8_t* audio() noexcept {
        return bytes.data() + layout.audio_offset;
    }
};

bool InitializeFixture(uint32_t capacity_frames, RegionFixture* fixture) {
    if (fixture == nullptr) {
        return false;
    }

    fixture->header = ReferenceHeader(capacity_frames);
    if (PlanSharedRegionLayout(fixture->header, &fixture->layout) != SharedRegionStatus::kOk) {
        return false;
    }
    fixture->bytes.assign(static_cast<size_t>(fixture->layout.total_bytes), 0u);
    std::memcpy(fixture->bytes.data(), &fixture->header, sizeof(fixture->header));
    return InitializeCursorSession(
               fixture->cursors(), fixture->header.session_generation) == CursorSyncStatus::kOk;
}

bool ProduceFrame(RegionFixture* fixture, uint64_t sequence, uint8_t fill) {
    if (fixture == nullptr) {
        return false;
    }

    if (BeginSlotWrite(
            fixture->stamps(), fixture->header.capacity_frames, sequence) != SlotSyncStatus::kOk) {
        return false;
    }

    const uint32_t slot = SlotIndexForSequence(sequence, fixture->header.capacity_frames);
    std::memset(
        fixture->audio() + static_cast<size_t>(slot * fixture->layout.frame_bytes),
        fill,
        static_cast<size_t>(fixture->layout.frame_bytes));

    return CommitSlotWrite(
               fixture->stamps(), fixture->header.capacity_frames, sequence) == SlotSyncStatus::kOk &&
        PublishProducerSequence(
            fixture->cursors(), fixture->header.session_generation, sequence + 1u) ==
            CursorSyncStatus::kOk;
}

bool AllBytesEqual(const std::vector<uint8_t>& bytes, uint8_t expected) {
    for (const uint8_t value : bytes) {
        if (value != expected) {
            return false;
        }
    }
    return true;
}

} // namespace

int main() {
    RegionFixture reference{};
    if (Require(InitializeFixture(4u, &reference), "reference fixture initialization failed") ||
        Require(kProtocolVersion == 2u, "protocol version did not advance to v2") ||
        Require(reference.layout.header_offset == 0u, "header offset drifted") ||
        Require(reference.layout.cursor_offset == 64u, "cursor offset drifted") ||
        Require(reference.layout.slot_stamps_offset == 128u, "slot stamp offset drifted") ||
        Require(reference.layout.slot_stamp_bytes == 8u, "slot stamp width drifted") ||
        Require(reference.layout.slot_stamps_bytes == 32u, "slot stamp region size drifted") ||
        Require(reference.layout.audio_offset == 192u, "audio offset drifted") ||
        Require(reference.layout.frame_bytes == 1'920u, "frame size drifted") ||
        Require(reference.layout.ring_bytes == 7'680u, "ring size drifted") ||
        Require(reference.layout.total_bytes == 7'872u, "total mapping size drifted")) {
        return 1;
    }

    // Empty ring: produce deterministic fresh silence and account one underrun
    // without advancing the logical consumer cursor.
    std::vector<uint8_t> output(static_cast<size_t>(reference.layout.frame_bytes), 0xA5u);
    RingConsumeResult consume{};
    if (Require(
            ConsumeOneRingFrame(
                reference.header,
                reference.header.session_generation,
                reference.bytes.data(),
                reference.bytes.size(),
                output.data(),
                output.size(),
                &consume) == RingConsumeStatus::kUnderrun,
            "empty ring did not report underrun") ||
        Require(AllBytesEqual(output, 0u), "underrun did not produce fresh silence") ||
        Require(consume.produced_silence == 1u, "underrun result did not mark silence") ||
        Require(AtomicLoad64(&reference.cursors()->consumer_sequence) == 0u,
                "underrun advanced consumer cursor") ||
        Require(AtomicLoad64(&reference.cursors()->underruns) == 1u,
                "underrun counter did not increment")) {
        return 1;
    }

    if (Require(ProduceFrame(&reference, 0u, 0x3Cu), "frame 0 production failed") ||
        Require(
            ConsumeOneRingFrame(
                reference.header,
                reference.header.session_generation,
                reference.bytes.data(),
                reference.bytes.size(),
                output.data(),
                output.size(),
                &consume) == RingConsumeStatus::kOk,
            "stable frame consumption failed") ||
        Require(AllBytesEqual(output, 0x3Cu), "stable frame payload was corrupted") ||
        Require(consume.frame_sequence == 0u, "stable frame sequence mismatch") ||
        Require(consume.slot_index == 0u, "stable frame slot mismatch") ||
        Require(consume.produced_silence == 0u, "stable frame incorrectly marked silence") ||
        Require(AtomicLoad64(&reference.cursors()->consumer_sequence) == 1u,
                "successful consume did not advance consumer cursor")) {
        return 1;
    }

    // Overrun normalization: with capacity 2 and four produced frames, frames
    // 0 and 1 are dropped and the consumer starts at logical frame 2.
    RegionFixture overrun{};
    if (Require(InitializeFixture(2u, &overrun), "overrun fixture initialization failed") ||
        Require(ProduceFrame(&overrun, 0u, 0x10u), "overrun frame 0 failed") ||
        Require(ProduceFrame(&overrun, 1u, 0x20u), "overrun frame 1 failed") ||
        Require(ProduceFrame(&overrun, 2u, 0x30u), "overrun frame 2 failed") ||
        Require(ProduceFrame(&overrun, 3u, 0x40u), "overrun frame 3 failed")) {
        return 1;
    }

    output.assign(static_cast<size_t>(overrun.layout.frame_bytes), 0u);
    if (Require(
            ConsumeOneRingFrame(
                overrun.header,
                overrun.header.session_generation,
                overrun.bytes.data(),
                overrun.bytes.size(),
                output.data(),
                output.size(),
                &consume) == RingConsumeStatus::kOk,
            "overrun-normalized consume failed") ||
        Require(consume.frame_sequence == 2u, "overrun did not select oldest retained frame") ||
        Require(consume.dropped_frames == 2u, "overrun drop result mismatch") ||
        Require(AllBytesEqual(output, 0x30u), "overrun-normalized payload mismatch") ||
        Require(AtomicLoad64(&overrun.cursors()->overrun_drops) == 2u,
                "exact overrun drop accounting mismatch") ||
        Require(AtomicLoad64(&overrun.cursors()->consumer_sequence) == 3u,
                "overrun consume cursor mismatch")) {
        return 1;
    }

    // Set up the exact race v1 could not detect. Frame 3 is the next readable
    // slot. Produce frame 4 completely so producer_sequence becomes 5, then
    // start overwriting frame-3's physical slot for future frame 5 without
    // publishing producer_sequence=6. The v2 writing stamp must cause the
    // consumer to reject the slot instead of copying torn data.
    if (Require(ProduceFrame(&overrun, 4u, 0x50u), "frame 4 production failed") ||
        Require(
            BeginSlotWrite(overrun.stamps(), overrun.header.capacity_frames, 5u) ==
                SlotSyncStatus::kOk,
            "future overwrite did not enter writing state")) {
        return 1;
    }

    const uint32_t reused_slot = SlotIndexForSequence(5u, overrun.header.capacity_frames);
    std::memset(
        overrun.audio() + static_cast<size_t>(reused_slot * overrun.layout.frame_bytes),
        0xEE,
        static_cast<size_t>(overrun.layout.frame_bytes));
    output.assign(static_cast<size_t>(overrun.layout.frame_bytes), 0x7Bu);

    if (Require(
            ConsumeOneRingFrame(
                overrun.header,
                overrun.header.session_generation,
                overrun.bytes.data(),
                overrun.bytes.size(),
                output.data(),
                output.size(),
                &consume) == RingConsumeStatus::kSlotUnstable,
            "concurrent slot reuse was not rejected") ||
        Require(AllBytesEqual(output, 0u), "unstable slot leaked partial PCM") ||
        Require(consume.produced_silence == 1u, "unstable slot did not mark silence") ||
        Require(AtomicLoad64(&overrun.cursors()->consumer_sequence) == 3u,
                "unstable slot advanced consumer cursor")) {
        return 1;
    }

    // A stale generation must be fenced before any shared cursor/audio access is
    // accepted as a valid frame.
    output.assign(static_cast<size_t>(overrun.layout.frame_bytes), 0x55u);
    if (Require(
            ConsumeOneRingFrame(
                overrun.header,
                overrun.header.session_generation + 1u,
                overrun.bytes.data(),
                overrun.bytes.size(),
                output.data(),
                output.size(),
                &consume) == RingConsumeStatus::kGenerationMismatch,
            "stale generation was not rejected")) {
        return 1;
    }

    std::puts("VSN virtual microphone ring consumer validation passed.");
    return 0;
}
