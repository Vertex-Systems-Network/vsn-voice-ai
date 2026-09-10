#include "vsn_virtual_mic_protocol.h"

#include <cstdio>

namespace {

using namespace vsn::virtual_mic;

int Require(bool condition, const char* message) {
    if (condition) {
        return 0;
    }
    std::fprintf(stderr, "virtual-mic ABI validation failed: %s\n", message);
    return 1;
}

ProtocolHeader ReferenceHeader() {
    return ProtocolHeader{
        kProtocolMagic,
        kProtocolVersion,
        static_cast<uint16_t>(sizeof(ProtocolHeader)),
        7u,
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
    const ProtocolHeader reference = ReferenceHeader();
    if (Require(ValidateHeader(reference) == ContractStatus::kOk, "reference header rejected") ||
        Require(kProtocolVersion == 2u, "protocol version did not advance to v2") ||
        Require(sizeof(FrameSlotStamp) == 8u, "slot stamp size mismatch") ||
        Require(alignof(FrameSlotStamp) == 8u, "slot stamp alignment mismatch")) {
        return 1;
    }

    const auto* magic_bytes = reinterpret_cast<const uint8_t*>(&reference.magic);
    if (Require(
            magic_bytes[0] == static_cast<uint8_t>('V') &&
                magic_bytes[1] == static_cast<uint8_t>('S') &&
                magic_bytes[2] == static_cast<uint8_t>('N') &&
                magic_bytes[3] == static_cast<uint8_t>('M'),
            "protocol magic is not little-endian VSNM")) {
        return 1;
    }

    const uint64_t sequence = 42u;
    if (Require(CanEncodeFrameSequence(sequence), "normal frame sequence rejected") ||
        Require(!SlotStampIsWriting(EncodeStableSlotStamp(sequence)), "stable stamp marked writing") ||
        Require(SlotStampIsWriting(EncodeWritingSlotStamp(sequence)), "writing stamp not marked writing") ||
        Require(DecodeSlotStampSequence(EncodeStableSlotStamp(sequence)) == sequence,
                "stable slot stamp decode mismatch") ||
        Require(DecodeSlotStampSequence(EncodeWritingSlotStamp(sequence)) == sequence,
                "writing slot stamp decode mismatch")) {
        return 1;
    }

    RingWindow window{};
    const CursorSnapshot wrapped{7u, 6u, 3u, 0u, 0u};
    if (Require(
            PlanRingWindow(reference, wrapped, &window) == ContractStatus::kOk,
            "wrapped ring plan rejected") ||
        Require(window.buffered_frames == 3u, "wrapped buffered frame count mismatch") ||
        Require(window.producer_slot == 2u, "wrapped producer slot mismatch") ||
        Require(window.consumer_slot == 3u, "wrapped consumer slot mismatch") ||
        Require(window.dropped_frames == 0u, "wrapped plan unexpectedly dropped frames")) {
        return 1;
    }

    const CursorSnapshot overrun{7u, 10u, 2u, 3u, 1u};
    if (Require(
            PlanRingWindow(reference, overrun, &window) == ContractStatus::kOk,
            "overrun ring plan rejected") ||
        Require(window.buffered_frames == 4u, "overrun buffer was not bounded to capacity") ||
        Require(window.dropped_frames == 4u, "overrun oldest-drop count mismatch") ||
        Require(window.normalized_consumer_sequence == 6u, "overrun consumer normalization mismatch") ||
        Require(window.consumer_slot == 2u, "overrun consumer slot mismatch") ||
        Require(window.producer_slot == 2u, "overrun producer slot mismatch")) {
        return 1;
    }

    ProtocolHeader wrong_version = reference;
    ++wrong_version.version;
    if (Require(
            ValidateHeader(wrong_version) == ContractStatus::kVersionMismatch,
            "unknown protocol version was accepted")) {
        return 1;
    }

    const CursorSnapshot wrong_generation{6u, 1u, 0u, 0u, 0u};
    if (Require(
            PlanRingWindow(reference, wrong_generation, &window) ==
                ContractStatus::kSessionGenerationMismatch,
            "stale session generation was accepted")) {
        return 1;
    }

    const CursorSnapshot reversed{7u, 3u, 4u, 0u, 0u};
    if (Require(
            PlanRingWindow(reference, reversed, &window) == ContractStatus::kCursorOrderInvalid,
            "reversed producer/consumer cursor order was accepted")) {
        return 1;
    }

    const CursorSnapshot overflow{
        7u,
        kMaxFrameSequence + 2u,
        kMaxFrameSequence + 2u,
        0u,
        0u,
    };
    if (Require(
            PlanRingWindow(reference, overflow, &window) == ContractStatus::kFrameSequenceOverflow,
            "unencodable ring cursor was accepted") ||
        Require(
            PlanRingWindow(reference, wrapped, nullptr) == ContractStatus::kNullOutput,
            "null output contract was accepted")) {
        return 1;
    }

    std::puts("VSN virtual microphone C++ ABI contract validation passed.");
    return 0;
}
