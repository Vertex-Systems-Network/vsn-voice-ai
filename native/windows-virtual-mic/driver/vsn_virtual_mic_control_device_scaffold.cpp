#include <ntifs.h>
#include <wdf.h>

extern "C" NTSTATUS VsnCreateSecureControlDeviceFromInit(
    PWDFDEVICE_INIT* device_init,
    PCUNICODE_STRING symbolic_link,
    WDFDEVICE* output_device) noexcept;

extern "C" NTSTATUS VsnCreatePortClsControlDeviceScaffold(
    WDFDRIVER driver,
    WDFDEVICE* output_device) noexcept {
    if (driver == nullptr || output_device == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    *output_device = nullptr;

    DECLARE_CONST_UNICODE_STRING(sddl, L"D:P(A;;GA;;;SY)(A;;GA;;;BA)");
    DECLARE_CONST_UNICODE_STRING(device_name, L"\\Device\\VsnVirtualMicControl");
    DECLARE_CONST_UNICODE_STRING(symbolic_link, L"\\DosDevices\\VsnVirtualMicControl");

    PWDFDEVICE_INIT device_init = WdfControlDeviceInitAllocate(driver, &sddl);
    if (device_init == nullptr) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    NTSTATUS status = WdfDeviceInitAssignName(device_init, &device_name);
    if (!NT_SUCCESS(status)) {
        WdfDeviceInitFree(device_init);
        return status;
    }

    // The secure factory is implemented in the same translation unit as the
    // already-verified CONNECT/DISCONNECT/QUERY_STATUS handlers. The new
    // control device therefore uses the identical context, ownership fencing,
    // file cleanup, driver-owned section lifecycle and passive sequential IOCTL
    // queue instead of growing a second control implementation.
    status = VsnCreateSecureControlDeviceFromInit(
        &device_init,
        &symbolic_link,
        output_device);
    if (!NT_SUCCESS(status) && device_init != nullptr) {
        WdfDeviceInitFree(device_init);
    }
    return status;
}
