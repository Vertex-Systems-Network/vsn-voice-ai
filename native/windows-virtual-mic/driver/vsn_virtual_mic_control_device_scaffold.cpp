#include <ntifs.h>
#include <wdf.h>

namespace {

EVT_WDF_IO_QUEUE_IO_DEVICE_CONTROL VsnControlDeviceFailClosedIoctl;

void VsnControlDeviceFailClosedIoctl(
    WDFQUEUE queue,
    WDFREQUEST request,
    size_t output_buffer_length,
    size_t input_buffer_length,
    ULONG io_control_code) noexcept {
    UNREFERENCED_PARAMETER(queue);
    UNREFERENCED_PARAMETER(output_buffer_length);
    UNREFERENCED_PARAMETER(input_buffer_length);
    UNREFERENCED_PARAMETER(io_control_code);

    // This scaffold proves the PortCls-compatible WDF control-device shape.
    // It must not accidentally expose an alternate IOCTL path before the
    // verified secure CONNECT/DISCONNECT/QUERY_STATUS handlers are migrated.
    WdfRequestComplete(request, STATUS_NOT_SUPPORTED);
}

} // namespace

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

    WdfDeviceInitSetDeviceType(device_init, FILE_DEVICE_UNKNOWN);
    WdfDeviceInitSetExclusive(device_init, TRUE);
    WdfDeviceInitSetIoType(device_init, WdfDeviceIoBuffered);

    NTSTATUS status = WdfDeviceInitAssignName(device_init, &device_name);
    if (!NT_SUCCESS(status)) {
        WdfDeviceInitFree(device_init);
        return status;
    }

    WDF_OBJECT_ATTRIBUTES device_attributes{};
    WDF_OBJECT_ATTRIBUTES_INIT(&device_attributes);
    device_attributes.ExecutionLevel = WdfExecutionLevelPassive;

    WDFDEVICE device = nullptr;
    status = WdfDeviceCreate(&device_init, &device_attributes, &device);
    if (!NT_SUCCESS(status)) {
        if (device_init != nullptr) {
            WdfDeviceInitFree(device_init);
        }
        return status;
    }

    status = WdfDeviceCreateSymbolicLink(device, &symbolic_link);
    if (!NT_SUCCESS(status)) {
        WdfObjectDelete(device);
        return status;
    }

    WDF_IO_QUEUE_CONFIG queue_config{};
    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(
        &queue_config,
        WdfIoQueueDispatchSequential);
    queue_config.EvtIoDeviceControl = VsnControlDeviceFailClosedIoctl;

    WDF_OBJECT_ATTRIBUTES queue_attributes{};
    WDF_OBJECT_ATTRIBUTES_INIT(&queue_attributes);
    queue_attributes.ExecutionLevel = WdfExecutionLevelPassive;

    status = WdfIoQueueCreate(
        device,
        &queue_config,
        &queue_attributes,
        WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) {
        WdfObjectDelete(device);
        return status;
    }

    // Control devices reject I/O until this explicit completion point.
    WdfControlFinishInitializing(device);
    *output_device = device;
    return STATUS_SUCCESS;
}
