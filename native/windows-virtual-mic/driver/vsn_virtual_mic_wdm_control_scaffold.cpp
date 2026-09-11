#include <ntifs.h>
#include <portcls.h>
#include <wdmsec.h>

extern "C" DRIVER_DISPATCH VsnWdmControlDispatchCreateClose;
extern "C" DRIVER_DISPATCH VsnWdmControlDispatchDeviceControl;

namespace {

// Unique security class GUID for the VSN raw control device only.
// {A47B0129-C8DA-4A5E-B8C4-6D8E20AC37F2}
const GUID GUID_DEVCLASS_VSN_VIRTUAL_MIC_CONTROL = {
    0xa47b0129,
    0xc8da,
    0x4a5e,
    {0xb8, 0xc4, 0x6d, 0x8e, 0x20, 0xac, 0x37, 0xf2},
};

PDEVICE_OBJECT g_vsn_control_device = nullptr;
BOOLEAN g_vsn_symbolic_link_created = FALSE;

NTSTATUS CompleteControlIrp(PIRP irp, NTSTATUS status) noexcept {
    if (irp == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    irp->IoStatus.Status = status;
    irp->IoStatus.Information = 0u;
    IoCompleteRequest(irp, IO_NO_INCREMENT);
    return status;
}

bool IsVsnControlDevice(PDEVICE_OBJECT device_object) noexcept {
    return device_object != nullptr && device_object == g_vsn_control_device;
}

} // namespace

extern "C" NTSTATUS VsnWdmControlCreateScaffold(
    PDRIVER_OBJECT driver_object) noexcept {
    if (driver_object == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    if (g_vsn_control_device != nullptr) {
        return STATUS_DEVICE_BUSY;
    }

    DECLARE_CONST_UNICODE_STRING(device_name, L"\\Device\\VsnVirtualMicControl");
    DECLARE_CONST_UNICODE_STRING(symbolic_link, L"\\DosDevices\\VsnVirtualMicControl");
    DECLARE_CONST_UNICODE_STRING(sddl, L"D:P(A;;GA;;;SY)(A;;GA;;;BA)");

    PDEVICE_OBJECT device_object = nullptr;
    NTSTATUS status = IoCreateDeviceSecure(
        driver_object,
        0u,
        const_cast<PUNICODE_STRING>(&device_name),
        FILE_DEVICE_UNKNOWN,
        FILE_DEVICE_SECURE_OPEN,
        FALSE,
        &sddl,
        &GUID_DEVCLASS_VSN_VIRTUAL_MIC_CONTROL,
        &device_object);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    device_object->Flags |= DO_BUFFERED_IO;

    status = IoCreateSymbolicLink(
        const_cast<PUNICODE_STRING>(&symbolic_link),
        const_cast<PUNICODE_STRING>(&device_name));
    if (!NT_SUCCESS(status)) {
        IoDeleteDevice(device_object);
        return status;
    }

    // Publish only after both the secure named object and user-visible link are
    // complete. The dispatch wrappers are not wired into DriverEntry yet.
    g_vsn_control_device = device_object;
    g_vsn_symbolic_link_created = TRUE;
    device_object->Flags &= ~DO_DEVICE_INITIALIZING;
    return STATUS_SUCCESS;
}

extern "C" void VsnWdmControlDeleteScaffold() noexcept {
    DECLARE_CONST_UNICODE_STRING(symbolic_link, L"\\DosDevices\\VsnVirtualMicControl");

    if (g_vsn_symbolic_link_created != FALSE) {
        IoDeleteSymbolicLink(const_cast<PUNICODE_STRING>(&symbolic_link));
        g_vsn_symbolic_link_created = FALSE;
    }

    PDEVICE_OBJECT device_object = g_vsn_control_device;
    g_vsn_control_device = nullptr;
    if (device_object != nullptr) {
        IoDeleteDevice(device_object);
    }
}

extern "C" NTSTATUS VsnWdmControlDispatchCreateClose(
    PDEVICE_OBJECT device_object,
    PIRP irp) {
    if (device_object == nullptr || irp == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    if (!IsVsnControlDevice(device_object)) {
        return PcDispatchIrp(device_object, irp);
    }

    const PIO_STACK_LOCATION stack = IoGetCurrentIrpStackLocation(irp);
    if (stack == nullptr) {
        return CompleteControlIrp(irp, STATUS_INVALID_DEVICE_REQUEST);
    }

    switch (stack->MajorFunction) {
    case IRP_MJ_CREATE:
        // Fail closed until the existing verified CONNECT ownership and shared-
        // section lifecycle have been ported from WDFREQUEST to raw IRP form.
        return CompleteControlIrp(irp, STATUS_DEVICE_NOT_READY);
    case IRP_MJ_CLOSE:
    case IRP_MJ_CLEANUP:
        return CompleteControlIrp(irp, STATUS_SUCCESS);
    default:
        return CompleteControlIrp(irp, STATUS_INVALID_DEVICE_REQUEST);
    }
}

extern "C" NTSTATUS VsnWdmControlDispatchDeviceControl(
    PDEVICE_OBJECT device_object,
    PIRP irp) {
    if (device_object == nullptr || irp == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    if (!IsVsnControlDevice(device_object)) {
        return PcDispatchIrp(device_object, irp);
    }

    // Intentionally no CONNECT/DISCONNECT/QUERY_STATUS handling yet. This
    // scaffold proves secure creation and exact-device dispatch multiplexing
    // while making accidental activation unusable from user mode.
    return CompleteControlIrp(irp, STATUS_DEVICE_NOT_READY);
}
