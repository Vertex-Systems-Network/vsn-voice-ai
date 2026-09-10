#pragma once

#include "vsn_virtual_mic_protocol.h"

#if !defined(_WIN32)
#error "VSN virtual microphone device-control ABI is Windows-only"
#endif

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <winioctl.h>

#include <stddef.h>
#include <stdint.h>

namespace vsn::virtual_mic {

constexpr uint32_t kDeviceControlMagic = 0x434E5356u; // Little-endian bytes: "VSNC".
constexpr uint16_t kDeviceControlVersion = 1u;
constexpr uint64_t kDeviceControlMaxSectionBytes = 16u * 1024u * 1024u;

constexpr uint32_t kConnectFunction = 0x800u;
constexpr uint32_t kDisconnectFunction = 0x801u;
constexpr uint32_t kQueryStatusFunction = 0x802u;

constexpr DWORD kIoctlVirtualMicConnect = CTL_CODE(
    FILE_DEVICE_UNKNOWN,
    kConnectFunction,
    METHOD_BUFFERED,
    FILE_READ_ACCESS | FILE_WRITE_ACCESS);
constexpr DWORD kIoctlVirtualMicDisconnect = CTL_CODE(
    FILE_DEVICE_UNKNOWN,
    kDisconnectFunction,
    METHOD_BUFFERED,
    FILE_READ_ACCESS | FILE_WRITE_ACCESS);
constexpr DWORD kIoctlVirtualMicQueryStatus = CTL_CODE(
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

struct alignas(8) ConnectRequest final {
    uint32_t magic;
    uint16_t version;
    uint16_t struct_bytes;
    uint64_t session_generation;
    uint64_t section_handle_value;
    uint64_t section_bytes;
    uint32_t expected_protocol_magic;
    uint16_t expected_protocol_version;
    uint16_t flags;
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

static_assert(sizeof(ConnectRequest) == 48u, "ConnectRequest ABI size drifted");
static_assert(alignof(ConnectRequest) == 8u, "ConnectRequest ABI alignment drifted");
static_assert(offsetof(ConnectRequest, magic) == 0u, "ConnectRequest.magic offset drifted");
static_assert(offsetof(ConnectRequest, version) == 4u, "ConnectRequest.version offset drifted");
static_assert(offsetof(ConnectRequest, struct_bytes) == 6u, "ConnectRequest.struct_bytes offset drifted");
static_assert(offsetof(ConnectRequest, session_generation) == 8u, "ConnectRequest.session_generation offset drifted");
static_assert(offsetof(ConnectRequest, section_handle_value) == 16u, "ConnectRequest.section_handle_value offset drifted");
static_assert(offsetof(ConnectRequest, section_bytes) == 24u, "ConnectRequest.section_bytes offset drifted");
static_assert(offsetof(ConnectRequest, expected_protocol_magic) == 32u, "ConnectRequest.expected_protocol_magic offset drifted");
static_assert(offsetof(ConnectRequest, expected_protocol_version) == 36u, "ConnectRequest.expected_protocol_version offset drifted");
static_assert(offsetof(ConnectRequest, flags) == 38u, "ConnectRequest.flags offset drifted");
static_assert(offsetof(ConnectRequest, reserved) == 40u, "ConnectRequest.reserved offset drifted");

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
    kInvalidSectionHandle,
    kInvalidSectionSize,
    kProtocolMagicMismatch,
    kProtocolVersionMismatch,
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
    if (request.session_generation == 0u) {
        return DeviceControlContractStatus::kInvalidSessionGeneration;
    }
    if (request.section_handle_value == 0u || request.section_handle_value == UINT64_MAX) {
        return DeviceControlContractStatus::kInvalidSectionHandle;
    }
    if (request.section_bytes == 0u || request.section_bytes > kDeviceControlMaxSectionBytes) {
        return DeviceControlContractStatus::kInvalidSectionSize;
    }
    if (request.expected_protocol_magic != kProtocolMagic) {
        return DeviceControlContractStatus::kProtocolMagicMismatch;
    }
    if (request.expected_protocol_version != kProtocolVersion) {
        return DeviceControlContractStatus::kProtocolVersionMismatch;
    }
    if (request.flags != 0u) {
        return DeviceControlContractStatus::kUnsupportedFlags;
    }
    if (request.reserved != 0u) {
        return DeviceControlContractStatus::kReservedFieldNonZero;
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

constexpr ConnectRequest MakeConnectRequest(
    uint64_t session_generation,
    uint64_t section_handle_value,
    uint64_t section_bytes) noexcept {
    return ConnectRequest{
        kDeviceControlMagic,
        kDeviceControlVersion,
        static_cast<uint16_t>(sizeof(ConnectRequest)),
        session_generation,
        section_handle_value,
        section_bytes,
        kProtocolMagic,
        kProtocolVersion,
        0u,
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
