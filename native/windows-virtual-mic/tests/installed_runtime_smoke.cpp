#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <Windows.h>
#include <mmdeviceapi.h>
#include <propsys.h>

#include <cstdint>
#include <cwchar>
#include <iostream>

#include "../include/vsn_virtual_mic_device_control.h"

namespace {

using namespace vsn::virtual_mic;

constexpr wchar_t kExpectedEndpointMarker[] = L"VSN Virtual Microphone";
constexpr wchar_t kControlDevicePath[] = L"\\\\.\\VsnVirtualMicControl";
constexpr uint32_t kSmokeRingCapacityFrames = 4u;

// PKEY_Device_FriendlyName / DEVPKEY_Device_FriendlyName.
constexpr PROPERTYKEY kDeviceFriendlyNameKey = {
    {0xa45c254e, 0xdf1c, 0x4efd, {0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0}},
    14u,
};

enum class SmokeExit : int {
    kPassed = 0,
    kFailed = 1,
    kVerificationRequired = 2,
};

template <typename T>
void SafeRelease(T*& value) noexcept {
    if (value != nullptr) {
        value->Release();
        value = nullptr;
    }
}

void PrintResult(
    const char* status,
    const char* reason,
    uint32_t system_error = 0u) {
    std::cout << "{\"status\":\"" << status
              << "\",\"reason\":\"" << reason
              << "\",\"system_error\":" << system_error << "}" << std::endl;
}

uint32_t HResultCode(HRESULT value) noexcept {
    return static_cast<uint32_t>(value);
}

bool FindInstalledCaptureEndpoint(uint32_t* error_code) noexcept {
    if (error_code == nullptr) {
        return false;
    }
    *error_code = 0u;

    const HRESULT init_result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(init_result)) {
        *error_code = HResultCode(init_result);
        return false;
    }

    IMMDeviceEnumerator* enumerator = nullptr;
    IMMDeviceCollection* collection = nullptr;
    HRESULT result = CoCreateInstance(
        __uuidof(MMDeviceEnumerator),
        nullptr,
        CLSCTX_INPROC_SERVER,
        __uuidof(IMMDeviceEnumerator),
        reinterpret_cast<void**>(&enumerator));
    if (SUCCEEDED(result)) {
        result = enumerator->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &collection);
    }

    bool found = false;
    if (SUCCEEDED(result)) {
        UINT count = 0u;
        result = collection->GetCount(&count);
        for (UINT index = 0u; SUCCEEDED(result) && index < count && !found; ++index) {
            IMMDevice* device = nullptr;
            IPropertyStore* properties = nullptr;
            result = collection->Item(index, &device);
            if (SUCCEEDED(result)) {
                result = device->OpenPropertyStore(STGM_READ, &properties);
            }
            if (SUCCEEDED(result)) {
                PROPVARIANT value{};
                result = properties->GetValue(kDeviceFriendlyNameKey, &value);
                if (SUCCEEDED(result) &&
                    value.vt == VT_LPWSTR &&
                    value.pwszVal != nullptr &&
                    std::wcsstr(value.pwszVal, kExpectedEndpointMarker) != nullptr) {
                    found = true;
                }
                const HRESULT clear_result = PropVariantClear(&value);
                if (SUCCEEDED(result) && FAILED(clear_result)) {
                    result = clear_result;
                }
            }
            SafeRelease(properties);
            SafeRelease(device);
        }
    }

    SafeRelease(collection);
    SafeRelease(enumerator);
    CoUninitialize();

    if (FAILED(result)) {
        *error_code = HResultCode(result);
        return false;
    }
    return found;
}

ProtocolHeader MakeSmokeProtocol(uint64_t generation) noexcept {
    return ProtocolHeader{
        kProtocolMagic,
        kProtocolVersion,
        static_cast<uint16_t>(sizeof(ProtocolHeader)),
        generation,
        kWaveRtSampleRateHz,
        kWaveRtChannels,
        kSampleFormatF32Le,
        kWaveRtSchedulerFrameDurationMicros,
        kSmokeRingCapacityFrames,
        kWaveRtSchedulerSamplesPerFrame,
        0u,
    };
}

void BestEffortDisconnect(
    HANDLE control,
    uint64_t generation,
    HANDLE section_handle) noexcept {
    if (control != INVALID_HANDLE_VALUE && generation != 0u) {
        const DisconnectRequest request = MakeDisconnectRequest(generation);
        DWORD returned = 0u;
        static_cast<void>(DeviceIoControl(
            control,
            kIoctlVirtualMicDisconnect,
            const_cast<DisconnectRequest*>(&request),
            static_cast<DWORD>(sizeof(request)),
            nullptr,
            0u,
            &returned,
            nullptr));
    }
    if (section_handle != nullptr && section_handle != INVALID_HANDLE_VALUE) {
        CloseHandle(section_handle);
    }
}

bool RunOneControlSession(
    HANDLE control,
    uint64_t generation,
    uint32_t* error_code) noexcept {
    if (control == INVALID_HANDLE_VALUE || error_code == nullptr || generation == 0u) {
        return false;
    }
    *error_code = 0u;

    const ProtocolHeader protocol = MakeSmokeProtocol(generation);
    if (ValidateHeader(protocol) != ContractStatus::kOk) {
        return false;
    }

    ConnectRequest connect_request = MakeConnectRequest(protocol);
    ConnectResponse connect_response{};
    DWORD returned = 0u;
    if (!DeviceIoControl(
            control,
            kIoctlVirtualMicConnect,
            &connect_request,
            static_cast<DWORD>(sizeof(connect_request)),
            &connect_response,
            static_cast<DWORD>(sizeof(connect_response)),
            &returned,
            nullptr)) {
        *error_code = GetLastError();
        return false;
    }
    if (returned != sizeof(connect_response) ||
        ValidateConnectResponse(connect_response) != DeviceControlContractStatus::kOk ||
        connect_response.session_generation != generation ||
        connect_response.status != static_cast<uint32_t>(DeviceControlStatus::kReady)) {
        BestEffortDisconnect(control, generation, nullptr);
        return false;
    }

    HANDLE section_handle = reinterpret_cast<HANDLE>(
        static_cast<uintptr_t>(connect_response.section_handle_value));
    void* section_view = MapViewOfFile(
        section_handle,
        FILE_MAP_READ,
        0u,
        0u,
        static_cast<SIZE_T>(connect_response.section_bytes));
    if (section_view == nullptr) {
        *error_code = GetLastError();
        BestEffortDisconnect(control, generation, section_handle);
        return false;
    }

    const auto* mapped_header = static_cast<const ProtocolHeader*>(section_view);
    const bool mapped_header_valid =
        ValidateHeader(*mapped_header) == ContractStatus::kOk &&
        mapped_header->session_generation == generation &&
        ProtocolMatchesWaveRtEndpoint(*mapped_header);
    UnmapViewOfFile(section_view);
    if (!mapped_header_valid) {
        BestEffortDisconnect(control, generation, section_handle);
        return false;
    }

    QueryStatusRequest query_request = MakeQueryStatusRequest(generation);
    StatusResponse status_response{};
    returned = 0u;
    if (!DeviceIoControl(
            control,
            kIoctlVirtualMicQueryStatus,
            &query_request,
            static_cast<DWORD>(sizeof(query_request)),
            &status_response,
            static_cast<DWORD>(sizeof(status_response)),
            &returned,
            nullptr)) {
        *error_code = GetLastError();
        BestEffortDisconnect(control, generation, section_handle);
        return false;
    }
    if (returned != sizeof(status_response) ||
        ValidateStatusResponse(status_response) != DeviceControlContractStatus::kOk ||
        status_response.session_generation != generation ||
        status_response.status != static_cast<uint32_t>(DeviceControlStatus::kReady)) {
        BestEffortDisconnect(control, generation, section_handle);
        return false;
    }

    DisconnectRequest disconnect_request = MakeDisconnectRequest(generation);
    returned = 0u;
    const BOOL disconnected = DeviceIoControl(
        control,
        kIoctlVirtualMicDisconnect,
        &disconnect_request,
        static_cast<DWORD>(sizeof(disconnect_request)),
        nullptr,
        0u,
        &returned,
        nullptr);
    if (!disconnected) {
        *error_code = GetLastError();
        CloseHandle(section_handle);
        return false;
    }
    if (returned != 0u) {
        CloseHandle(section_handle);
        return false;
    }

    CloseHandle(section_handle);
    return true;
}

} // namespace

int main() {
    uint32_t error_code = 0u;
    const bool endpoint_found = FindInstalledCaptureEndpoint(&error_code);
    if (!endpoint_found) {
        if (error_code != 0u) {
            PrintResult("failed", "capture_endpoint_enumeration_failed", error_code);
            return static_cast<int>(SmokeExit::kFailed);
        }
        PrintResult("verification_required", "vsn_capture_endpoint_not_installed");
        return static_cast<int>(SmokeExit::kVerificationRequired);
    }

    HANDLE control = CreateFileW(
        kControlDevicePath,
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (control == INVALID_HANDLE_VALUE) {
        const DWORD open_error = GetLastError();
        if (open_error == ERROR_ACCESS_DENIED) {
            PrintResult(
                "verification_required",
                "elevated_administrator_context_required",
                open_error);
            return static_cast<int>(SmokeExit::kVerificationRequired);
        }
        PrintResult("failed", "installed_endpoint_control_device_unavailable", open_error);
        return static_cast<int>(SmokeExit::kFailed);
    }

    LARGE_INTEGER counter{};
    if (!QueryPerformanceCounter(&counter)) {
        error_code = GetLastError();
        CloseHandle(control);
        PrintResult("failed", "query_performance_counter_failed", error_code);
        return static_cast<int>(SmokeExit::kFailed);
    }

    uint64_t generation = static_cast<uint64_t>(counter.QuadPart) & 0x7fffffffffffffffull;
    generation ^= static_cast<uint64_t>(GetCurrentProcessId()) << 24u;
    generation |= 1u;
    if (generation >= UINT64_MAX - 1u) {
        generation = 1u;
    }

    if (!RunOneControlSession(control, generation, &error_code)) {
        CloseHandle(control);
        PrintResult("failed", "first_control_handshake_failed", error_code);
        return static_cast<int>(SmokeExit::kFailed);
    }

    if (!RunOneControlSession(control, generation + 1u, &error_code)) {
        CloseHandle(control);
        PrintResult("failed", "cleanup_reconnect_handshake_failed", error_code);
        return static_cast<int>(SmokeExit::kFailed);
    }

    CloseHandle(control);
    PrintResult("passed", "installed_endpoint_and_control_handshake_verified");
    return static_cast<int>(SmokeExit::kPassed);
}
