#include <ntifs.h>
#include <portcls.h>
#include <wdmsec.h>

#include "../include/vsn_virtual_mic_cursor_sync.h"
#include "../include/vsn_virtual_mic_device_control.h"
#include "../include/vsn_virtual_mic_region_layout.h"

extern "C" DRIVER_DISPATCH VsnWdmControlDispatchCreateClose;
extern "C" DRIVER_DISPATCH VsnWdmControlDispatchDeviceControl;

namespace {

using namespace vsn::virtual_mic;

// Unique security class GUID for the VSN raw control device only.
// {A47B0129-C8DA-4A5E-B8C4-6D8E20AC37F2}
const GUID GUID_DEVCLASS_VSN_VIRTUAL_MIC_CONTROL = {
    0xa47b0129,
    0xc8da,
    0x4a5e,
    {0xb8, 0xc4, 0x6d, 0x8e, 0x20, 0xac, 0x37, 0xf2},
};

struct VSN_WDM_CONTROL_CONTEXT final {
    KMUTEX state_mutex;
    PVOID section_object;
    PVOID kernel_view;
    SIZE_T section_bytes;
    ULONG owner_process_id;
    PFILE_OBJECT owner_file;
    ProtocolHeader protocol;
    BOOLEAN connected;
};

PDEVICE_OBJECT g_vsn_control_device = nullptr;
BOOLEAN g_vsn_symbolic_link_created = FALSE;

NTSTATUS CompleteControlIrp(
    PIRP irp,
    NTSTATUS status,
    ULONG_PTR information = 0u) noexcept {
    if (irp == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    irp->IoStatus.Status = status;
    irp->IoStatus.Information = information;
    IoCompleteRequest(irp, IO_NO_INCREMENT);
    return status;
}

bool IsVsnControlDevice(PDEVICE_OBJECT device_object) noexcept {
    return device_object != nullptr && device_object == g_vsn_control_device;
}

VSN_WDM_CONTROL_CONTEXT* GetControlContext(PDEVICE_OBJECT device_object) noexcept {
    if (device_object == nullptr || device_object->DeviceExtension == nullptr) {
        return nullptr;
    }
    return static_cast<VSN_WDM_CONTROL_CONTEXT*>(device_object->DeviceExtension);
}

NTSTATUS AcquireState(VSN_WDM_CONTROL_CONTEXT* context) noexcept {
    if (context == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    return KeWaitForSingleObject(
        &context->state_mutex,
        Executive,
        KernelMode,
        FALSE,
        nullptr);
}

void ReleaseState(VSN_WDM_CONTROL_CONTEXT* context) noexcept {
    if (context != nullptr) {
        KeReleaseMutex(&context->state_mutex, FALSE);
    }
}

void ResetConnectionLocked(VSN_WDM_CONTROL_CONTEXT* context) noexcept {
    if (context == nullptr) {
        return;
    }

    if (context->kernel_view != nullptr) {
        MmUnmapViewInSystemSpace(context->kernel_view);
        context->kernel_view = nullptr;
    }
    if (context->section_object != nullptr) {
        ObDereferenceObject(context->section_object);
        context->section_object = nullptr;
    }

    context->section_bytes = 0u;
    context->owner_process_id = 0u;
    context->owner_file = nullptr;
    RtlZeroMemory(&context->protocol, sizeof(context->protocol));
    context->connected = FALSE;
}

bool RequestOwnsConnection(
    const VSN_WDM_CONTROL_CONTEXT* context,
    PIRP irp,
    PFILE_OBJECT file_object,
    uint64_t session_generation) noexcept {
    if (context == nullptr || irp == nullptr || file_object == nullptr) {
        return false;
    }

    return context->connected != FALSE &&
        context->owner_process_id == IoGetRequestorProcessId(irp) &&
        context->owner_file == file_object &&
        context->protocol.session_generation == session_generation;
}

NTSTATUS CreateDriverOwnedSection(
    PIRP irp,
    const ProtocolHeader& protocol,
    const SharedRegionLayout& layout,
    PVOID* section_object_output,
    PVOID* kernel_view_output,
    HANDLE* user_handle_output) noexcept {
    if (irp == nullptr ||
        section_object_output == nullptr ||
        kernel_view_output == nullptr ||
        user_handle_output == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    *section_object_output = nullptr;
    *kernel_view_output = nullptr;
    *user_handle_output = nullptr;

    if (KeGetCurrentIrql() != PASSIVE_LEVEL) {
        return STATUS_INVALID_DEVICE_STATE;
    }

    const ULONG requestor_pid = IoGetRequestorProcessId(irp);
    if (requestor_pid == 0u) {
        return STATUS_ACCESS_DENIED;
    }

    PEPROCESS requestor_process = nullptr;
    NTSTATUS status = PsLookupProcessByProcessId(
        reinterpret_cast<HANDLE>(static_cast<ULONG_PTR>(requestor_pid)),
        &requestor_process);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    KAPC_STATE apc_state{};
    KeStackAttachProcess(requestor_process, &apc_state);

    HANDLE section_handle = nullptr;
    LARGE_INTEGER section_size{};
    section_size.QuadPart = static_cast<LONGLONG>(layout.total_bytes);

    status = ZwCreateSection(
        &section_handle,
        SECTION_MAP_READ | SECTION_MAP_WRITE,
        nullptr,
        &section_size,
        PAGE_READWRITE,
        SEC_COMMIT,
        nullptr);

    PVOID section_object = nullptr;
    PVOID kernel_view = nullptr;
    SIZE_T mapped_bytes = static_cast<SIZE_T>(layout.total_bytes);

    if (NT_SUCCESS(status)) {
        // The driver creates the section while attached to the requestor process.
        // User mode never supplies the transport section handle. Retain an
        // independent object reference before exposing the handle value.
        status = ObReferenceObjectByHandle(
            section_handle,
            SECTION_MAP_READ | SECTION_MAP_WRITE,
            nullptr,
            KernelMode,
            &section_object,
            nullptr);
    }

    if (NT_SUCCESS(status)) {
        status = MmMapViewInSystemSpace(section_object, &kernel_view, &mapped_bytes);
        if (NT_SUCCESS(status) && mapped_bytes < static_cast<SIZE_T>(layout.total_bytes)) {
            MmUnmapViewInSystemSpace(kernel_view);
            kernel_view = nullptr;
            status = STATUS_BUFFER_TOO_SMALL;
        }
    }

    if (NT_SUCCESS(status)) {
        RtlZeroMemory(kernel_view, static_cast<SIZE_T>(layout.total_bytes));
        auto* bytes = static_cast<unsigned char*>(kernel_view);
        RtlCopyMemory(bytes + layout.header_offset, &protocol, sizeof(protocol));
        auto* cursors = reinterpret_cast<CursorSnapshot*>(bytes + layout.cursor_offset);
        if (InitializeCursorSession(cursors, protocol.session_generation) != CursorSyncStatus::kOk) {
            status = STATUS_DATA_ERROR;
        }
        KeMemoryBarrier();
    }

    if (!NT_SUCCESS(status)) {
        if (kernel_view != nullptr) {
            MmUnmapViewInSystemSpace(kernel_view);
            kernel_view = nullptr;
        }
        if (section_object != nullptr) {
            ObDereferenceObject(section_object);
            section_object = nullptr;
        }
        if (section_handle != nullptr) {
            ZwClose(section_handle);
            section_handle = nullptr;
        }
    }

    KeUnstackDetachProcess(&apc_state);
    ObDereferenceObject(requestor_process);

    if (!NT_SUCCESS(status)) {
        return status;
    }

    *section_object_output = section_object;
    *kernel_view_output = kernel_view;
    *user_handle_output = section_handle;
    return STATUS_SUCCESS;
}

NTSTATUS ValidateRawIoctlCaller(PIRP irp) noexcept {
    if (irp == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    if (irp->RequestorMode != UserMode) {
        return STATUS_ACCESS_DENIED;
    }
    if (KeGetCurrentIrql() != PASSIVE_LEVEL) {
        return STATUS_INVALID_DEVICE_STATE;
    }
    return IoValidateDeviceIoControlAccess(
        irp,
        FILE_READ_ACCESS | FILE_WRITE_ACCESS);
}

NTSTATUS CompleteConnect(
    PDEVICE_OBJECT device_object,
    PIRP irp,
    PIO_STACK_LOCATION stack) noexcept {
    if (device_object == nullptr || irp == nullptr || stack == nullptr) {
        return CompleteControlIrp(irp, STATUS_INVALID_PARAMETER);
    }

    const ULONG input_bytes = stack->Parameters.DeviceIoControl.InputBufferLength;
    const ULONG output_bytes = stack->Parameters.DeviceIoControl.OutputBufferLength;
    if (input_bytes != sizeof(ConnectRequest) || output_bytes != sizeof(ConnectResponse)) {
        return CompleteControlIrp(irp, STATUS_INFO_LENGTH_MISMATCH);
    }
    if (irp->AssociatedIrp.SystemBuffer == nullptr) {
        return CompleteControlIrp(irp, STATUS_INVALID_USER_BUFFER);
    }

    // METHOD_BUFFERED aliases input/output through SystemBuffer, so copy the
    // request before any response bytes are written.
    const ConnectRequest connect =
        *static_cast<const ConnectRequest*>(irp->AssociatedIrp.SystemBuffer);
    if (ValidateConnectRequest(connect) != DeviceControlContractStatus::kOk) {
        return CompleteControlIrp(irp, STATUS_INVALID_PARAMETER);
    }

    SharedRegionLayout layout{};
    const SharedRegionStatus layout_status = PlanSharedRegionLayout(connect.protocol, &layout);
    if (layout_status != SharedRegionStatus::kOk ||
        layout.total_bytes == 0u ||
        layout.total_bytes > kDeviceControlMaxSectionBytes ||
        layout.total_bytes > static_cast<uint64_t>(MAXULONG_PTR)) {
        return CompleteControlIrp(irp, STATUS_INVALID_BUFFER_SIZE);
    }

    VSN_WDM_CONTROL_CONTEXT* context = GetControlContext(device_object);
    NTSTATUS status = AcquireState(context);
    if (!NT_SUCCESS(status)) {
        return CompleteControlIrp(irp, status);
    }

    if (context->connected != FALSE) {
        ReleaseState(context);
        return CompleteControlIrp(irp, STATUS_DEVICE_BUSY);
    }

    PVOID section_object = nullptr;
    PVOID kernel_view = nullptr;
    HANDLE user_handle = nullptr;
    status = CreateDriverOwnedSection(
        irp,
        connect.protocol,
        layout,
        &section_object,
        &kernel_view,
        &user_handle);
    if (!NT_SUCCESS(status)) {
        ReleaseState(context);
        return CompleteControlIrp(irp, status);
    }

    context->section_object = section_object;
    context->kernel_view = kernel_view;
    context->section_bytes = static_cast<SIZE_T>(layout.total_bytes);
    context->owner_process_id = IoGetRequestorProcessId(irp);
    context->owner_file = stack->FileObject;
    context->protocol = connect.protocol;
    context->connected = TRUE;

    const ConnectResponse response = MakeConnectResponse(
        connect.protocol.session_generation,
        static_cast<uint64_t>(reinterpret_cast<ULONG_PTR>(user_handle)),
        layout.total_bytes,
        DeviceControlStatus::kReady);
    *static_cast<ConnectResponse*>(irp->AssociatedIrp.SystemBuffer) = response;

    ReleaseState(context);
    return CompleteControlIrp(irp, STATUS_SUCCESS, sizeof(ConnectResponse));
}

NTSTATUS CompleteDisconnect(
    PDEVICE_OBJECT device_object,
    PIRP irp,
    PIO_STACK_LOCATION stack) noexcept {
    if (device_object == nullptr || irp == nullptr || stack == nullptr) {
        return CompleteControlIrp(irp, STATUS_INVALID_PARAMETER);
    }

    const ULONG input_bytes = stack->Parameters.DeviceIoControl.InputBufferLength;
    const ULONG output_bytes = stack->Parameters.DeviceIoControl.OutputBufferLength;
    if (input_bytes != sizeof(DisconnectRequest) || output_bytes != 0u) {
        return CompleteControlIrp(irp, STATUS_INFO_LENGTH_MISMATCH);
    }
    if (irp->AssociatedIrp.SystemBuffer == nullptr) {
        return CompleteControlIrp(irp, STATUS_INVALID_USER_BUFFER);
    }

    const DisconnectRequest disconnect =
        *static_cast<const DisconnectRequest*>(irp->AssociatedIrp.SystemBuffer);
    if (ValidateDisconnectRequest(disconnect) != DeviceControlContractStatus::kOk) {
        return CompleteControlIrp(irp, STATUS_INVALID_PARAMETER);
    }

    VSN_WDM_CONTROL_CONTEXT* context = GetControlContext(device_object);
    NTSTATUS status = AcquireState(context);
    if (!NT_SUCCESS(status)) {
        return CompleteControlIrp(irp, status);
    }

    if (!RequestOwnsConnection(
            context,
            irp,
            stack->FileObject,
            disconnect.session_generation)) {
        ReleaseState(context);
        return CompleteControlIrp(irp, STATUS_ACCESS_DENIED);
    }

    ResetConnectionLocked(context);
    ReleaseState(context);
    return CompleteControlIrp(irp, STATUS_SUCCESS);
}

NTSTATUS CompleteQueryStatus(
    PDEVICE_OBJECT device_object,
    PIRP irp,
    PIO_STACK_LOCATION stack) noexcept {
    if (device_object == nullptr || irp == nullptr || stack == nullptr) {
        return CompleteControlIrp(irp, STATUS_INVALID_PARAMETER);
    }

    const ULONG input_bytes = stack->Parameters.DeviceIoControl.InputBufferLength;
    const ULONG output_bytes = stack->Parameters.DeviceIoControl.OutputBufferLength;
    if (input_bytes != sizeof(QueryStatusRequest) || output_bytes != sizeof(StatusResponse)) {
        return CompleteControlIrp(irp, STATUS_INFO_LENGTH_MISMATCH);
    }
    if (irp->AssociatedIrp.SystemBuffer == nullptr) {
        return CompleteControlIrp(irp, STATUS_INVALID_USER_BUFFER);
    }

    const QueryStatusRequest query =
        *static_cast<const QueryStatusRequest*>(irp->AssociatedIrp.SystemBuffer);
    if (ValidateQueryStatusRequest(query) != DeviceControlContractStatus::kOk) {
        return CompleteControlIrp(irp, STATUS_INVALID_PARAMETER);
    }

    VSN_WDM_CONTROL_CONTEXT* context = GetControlContext(device_object);
    NTSTATUS status = AcquireState(context);
    if (!NT_SUCCESS(status)) {
        return CompleteControlIrp(irp, status);
    }

    if (!RequestOwnsConnection(
            context,
            irp,
            stack->FileObject,
            query.session_generation)) {
        ReleaseState(context);
        return CompleteControlIrp(irp, STATUS_ACCESS_DENIED);
    }

    SharedRegionLayout layout{};
    if (PlanSharedRegionLayout(context->protocol, &layout) != SharedRegionStatus::kOk ||
        layout.cursor_offset + sizeof(CursorSnapshot) > context->section_bytes) {
        ReleaseState(context);
        return CompleteControlIrp(irp, STATUS_DATA_ERROR);
    }

    const auto* bytes = static_cast<const unsigned char*>(context->kernel_view);
    const auto* cursors = reinterpret_cast<const CursorSnapshot*>(bytes + layout.cursor_offset);
    CursorSnapshot snapshot{};
    if (ReadStableCursorSnapshot(cursors, &snapshot) != CursorSyncStatus::kOk ||
        snapshot.session_generation != context->protocol.session_generation) {
        ReleaseState(context);
        return CompleteControlIrp(irp, STATUS_DATA_ERROR);
    }

    const StatusResponse response{
        kDeviceControlMagic,
        kDeviceControlVersion,
        static_cast<uint16_t>(sizeof(StatusResponse)),
        context->protocol.session_generation,
        static_cast<uint32_t>(DeviceControlStatus::kReady),
        0u,
        snapshot.producer_sequence,
        snapshot.consumer_sequence,
    };
    *static_cast<StatusResponse*>(irp->AssociatedIrp.SystemBuffer) = response;

    ReleaseState(context);
    return CompleteControlIrp(irp, STATUS_SUCCESS, sizeof(StatusResponse));
}

NTSTATUS CleanupOwnerConnection(
    PDEVICE_OBJECT device_object,
    PFILE_OBJECT file_object) noexcept {
    if (device_object == nullptr || file_object == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    VSN_WDM_CONTROL_CONTEXT* context = GetControlContext(device_object);
    NTSTATUS status = AcquireState(context);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    if (context->connected != FALSE && context->owner_file == file_object) {
        ResetConnectionLocked(context);
    }

    ReleaseState(context);
    return STATUS_SUCCESS;
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
        static_cast<ULONG>(sizeof(VSN_WDM_CONTROL_CONTEXT)),
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

    auto* context = GetControlContext(device_object);
    if (context == nullptr) {
        IoDeleteDevice(device_object);
        return STATUS_INSUFFICIENT_RESOURCES;
    }
    RtlZeroMemory(context, sizeof(*context));
    KeInitializeMutex(&context->state_mutex, 0u);

    device_object->Flags |= DO_BUFFERED_IO;

    status = IoCreateSymbolicLink(
        const_cast<PUNICODE_STRING>(&symbolic_link),
        const_cast<PUNICODE_STRING>(&device_name));
    if (!NT_SUCCESS(status)) {
        IoDeleteDevice(device_object);
        return status;
    }

    // Publish only after the secure named object, extension state and user-
    // visible link are complete. The dispatch wrappers remain disconnected
    // from the current live DriverEntry until this secure IRP port is CI green.
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
    if (device_object != nullptr) {
        VSN_WDM_CONTROL_CONTEXT* context = GetControlContext(device_object);
        if (context != nullptr && NT_SUCCESS(AcquireState(context))) {
            ResetConnectionLocked(context);
            ReleaseState(context);
        }
    }

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
        if (irp->RequestorMode != UserMode || stack->FileObject == nullptr) {
            return CompleteControlIrp(irp, STATUS_ACCESS_DENIED);
        }
        return CompleteControlIrp(irp, STATUS_SUCCESS);
    case IRP_MJ_CLEANUP: {
        const NTSTATUS status = CleanupOwnerConnection(device_object, stack->FileObject);
        return CompleteControlIrp(irp, status);
    }
    case IRP_MJ_CLOSE:
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

    const PIO_STACK_LOCATION stack = IoGetCurrentIrpStackLocation(irp);
    if (stack == nullptr || stack->MajorFunction != IRP_MJ_DEVICE_CONTROL) {
        return CompleteControlIrp(irp, STATUS_INVALID_DEVICE_REQUEST);
    }

    NTSTATUS status = ValidateRawIoctlCaller(irp);
    if (!NT_SUCCESS(status)) {
        return CompleteControlIrp(irp, status);
    }

    switch (stack->Parameters.DeviceIoControl.IoControlCode) {
    case kIoctlVirtualMicConnect:
        return CompleteConnect(device_object, irp, stack);
    case kIoctlVirtualMicDisconnect:
        return CompleteDisconnect(device_object, irp, stack);
    case kIoctlVirtualMicQueryStatus:
        return CompleteQueryStatus(device_object, irp, stack);
    default:
        return CompleteControlIrp(irp, STATUS_INVALID_DEVICE_REQUEST);
    }
}
