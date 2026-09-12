#pragma once

#include "vsn_virtual_mic_protocol.h"
#include "vsn_virtual_mic_wavert_contract.h"

#if !defined(_WIN32)
#error "VSN virtual microphone device-control ABI is Windows-only"
#endif

#if defined(_NTDDK_) || defined(_WDMDDK_) || defined(_NTIFS_)
// Kernel-mode callers include WDF/NT headers before this shared ABI header.
#else
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <winioctl.h>
#endif

#include <stddef.h>
#include <stdint.h>

namespace vsn::virtual_mic {

constexpr uint32_t kDeviceControlMagic = 0x434E5356u; // Little-endian bytes: "VSNC".
// Version 2 removes the unsafe user-supplied section handle from CONNECT.
constexpr uint16_t kDeviceControlVersion = 2u;
constexpr uint64_t kDeviceControlMaxSectionBytes = 16u * 1024u * 1024u;

constexpr uint32_t kConnectFunction = 0x800u;
constexpr uint32_t kDisconnectFunction = 0x801u;
constexpr uint32_t kQueryStatusFunction = 0x802u;

constexpr uint32_t kIoctlVirtualMicConnect = CTL_CODE(
    FILE_DEVICE_UNKNOWN,
    kConnectFunction,
    METHOD_BUFFERED,
    FILE_READ_ACCESS | FILE_WRITE_ACCESS);
constexpr uint32_t kIoctlVirtualMicDisconnect = CTL_CODE(
    FILE_DEVICE_UNKNOWN,
    kDisconnectFunction,
    METHOD_BUFFERED,
    FILE_READ_ACCESS | FILE_WRITE_ACCESS);
constexpr uint32_t kIoctlVirtualMicQueryStatus = CTL_CODE(
    FILE_DEVICE_UNKNOWN,
    kQueryStatusFunction,
    METHOD_BUFFERED,
    FILE_READ_ACCESS | FILE_WRITE_ACCESS);

enum class DeviceControlStatus : uint32_t {
    kDisconnected = 0u,
    kBinding = 1u,
    kReady = 2u,
    kFaulted = 3u,
};

// Security invariant:
// CONNECT carries desired protocol geometry only. A kernel driver must create
// the section itself, retain an object reference for its lifetime, and only
// then return a user-visible section handle in ConnectResponse. A section
// handle received from user mode must never be used as the transport object.
struct alignas(8) ConnectRequest final {
    uint32_t magic;
    uint16_t version;
    uint16_t struct_bytes;
    ProtocolHeader protocol;
    uint32_t flags;
    uint32_t reserved;
};

struct alignas(8) ConnectResponse final {
    uint32_t magic;
    uint16_t version;
    uint16_t struct_bytes;
    uint64_t session_generation;
    uint64_t section_handle_value;
    uint64_t section_bytes;
    uint32_t status;
    uint32_t last_error;
    uint64_t reserved;
};

struct alignas(8) DisconnectRequest final {
    uint32_t magic;
    uint16_t version;
    uint16_t struct_bytes;
    uint64_t session_generation;
    uint64_t reserved;
};

struct alignas(8) QueryStatusRequest final {
    uint32_t magic;
    uint16_t version;
    uint16_t struct_bytes;
    uint64_t session_generation;
};

struct alignas(8) StatusResponse final {
    uint32_t magic;
    uint16_t version;
    uint16_t struct_bytes;
    uint64_t session_generation;
    uint32_t status;
    uint32_t last_error;
    uint64_t producer_sequence;
    uint64_t consumer_sequence;
};

static_assert(sizeof(ConnectRequest) == 56u, "ConnectRequest ABI size drifted");
static_assert(alignof(ConnectRequest) == 8u, "ConnectRequest ABI alignment drifted");
static_assert(offsetof(ConnectRequest, magic) == 0u, "ConnectRequest.magic offset drifted");
static_assert(offsetof(ConnectRequest, version) == 4u, "ConnectRequest.version offset drifted");
static_assert(offsetof(ConnectRequest, struct_bytes) == 6u, "ConnectRequest.struct_bytes offset drifted");
static_assert(offsetof(ConnectRequest, protocol) == 8u, "ConnectRequest.protocol offset drifted");
static_assert(offsetof(ConnectRequest, flags) == 48u, "ConnectRequest.flags offset drifted");
static_assert(offsetof(ConnectRequest, reserved) == 52u, "ConnectRequest.reserved offset drifted");

static_assert(sizeof(ConnectResponse) == 48u, "ConnectResponse ABI size drifted");
static_assert(alignof(ConnectResponse) == 8u, "ConnectResponse ABI alignment drifted");
static_assert(offsetof(ConnectResponse, session_generation) == 8u, "ConnectResponse.session_generation offset drifted");
static_assert(offsetof(ConnectResponse, section_handle_value) == 16u, "ConnectResponse.section_handle_value offset drifted");
static_assert(offsetof(ConnectResponse, section_bytes) == 24u, "ConnectResponse.section_bytes offset drifted");
static_assert(offsetof(ConnectResponse, status) == 32u, "ConnectResponse.status offset drifted");
static_assert(offsetof(ConnectResponse, last_error) == 36u, "ConnectResponse.last_error offset drifted");
static_assert(offsetof(ConnectResponse, reserved) == 40u, "ConnectResponse.reserved offset drifted");

static_assert(sizeof(DisconnectRequest) == 24u, "DisconnectRequest ABI size drifted");
static_assert(alignof(DisconnectRequest) == 8u, "DisconnectRequest ABI alignment drifted");
static_assert(offsetof(DisconnectRequest, session_generation) == 8u, "DisconnectRequest.session_generation offset drifted");
static_assert(offsetof(DisconnectRequest, reserved) == 16u, "DisconnectRequest.reserved offset drifted");

static_assert(sizeof(QueryStatusRequest) == 16u, "QueryStatusRequest ABI size drifted");
static_assert(alignof(QueryStatusRequest) == 8u, "QueryStatusRequest ABI alignment drifted");
static_assert(offsetof(QueryStatusRequest, session_generation) == 8u, "QueryStatusRequest.session_generation offset drifted");

static_assert(sizeof(StatusResponse) == 40u, "StatusResponse ABI size drifted");
static_assert(alignof(StatusResponse) == 8u, "StatusResponse ABI alignment drifted");
static_assert(offsetof(StatusResponse, session_generation) == 8u, "StatusResponse.session_generation offset drifted");
static_assert(offsetof(StatusResponse, status) == 16u, "StatusResponse.status offset drifted");
static_assert(offsetof(StatusResponse, last_error) == 20u, "StatusResponse.last_error offset drifted");
static_assert(offsetof(StatusResponse, producer_sequence) == 24u, "StatusResponse.producer_sequence offset drifted");
static_assert(offsetof(StatusResponse, consumer_sequence) == 32u, "StatusResponse.consumer_sequence offset drifted");

enum class DeviceControlContractStatus : uint32_t {
    kOk = 0u,
    kMagicMismatch,
    kVersionMismatch,
    kStructSizeMismatch,
    kInvalidSessionGeneration,
    kProtocolHeaderInvalid,
    kEndpointFormatMismatch,
    kInvalidSectionHandle,
    kInvalidSectionSize,
    kUnexpectedSectionMetadata,
    kUnsupportedFlags,
    kReservedFieldNonZero,
    kInvalidRuntimeStatus,
    kCursorOrderInvalid,
};

constexpr DeviceControlContractStatus ValidateControlPrefix(
    uint32_t magic,
    uint16_t version,
    uint16_t struct_bytes,
    size_t expected_bytes) noexcept {
    if (magic != kDeviceControlMagic) {
        return DeviceControlContractStatus::kMagicMismatch;
    }
    if (version != kDeviceControlVersion) {
        return DeviceControlContractStatus::kVersionMismatch;
    }
    if (static_cast<size_t>(struct_bytes) != expected_bytes) {
        return DeviceControlContractStatus::kStructSizeMismatch;
    }
    return DeviceControlContractStatus::kOk;
}

constexpr bool ProtocolMatchesWaveRtEndpoint(const ProtocolHeader& protocol) noexcept {
    return protocol.sample_rate_hz == kWaveRtSampleRateHz &&
        protocol.channels == kWaveRtChannels &&
        protocol.sample_format == kSampleFormatF32Le;
}

constexpr DeviceControlContractStatus ValidateConnectRequest(
    const ConnectRequest& request) noexcept {
    const DeviceControlContractStatus prefix = ValidateControlPrefix(
        request.magic,
        request.version,
        request.struct_bytes,
        sizeof(ConnectRequest));
    if (prefix != DeviceControlContractStatus::kOk) {
        return prefix;
    }
    if (ValidateHeader(request.protocol) != ContractStatus::kOk) {
        return DeviceControlContractStatus::kProtocolHeaderInvalid;
    }
    if (!ProtocolMatchesWaveRtEndpoint(request.protocol)) {
        return DeviceControlContractStatus::kEndpointFormatMismatch;
    }
    if (request.flags != 0u) {
        return DeviceControlContractStatus::kUnsupportedFlags;
    }
    if (request.reserved != 0u) {
        return DeviceControlContractStatus::kReservedFieldNonZero;
    }
    return DeviceControlContractStatus::kOk;
}

constexpr DeviceControlContractStatus ValidateConnectResponse(
    const ConnectResponse& response) noexcept {
    const DeviceControlContractStatus prefix = ValidateControlPrefix(
        response.magic,
        response.version,
        response.struct_bytes,
        sizeof(ConnectResponse));
    if (prefix != DeviceControlContractStatus::kOk) {
        return prefix;
    }
    if (response.session_generation == 0u) {
        return DeviceControlContractStatus::kInvalidSessionGeneration;
    }
    if (response.status > static_cast<uint32_t>(DeviceControlStatus::kFaulted)) {
        return DeviceControlContractStatus::kInvalidRuntimeStatus;
    }
    if (response.reserved != 0u) {
        return DeviceControlContractStatus::kReservedFieldNonZero;
    }

    const bool ready = response.status == static_cast<uint32_t>(DeviceControlStatus::kReady);
    const bool has_handle = response.section_handle_value != 0u &&
        response.section_handle_value != UINT64_MAX;
    const bool has_size = response.section_bytes != 0u &&
        response.section_bytes <= kDeviceControlMaxSectionBytes;

    if (ready) {
        if (!has_handle) {
            return DeviceControlContractStatus::kInvalidSectionHandle;
        }
        if (!has_size) {
            return DeviceControlContractStatus::kInvalidSectionSize;
        }
    } else if (response.section_handle_value != 0u || response.section_bytes != 0u) {
        return DeviceControlContractStatus::kUnexpectedSectionMetadata;
    }
    return DeviceControlContractStatus::kOk;
}

constexpr DeviceControlContractStatus ValidateDisconnectRequest(
    const DisconnectRequest& request) noexcept {
    const DeviceControlContractStatus prefix = ValidateControlPrefix(
        request.magic,
        request.version,
        request.struct_bytes,
        sizeof(DisconnectRequest));
    if (prefix != DeviceControlContractStatus::kOk) {
        return prefix;
    }
    if (request.session_generation == 0u) {
        return DeviceControlContractStatus::kInvalidSessionGeneration;
    }
    if (request.reserved != 0u) {
        return DeviceControlContractStatus::kReservedFieldNonZero;
    }
    return DeviceControlContractStatus::kOk;
}

constexpr DeviceControlContractStatus ValidateQueryStatusRequest(
    const QueryStatusRequest& request) noexcept {
    const DeviceControlContractStatus prefix = ValidateControlPrefix(
        request.magic,
        request.version,
        request.struct_bytes,
        sizeof(QueryStatusRequest));
    if (prefix != DeviceControlContractStatus::kOk) {
        return prefix;
    }
    if (request.session_generation == 0u) {
        return DeviceControlContractStatus::kInvalidSessionGeneration;
    }
    return DeviceControlContractStatus::kOk;
}

constexpr DeviceControlContractStatus ValidateStatusResponse(
    const StatusResponse& response) noexcept {
    const DeviceControlContractStatus prefix = ValidateControlPrefix(
        response.magic,
        response.version,
        response.struct_bytes,
        sizeof(StatusResponse));
    if (prefix != DeviceControlContractStatus::kOk) {
        return prefix;
    }
    if (response.session_generation == 0u) {
        return DeviceControlContractStatus::kInvalidSessionGeneration;
    }
    if (response.status > static_cast<uint32_t>(DeviceControlStatus::kFaulted)) {
        return DeviceControlContractStatus::kInvalidRuntimeStatus;
    }
    if (response.producer_sequence < response.consumer_sequence) {
        return DeviceControlContractStatus::kCursorOrderInvalid;
    }
    return DeviceControlContractStatus::kOk;
}

constexpr ConnectRequest MakeConnectRequest(const ProtocolHeader& protocol) noexcept {
    return ConnectRequest{
        kDeviceControlMagic,
        kDeviceControlVersion,
        static_cast<uint16_t>(sizeof(ConnectRequest)),
        protocol,
        0u,
        0u,
    };
}

constexpr ConnectResponse MakeConnectResponse(
    uint64_t session_generation,
    uint64_t section_handle_value,
    uint64_t section_bytes,
    DeviceControlStatus status,
    uint32_t last_error = 0u) noexcept {
    return ConnectResponse{
        kDeviceControlMagic,
        kDeviceControlVersion,
        static_cast<uint16_t>(sizeof(ConnectResponse)),
        session_generation,
        section_handle_value,
        section_bytes,
        static_cast<uint32_t>(status),
        last_error,
        0u,
    };
}

constexpr DisconnectRequest MakeDisconnectRequest(uint64_t session_generation) noexcept {
    return DisconnectRequest{
        kDeviceControlMagic,
        kDeviceControlVersion,
        static_cast<uint16_t>(sizeof(DisconnectRequest)),
        session_generation,
        0u,
    };
}

constexpr QueryStatusRequest MakeQueryStatusRequest(uint64_t session_generation) noexcept {
    return QueryStatusRequest{
        kDeviceControlMagic,
        kDeviceControlVersion,
        static_cast<uint16_t>(sizeof(QueryStatusRequest)),
        session_generation,
    };
}

} // namespace vsn::virtual_mic