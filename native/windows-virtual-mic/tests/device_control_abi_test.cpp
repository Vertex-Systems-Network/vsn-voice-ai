#include "vsn_virtual_mic_device_control.h"

#include <cstdio>
#include <stdint.h>

namespace {

using vsn::virtual_mic::ConnectRequest;
using vsn::virtual_mic::ConnectResponse;
using vsn::virtual_mic::DeviceControlContractStatus;
using vsn::virtual_mic::DeviceControlStatus;
using vsn::virtual_mic::DisconnectRequest;
using vsn::virtual_mic::MakeConnectRequest;
using vsn::virtual_mic::MakeConnectResponse;
using vsn::virtual_mic::MakeDisconnectRequest;
using vsn::virtual_mic::MakeQueryStatusRequest;
using vsn::virtual_mic::ProtocolHeader;
using vsn::virtual_mic::QueryStatusRequest;
using vsn::virtual_mic::StatusResponse;
using vsn::virtual_mic::ValidateConnectRequest;
using vsn::virtual_mic::ValidateConnectResponse;
using vsn::virtual_mic::ValidateDisconnectRequest;
using vsn::virtual_mic::ValidateQueryStatusRequest;
using vsn::virtual_mic::ValidateStatusResponse;
using vsn::virtual_mic::kConnectFunction;
using vsn::virtual_mic::kDeviceControlMagic;
using vsn::virtual_mic::kDeviceControlMaxSectionBytes;
using vsn::virtual_mic::kDeviceControlVersion;
using vsn::virtual_mic::kDisconnectFunction;
using vsn::virtual_mic::kIoctlVirtualMicConnect;
using vsn::virtual_mic::kIoctlVirtualMicDisconnect;
using vsn::virtual_mic::kIoctlVirtualMicQueryStatus;
using vsn::virtual_mic::kProtocolMagic;
using vsn::virtual_mic::kProtocolVersion;
using vsn::virtual_mic::kQueryStatusFunction;
using vsn::virtual_mic::kSampleFormatF32Le;

int Require(bool condition, const char* message) {
    if (condition) {
        return 0;
    }
    std::fprintf(stderr, "virtual-mic device-control ABI validation failed: %s\n", message);
    return 1;
}

ProtocolHeader ReferenceHeader() {
    return ProtocolHeader{
        kProtocolMagic,
        kProtocolVersion,
        static_cast<uint16_t>(sizeof(ProtocolHeader)),
        31u,
        48'000u,
        1u,
        kSampleFormatF32Le,
        10'000u,
        4u,
        480u,
        0u,
    };
}

uint32_t IoctlFunction(DWORD code) {
    return (code >> 2u) & 0x0FFFu;
}

uint32_t IoctlMethod(DWORD code) {
    return code & 0x3u;
}

uint32_t IoctlAccess(DWORD code) {
    return (code >> 14u) & 0x3u;
}

uint32_t IoctlDeviceType(DWORD code) {
    return (code >> 16u) & 0xFFFFu;
}

} // namespace

int main() {
    if (Require(kDeviceControlVersion == 2u, "device-control version did not advance") ||
        Require(sizeof(ConnectRequest) == 56u, "connect request size mismatch") ||
        Require(sizeof(ConnectResponse) == 48u, "connect response size mismatch") ||
        Require(sizeof(DisconnectRequest) == 24u, "disconnect request size mismatch") ||
        Require(sizeof(QueryStatusRequest) == 16u, "query-status request size mismatch") ||
        Require(sizeof(StatusResponse) == 40u, "status response size mismatch")) {
        return 1;
    }

    const DWORD required_access = FILE_READ_ACCESS | FILE_WRITE_ACCESS;
    if (Require(IoctlDeviceType(kIoctlVirtualMicConnect) == FILE_DEVICE_UNKNOWN, "connect device type mismatch") ||
        Require(IoctlFunction(kIoctlVirtualMicConnect) == kConnectFunction, "connect function mismatch") ||
        Require(IoctlMethod(kIoctlVirtualMicConnect) == METHOD_BUFFERED, "connect method mismatch") ||
        Require(IoctlAccess(kIoctlVirtualMicConnect) == required_access, "connect access mismatch") ||
        Require(IoctlFunction(kIoctlVirtualMicDisconnect) == kDisconnectFunction, "disconnect function mismatch") ||
        Require(IoctlMethod(kIoctlVirtualMicDisconnect) == METHOD_BUFFERED, "disconnect method mismatch") ||
        Require(IoctlAccess(kIoctlVirtualMicDisconnect) == required_access, "disconnect access mismatch") ||
        Require(IoctlFunction(kIoctlVirtualMicQueryStatus) == kQueryStatusFunction, "query-status function mismatch") ||
        Require(IoctlMethod(kIoctlVirtualMicQueryStatus) == METHOD_BUFFERED, "query-status method mismatch") ||
        Require(IoctlAccess(kIoctlVirtualMicQueryStatus) == required_access, "query-status access mismatch")) {
        return 1;
    }

    const ProtocolHeader protocol = ReferenceHeader();
    ConnectRequest connect = MakeConnectRequest(protocol);
    if (Require(ValidateConnectRequest(connect) == DeviceControlContractStatus::kOk, "valid connect request rejected") ||
        Require(connect.protocol.session_generation == 31u, "connect protocol generation mismatch")) {
        return 1;
    }

    ConnectRequest bad_connect = connect;
    bad_connect.magic = 0u;
    if (Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kMagicMismatch, "bad control magic accepted")) {
        return 1;
    }
    bad_connect = connect;
    --bad_connect.version;
    if (Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kVersionMismatch, "legacy control version accepted")) {
        return 1;
    }
    bad_connect = connect;
    --bad_connect.struct_bytes;
    if (Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kStructSizeMismatch, "bad connect size accepted")) {
        return 1;
    }
    bad_connect = connect;
    bad_connect.protocol.session_generation = 0u;
    if (Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kProtocolHeaderInvalid, "zero protocol generation accepted")) {
        return 1;
    }
    bad_connect = connect;
    bad_connect.protocol.magic = 0u;
    if (Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kProtocolHeaderInvalid, "bad transport protocol accepted")) {
        return 1;
    }
    bad_connect = connect;
    bad_connect.flags = 1u;
    if (Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kUnsupportedFlags, "unknown connect flag accepted")) {
        return 1;
    }
    bad_connect = connect;
    bad_connect.reserved = 1u;
    if (Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kReservedFieldNonZero, "non-zero connect reserved field accepted")) {
        return 1;
    }

    // The user no longer supplies a section handle. A successful CONNECT response
    // is the first place where a user-visible section handle can appear, after the
    // future kernel driver has created and retained the section object itself.
    ConnectResponse ready = MakeConnectResponse(
        protocol.session_generation,
        0x1234u,
        7'808u,
        DeviceControlStatus::kReady);
    if (Require(ValidateConnectResponse(ready) == DeviceControlContractStatus::kOk, "valid ready connect response rejected")) {
        return 1;
    }

    ConnectResponse bad_response = ready;
    bad_response.section_handle_value = 0u;
    if (Require(ValidateConnectResponse(bad_response) == DeviceControlContractStatus::kInvalidSectionHandle, "ready response without handle accepted")) {
        return 1;
    }
    bad_response = ready;
    bad_response.section_bytes = kDeviceControlMaxSectionBytes + 1u;
    if (Require(ValidateConnectResponse(bad_response) == DeviceControlContractStatus::kInvalidSectionSize, "oversized driver section accepted")) {
        return 1;
    }

    ConnectResponse faulted = MakeConnectResponse(
        protocol.session_generation,
        0u,
        0u,
        DeviceControlStatus::kFaulted,
        ERROR_GEN_FAILURE);
    if (Require(ValidateConnectResponse(faulted) == DeviceControlContractStatus::kOk, "valid faulted connect response rejected")) {
        return 1;
    }
    faulted.section_handle_value = 0x1234u;
    if (Require(ValidateConnectResponse(faulted) == DeviceControlContractStatus::kUnexpectedSectionMetadata, "faulted response leaked section metadata")) {
        return 1;
    }

    const DisconnectRequest disconnect = MakeDisconnectRequest(31u);
    if (Require(ValidateDisconnectRequest(disconnect) == DeviceControlContractStatus::kOk, "valid disconnect request rejected")) {
        return 1;
    }
    DisconnectRequest bad_disconnect = disconnect;
    bad_disconnect.reserved = 1u;
    if (Require(ValidateDisconnectRequest(bad_disconnect) == DeviceControlContractStatus::kReservedFieldNonZero, "non-zero disconnect reserved field accepted")) {
        return 1;
    }

    const QueryStatusRequest query = MakeQueryStatusRequest(31u);
    if (Require(ValidateQueryStatusRequest(query) == DeviceControlContractStatus::kOk, "valid query request rejected")) {
        return 1;
    }
    QueryStatusRequest bad_query = query;
    bad_query.session_generation = 0u;
    if (Require(ValidateQueryStatusRequest(bad_query) == DeviceControlContractStatus::kInvalidSessionGeneration, "zero query generation accepted")) {
        return 1;
    }

    const StatusResponse status_ready{
        kDeviceControlMagic,
        kDeviceControlVersion,
        static_cast<uint16_t>(sizeof(StatusResponse)),
        31u,
        static_cast<uint32_t>(DeviceControlStatus::kReady),
        ERROR_SUCCESS,
        9u,
        7u,
    };
    if (Require(ValidateStatusResponse(status_ready) == DeviceControlContractStatus::kOk, "valid status response rejected")) {
        return 1;
    }

    StatusResponse bad_status = status_ready;
    bad_status.status = static_cast<uint32_t>(DeviceControlStatus::kFaulted) + 1u;
    if (Require(ValidateStatusResponse(bad_status) == DeviceControlContractStatus::kInvalidRuntimeStatus, "unknown runtime status accepted")) {
        return 1;
    }
    bad_status = status_ready;
    bad_status.consumer_sequence = 10u;
    if (Require(ValidateStatusResponse(bad_status) == DeviceControlContractStatus::kCursorOrderInvalid, "reversed status cursors accepted")) {
        return 1;
    }

    std::puts("VSN virtual microphone secure device-control ABI validation passed.");
    return 0;
}
