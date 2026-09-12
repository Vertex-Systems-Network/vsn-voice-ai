#include <ntifs.h>
#include <portcls.h>
#include <wdf.h>

extern "C" NTSTATUS VsnPortClsInitializeAdapterScaffold(
    PDRIVER_OBJECT driver_object,
    PUNICODE_STRING registry_path) noexcept;
extern "C" NTSTATUS VsnWdmControlCreateScaffold(PDRIVER_OBJECT driver_object) noexcept;
extern "C" void VsnWdmControlDeleteScaffold() noexcept;
extern "C" DRIVER_DISPATCH VsnWdmControlDispatchCreateClose;
extern "C" DRIVER_DISPATCH VsnWdmControlDispatchDeviceControl;

namespace {

PDRIVER_UNLOAD g_portcls_unload = nullptr;
BOOLEAN g_raw_control_created = FALSE;

void RestorePortClsDispatch(
    PDRIVER_OBJECT driver_object,
    PDRIVER_DISPATCH create_dispatch,
    PDRIVER_DISPATCH close_dispatch,
    PDRIVER_DISPATCH cleanup_dispatch,
    PDRIVER_DISPATCH device_control_dispatch) noexcept {
    if (driver_object == nullptr) {
        return;
    }

    driver_object->MajorFunction[IRP_MJ_CREATE] = create_dispatch;
    driver_object->MajorFunction[IRP_MJ_CLOSE] = close_dispatch;
    driver_object->MajorFunction[IRP_MJ_CLEANUP] = cleanup_dispatch;
    driver_object->MajorFunction[IRP_MJ_DEVICE_CONTROL] = device_control_dispatch;
}

void UnloadWdfMiniportIfCreated() noexcept {
    const WDFDRIVER driver = WdfGetDriver();
    if (driver != nullptr) {
        WdfDriverMiniportUnload(driver);
    }
}

} // namespace

extern "C" DRIVER_INITIALIZE DriverEntry;
extern "C" DRIVER_UNLOAD VsnVirtualMicDriverUnload;

extern "C" void VsnVirtualMicDriverUnload(PDRIVER_OBJECT driver_object) {
    PAGED_CODE();

    if (g_raw_control_created != FALSE) {
        VsnWdmControlDeleteScaffold();
        g_raw_control_created = FALSE;
    }

    // PortCls owns the adapter/PnP relationship. Follow the official audio
    // sample ordering: invoke the saved PortCls unload routine before releasing
    // the KMDF miniport helper object.
    PDRIVER_UNLOAD portcls_unload = g_portcls_unload;
    g_portcls_unload = nullptr;
    if (portcls_unload != nullptr && driver_object != nullptr) {
        portcls_unload(driver_object);
    }

    UnloadWdfMiniportIfCreated();
}

extern "C" NTSTATUS DriverEntry(
    PDRIVER_OBJECT driver_object,
    PUNICODE_STRING registry_path) {
    if (driver_object == nullptr || registry_path == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    // This driver is a PortCls miniport client. KMDF may be used only as a
    // miniport helper and must not replace the class driver's IRP dispatch.
    WDF_DRIVER_CONFIG config{};
    WDF_DRIVER_CONFIG_INIT(&config, WDF_NO_EVENT_CALLBACK);
    config.DriverInitFlags |= WdfDriverInitNoDispatchOverride;

    NTSTATUS status = WdfDriverCreate(
        driver_object,
        registry_path,
        WDF_NO_OBJECT_ATTRIBUTES,
        &config,
        WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    // PcInitializeAdapterDriver installs the PortCls AddDevice and IRP handlers.
    // StartDevice remains deliberately fail-closed in the current lifecycle
    // scaffold, so this slice activates class-driver ownership without claiming
    // a registered/usable audio endpoint.
    status = VsnPortClsInitializeAdapterScaffold(driver_object, registry_path);
    if (!NT_SUCCESS(status)) {
        UnloadWdfMiniportIfCreated();
        return status;
    }

    // Capture PortCls handlers before installing the exact-control-DO
    // multiplexers. Those multiplexers call PcDispatchIrp for every PortCls
    // device object and handle only the separately created raw control object.
    PDRIVER_DISPATCH portcls_create = driver_object->MajorFunction[IRP_MJ_CREATE];
    PDRIVER_DISPATCH portcls_close = driver_object->MajorFunction[IRP_MJ_CLOSE];
    PDRIVER_DISPATCH portcls_cleanup = driver_object->MajorFunction[IRP_MJ_CLEANUP];
    PDRIVER_DISPATCH portcls_device_control =
        driver_object->MajorFunction[IRP_MJ_DEVICE_CONTROL];
    PDRIVER_UNLOAD portcls_unload = driver_object->DriverUnload;

    driver_object->MajorFunction[IRP_MJ_CREATE] = VsnWdmControlDispatchCreateClose;
    driver_object->MajorFunction[IRP_MJ_CLOSE] = VsnWdmControlDispatchCreateClose;
    driver_object->MajorFunction[IRP_MJ_CLEANUP] = VsnWdmControlDispatchCreateClose;
    driver_object->MajorFunction[IRP_MJ_DEVICE_CONTROL] = VsnWdmControlDispatchDeviceControl;

    // Publish the user-visible control object only after the final dispatch
    // table is installed so an immediate open cannot race an unprepared path.
    status = VsnWdmControlCreateScaffold(driver_object);
    if (!NT_SUCCESS(status)) {
        RestorePortClsDispatch(
            driver_object,
            portcls_create,
            portcls_close,
            portcls_cleanup,
            portcls_device_control);
        if (portcls_unload != nullptr) {
            portcls_unload(driver_object);
        }
        UnloadWdfMiniportIfCreated();
        return status;
    }

    g_raw_control_created = TRUE;
    g_portcls_unload = portcls_unload;
    driver_object->DriverUnload = VsnVirtualMicDriverUnload;
    return STATUS_SUCCESS;
}
