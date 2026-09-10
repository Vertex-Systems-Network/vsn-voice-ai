#include <ntifs.h>
#include <wdf.h>

#include "../include/vsn_virtual_mic_cursor_sync.h"
#include "../include/vsn_virtual_mic_device_control.h"
#include "../include/vsn_virtual_mic_region_layout.h"

namespace {

using namespace vsn::virtual_mic;

// {5A1AA6C3-52B8-4AD8-94A2-7A5A02ED3164}
const GUID GUID_DEVINTERFACE_VSN_VIRTUAL_MIC_CONTROL = {
    0x5a1aa6c3,
    0x52b8,
    0x4ad8,
    {0x94, 0xa2, 0x7a, 0x5a, 0x02, 0xed, 0x31, 0x64},
};

struct VSN_DEVICE_CONTEXT final {
    WDFWAITLOCK state_lock;
    PVOID section_object;
    PVOID kernel_view;
    SIZE_T section_bytes;
    ULONG owner_process_id;
    WDFFILEOBJECT owner_file;
    ProtocolHeader protocol;
    BOOLEAN connected;
};

WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(VSN_DEVICE_CONTEXT, VsnGetDeviceContext);

EVT_WDF_DRIVER_DEVICE_ADD VsnEvtDeviceAdd;
EVT_WDF_IO_QUEUE_IO_DEVICE_CONTROL VsnEvtIoDeviceControl;
EVT_WDF_FILE_CLEANUP VsnEvtFileCleanup;
EVT_WDF_OBJECT_CONTEXT_CLEANUP VsnEvtDeviceCleanup;

void ResetConnectionLocked(VSN_DEVICE_CONTEXT* context) noexcept {
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
    const VSN_DEVICE_CONTEXT* context,
    WDFREQUEST request,
    uint64_t session_generation) noexcept {
    return context->connected != FALSE &&
        context->owner_process_id == WdfRequestGetRequestorProcessId(request) &&
        context->owner_file == WdfRequestGetFileObject(request) &&
        context->protocol.session_generation == session_generation;
}

NTSTATUS CreateDriverOwnedSection(
    WDFREQUEST request,
    const ProtocolHeader& protocol,
    const SharedRegionLayout& layout,
    PVOID* section_object_output,
    PVOID* kernel_view_output,
    HANDLE* user_handle_output) noexcept {
    if (section_object_output == nullptr || kernel_view_output == nullptr || user_handle_output == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    *section_object_output = nullptr;
    *kernel_view_output = nullptr;
    *user_handle_output = nullptr;

    const ULONG requestor_pid = WdfRequestGetRequestorProcessId(request);
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
        // This handle was created by this driver while attached to the requestor
        // process. It is never accepted from user input. Retain an independent
        // object reference before exposing the handle value back to user mode.
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

void CompleteConnect(WDFREQUEST request, VSN_DEVICE_CONTEXT* context) noexcept {
    PVOID input_buffer = nullptr;
    size_t input_bytes = 0u;
    NTSTATUS status = WdfRequestRetrieveInputBuffer(
        request,
        sizeof(ConnectRequest),
        &input_buffer,
        &input_bytes);
    if (!NT_SUCCESS(status) || input_bytes != sizeof(ConnectRequest)) {
        WdfRequestComplete(request, NT_SUCCESS(status) ? STATUS_INFO_LENGTH_MISMATCH : status);
        return;
    }

    // METHOD_BUFFERED can use one system buffer for input and output. Copy the
    // request before retrieving/writing the response.
    const ConnectRequest connect = *static_cast<const ConnectRequest*>(input_buffer);
    if (ValidateConnectRequest(connect) != DeviceControlContractStatus::kOk) {
        WdfRequestComplete(request, STATUS_INVALID_PARAMETER);
        return;
    }

    SharedRegionLayout layout{};
    const SharedRegionStatus layout_status = PlanSharedRegionLayout(connect.protocol, &layout);
    if (layout_status != SharedRegionStatus::kOk ||
        layout.total_bytes == 0u ||
        layout.total_bytes > kDeviceControlMaxSectionBytes ||
        layout.total_bytes > static_cast<uint64_t>(MAXULONG_PTR)) {
        WdfRequestComplete(request, STATUS_INVALID_BUFFER_SIZE);
        return;
    }

    PVOID output_buffer = nullptr;
    size_t output_bytes = 0u;
    status = WdfRequestRetrieveOutputBuffer(
        request,
        sizeof(ConnectResponse),
        &output_buffer,
        &output_bytes);
    if (!NT_SUCCESS(status) || output_bytes < sizeof(ConnectResponse)) {
        WdfRequestComplete(request, NT_SUCCESS(status) ? STATUS_BUFFER_TOO_SMALL : status);
        return;
    }

    WdfWaitLockAcquire(context->state_lock, nullptr);
    if (context->connected != FALSE) {
        WdfWaitLockRelease(context->state_lock);
        WdfRequestComplete(request, STATUS_DEVICE_BUSY);
        return;
    }

    PVOID section_object = nullptr;
    PVOID kernel_view = nullptr;
    HANDLE user_handle = nullptr;
    status = CreateDriverOwnedSection(
        request,
        connect.protocol,
        layout,
        &section_object,
        &kernel_view,
        &user_handle);
    if (!NT_SUCCESS(status)) {
        WdfWaitLockRelease(context->state_lock);
        WdfRequestComplete(request, status);
        return;
    }

    context->section_object = section_object;
    context->kernel_view = kernel_view;
    context->section_bytes = static_cast<SIZE_T>(layout.total_bytes);
    context->owner_process_id = WdfRequestGetRequestorProcessId(request);
    context->owner_file = WdfRequestGetFileObject(request);
    context->protocol = connect.protocol;
    context->connected = TRUE;

    const ConnectResponse response = MakeConnectResponse(
        connect.protocol.session_generation,
        static_cast<uint64_t>(reinterpret_cast<ULONG_PTR>(user_handle)),
        layout.total_bytes,
        DeviceControlStatus::kReady);
    *static_cast<ConnectResponse*>(output_buffer) = response;

    WdfWaitLockRelease(context->state_lock);
    WdfRequestCompleteWithInformation(request, STATUS_SUCCESS, sizeof(ConnectResponse));
}

void CompleteDisconnect(WDFREQUEST request, VSN_DEVICE_CONTEXT* context) noexcept {
    PVOID input_buffer = nullptr;
    size_t input_bytes = 0u;
    NTSTATUS status = WdfRequestRetrieveInputBuffer(
        request,
        sizeof(DisconnectRequest),
        &input_buffer,
        &input_bytes);
    if (!NT_SUCCESS(status) || input_bytes != sizeof(DisconnectRequest)) {
        WdfRequestComplete(request, NT_SUCCESS(status) ? STATUS_INFO_LENGTH_MISMATCH : status);
        return;
    }

    const DisconnectRequest disconnect = *static_cast<const DisconnectRequest*>(input_buffer);
    if (ValidateDisconnectRequest(disconnect) != DeviceControlContractStatus::kOk) {
        WdfRequestComplete(request, STATUS_INVALID_PARAMETER);
        return;
    }

    WdfWaitLockAcquire(context->state_lock, nullptr);
    if (!RequestOwnsConnection(context, request, disconnect.session_generation)) {
        WdfWaitLockRelease(context->state_lock);
        WdfRequestComplete(request, STATUS_ACCESS_DENIED);
        return;
    }

    ResetConnectionLocked(context);
    WdfWaitLockRelease(context->state_lock);
    WdfRequestComplete(request, STATUS_SUCCESS);
}

void CompleteQueryStatus(WDFREQUEST request, VSN_DEVICE_CONTEXT* context) noexcept {
    PVOID input_buffer = nullptr;
    size_t input_bytes = 0u;
    NTSTATUS status = WdfRequestRetrieveInputBuffer(
        request,
        sizeof(QueryStatusRequest),
        &input_buffer,
        &input_bytes);
    if (!NT_SUCCESS(status) || input_bytes != sizeof(QueryStatusRequest)) {
        WdfRequestComplete(request, NT_SUCCESS(status) ? STATUS_INFO_LENGTH_MISMATCH : status);
        return;
    }

    const QueryStatusRequest query = *static_cast<const QueryStatusRequest*>(input_buffer);
    if (ValidateQueryStatusRequest(query) != DeviceControlContractStatus::kOk) {
        WdfRequestComplete(request, STATUS_INVALID_PARAMETER);
        return;
    }

    PVOID output_buffer = nullptr;
    size_t output_bytes = 0u;
    status = WdfRequestRetrieveOutputBuffer(
        request,
        sizeof(StatusResponse),
        &output_buffer,
        &output_bytes);
    if (!NT_SUCCESS(status) || output_bytes < sizeof(StatusResponse)) {
        WdfRequestComplete(request, NT_SUCCESS(status) ? STATUS_BUFFER_TOO_SMALL : status);
        return;
    }

    WdfWaitLockAcquire(context->state_lock, nullptr);
    if (!RequestOwnsConnection(context, request, query.session_generation)) {
        WdfWaitLockRelease(context->state_lock);
        WdfRequestComplete(request, STATUS_ACCESS_DENIED);
        return;
    }

    SharedRegionLayout layout{};
    if (PlanSharedRegionLayout(context->protocol, &layout) != SharedRegionStatus::kOk ||
        layout.cursor_offset + sizeof(CursorSnapshot) > context->section_bytes) {
        WdfWaitLockRelease(context->state_lock);
        WdfRequestComplete(request, STATUS_DATA_ERROR);
        return;
    }

    const auto* bytes = static_cast<const unsigned char*>(context->kernel_view);
    const auto* cursors = reinterpret_cast<const CursorSnapshot*>(bytes + layout.cursor_offset);
    CursorSnapshot snapshot{};
    if (ReadStableCursorSnapshot(cursors, &snapshot) != CursorSyncStatus::kOk ||
        snapshot.session_generation != context->protocol.session_generation) {
        WdfWaitLockRelease(context->state_lock);
        WdfRequestComplete(request, STATUS_DATA_ERROR);
        return;
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
    *static_cast<StatusResponse*>(output_buffer) = response;

    WdfWaitLockRelease(context->state_lock);
    WdfRequestCompleteWithInformation(request, STATUS_SUCCESS, sizeof(StatusResponse));
}

} // namespace

extern "C" DRIVER_INITIALIZE DriverEntry;

extern "C" NTSTATUS DriverEntry(
    PDRIVER_OBJECT driver_object,
    PUNICODE_STRING registry_path) {
    WDF_DRIVER_CONFIG config{};
    WDF_DRIVER_CONFIG_INIT(&config, VsnEvtDeviceAdd);
    return WdfDriverCreate(
        driver_object,
        registry_path,
        WDF_NO_OBJECT_ATTRIBUTES,
        &config,
        WDF_NO_HANDLE);
}

namespace {

NTSTATUS VsnEvtDeviceAdd(WDFDRIVER driver, PWDFDEVICE_INIT device_init) {
    UNREFERENCED_PARAMETER(driver);

    // WdfDeviceInitAssignSDDLString requires either a name or the autogenerated
    // device-name characteristic. This development control surface is limited
    // to SYSTEM and built-in Administrators until a non-admin broker policy is
    // explicitly designed and verified.
    WdfDeviceInitSetCharacteristics(device_init, FILE_AUTOGENERATED_DEVICE_NAME, TRUE);
    WdfDeviceInitSetDeviceType(device_init, FILE_DEVICE_UNKNOWN);
    DECLARE_CONST_UNICODE_STRING(sddl, L"D:P(A;;GA;;;SY)(A;;GA;;;BA)");
    NTSTATUS status = WdfDeviceInitAssignSDDLString(device_init, &sddl);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    WdfDeviceInitSetExclusive(device_init, TRUE);
    WdfDeviceInitSetIoType(device_init, WdfDeviceIoBuffered);

    WDF_FILEOBJECT_CONFIG file_config{};
    WDF_FILEOBJECT_CONFIG_INIT(
        &file_config,
        WDF_NO_EVENT_CALLBACK,
        WDF_NO_EVENT_CALLBACK,
        VsnEvtFileCleanup);
    WdfDeviceInitSetFileObjectConfig(device_init, &file_config, WDF_NO_OBJECT_ATTRIBUTES);

    WDF_OBJECT_ATTRIBUTES device_attributes{};
    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&device_attributes, VSN_DEVICE_CONTEXT);
    device_attributes.EvtCleanupCallback = VsnEvtDeviceCleanup;
    device_attributes.ExecutionLevel = WdfExecutionLevelPassive;

    WDFDEVICE device = nullptr;
    status = WdfDeviceCreate(&device_init, &device_attributes, &device);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    auto* context = VsnGetDeviceContext(device);
    RtlZeroMemory(context, sizeof(*context));

    // Keep the wait lock parented to the WDF driver (its documented default),
    // not the device. Child cleanup runs before parent cleanup, so a device-
    // parented lock could already be gone when VsnEvtDeviceCleanup executes.
    status = WdfWaitLockCreate(WDF_NO_OBJECT_ATTRIBUTES, &context->state_lock);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = WdfDeviceCreateDeviceInterface(
        device,
        &GUID_DEVINTERFACE_VSN_VIRTUAL_MIC_CONTROL,
        nullptr);
    if (!NT_SUCCESS(status)) {
        WdfObjectDelete(context->state_lock);
        context->state_lock = nullptr;
        return status;
    }

    WDF_IO_QUEUE_CONFIG queue_config{};
    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queue_config, WdfIoQueueDispatchSequential);
    queue_config.EvtIoDeviceControl = VsnEvtIoDeviceControl;

    WDF_OBJECT_ATTRIBUTES queue_attributes{};
    WDF_OBJECT_ATTRIBUTES_INIT(&queue_attributes);
    queue_attributes.ExecutionLevel = WdfExecutionLevelPassive;

    status = WdfIoQueueCreate(
        device,
        &queue_config,
        &queue_attributes,
        WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) {
        WdfObjectDelete(context->state_lock);
        context->state_lock = nullptr;
    }
    return status;
}

void VsnEvtIoDeviceControl(
    WDFQUEUE queue,
    WDFREQUEST request,
    size_t output_buffer_length,
    size_t input_buffer_length,
    ULONG io_control_code) {
    UNREFERENCED_PARAMETER(output_buffer_length);
    UNREFERENCED_PARAMETER(input_buffer_length);

    if (WdfRequestGetRequestorMode(request) != UserMode) {
        WdfRequestComplete(request, STATUS_ACCESS_DENIED);
        return;
    }

    auto* context = VsnGetDeviceContext(WdfIoQueueGetDevice(queue));
    switch (io_control_code) {
    case kIoctlVirtualMicConnect:
        CompleteConnect(request, context);
        break;
    case kIoctlVirtualMicDisconnect:
        CompleteDisconnect(request, context);
        break;
    case kIoctlVirtualMicQueryStatus:
        CompleteQueryStatus(request, context);
        break;
    default:
        WdfRequestComplete(request, STATUS_INVALID_DEVICE_REQUEST);
        break;
    }
}

void VsnEvtFileCleanup(WDFFILEOBJECT file_object) {
    auto* context = VsnGetDeviceContext(WdfFileObjectGetDevice(file_object));
    if (context->state_lock == nullptr) {
        return;
    }

    WdfWaitLockAcquire(context->state_lock, nullptr);
    if (context->connected != FALSE && context->owner_file == file_object) {
        ResetConnectionLocked(context);
    }
    WdfWaitLockRelease(context->state_lock);
}

void VsnEvtDeviceCleanup(WDFOBJECT device_object) {
    auto* context = VsnGetDeviceContext(reinterpret_cast<WDFDEVICE>(device_object));
    WDFWAITLOCK lock = context->state_lock;
    if (lock == nullptr) {
        return;
    }

    WdfWaitLockAcquire(lock, nullptr);
    ResetConnectionLocked(context);
    WdfWaitLockRelease(lock);

    context->state_lock = nullptr;
    WdfObjectDelete(lock);
}

} // namespace
