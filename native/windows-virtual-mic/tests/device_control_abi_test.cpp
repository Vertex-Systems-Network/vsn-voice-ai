#include "vsn_virtual_mic_device_control.h"
#include "vsn_virtual_mic_region_layout.h"

#include <cstdio>
#include <stdint.h>

namespace {

using namespace vsn::virtual_mic;

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
    if (Require(kDeviceControlVersion == 2u, "device-control version mismatch") ||
        Require(kProtocolVersion == 2u, "transport protocol version mismatch") ||
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
    SharedRegionLayout layout{};
    if (Require(
            PlanSharedRegionLayout(protocol, &layout) == SharedRegionStatus::kOk,
            "reference shared-region layout rejected") ||
        Require(layout.total_bytes == 7'872u, "protocol v2 section size mismatch")) {
        return 1;
    }

    ConnectRequest connect = MakeConnectRequest(protocol);
    if (Require(ValidateConnectRequest(connect) == DeviceControlContractStatus::kOk, "valid connect request rejected") ||
        Require(connect.protocol.session_generation == 31u, "connect protocol generation mismatch") ||
        Require(ProtocolMatchesWaveRtEndpoint(connect.protocol), "reference protocol does not match WaveRT endpoint")) {
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
    bad_connect.protocol.version = 1u;
    if (Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kProtocolHeaderInvalid, "legacy transport protocol accepted")) {
        return 1;
    }
    bad_connect = connect;
    bad_connect.protocol.magic = 0u;
    if (Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kProtocolHeaderInvalid, "bad transport protocol accepted")) {
        return 1;
    }

    // The generic protocol permits other integral F32 geometries, but the live
    // VSN WaveRT endpoint is deliberately fixed at 48 kHz mono. CONNECT must
    // fail closed instead of silently implying a resampler/channel converter.
    bad_connect = connect;
    bad_connect.protocol.sample_rate_hz = 44'100u;
    bad_connect.protocol.samples_per_frame = 441u;
    if (Require(ValidateHeader(bad_connect.protocol) == ContractStatus::kOk, "44.1 kHz regression input is not generically valid") ||
        Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kEndpointFormatMismatch, "non-48 kHz CONNECT accepted")) {
        return 1;
    }
    bad_connect = connect;
    bad_connect.protocol.channels = 2u;
    bad_connect.protocol.samples_per_frame = 960u;
    if (Require(ValidateHeader(bad_connect.protocol) == ContractStatus::kOk, "stereo regression input is not generically valid") ||
        Require(ValidateConnectRequest(bad_connect) == DeviceControlContractStatus::kEndpointFormatMismatch, "stereo CONNECT accepted")) {
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

    ConnectResponse ready = MakeConnectResponse(
        protocol.session_generation,
        0x1234u,
        layout.total_bytes,
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