#include <ntifs.h>
#include <wdf.h>
#include <portcls.h>

namespace {

constexpr ULONG kVsnPortClsMaxSubdevices = 2u; // WaveRT + topology.
static_assert(kVsnPortClsMaxSubdevices == 2u, "PortCls subdevice budget drifted");

extern "C" NTSTATUS VsnPortClsStartDeviceScaffold(
    PDEVICE_OBJECT device_object,
    PIRP irp,
    PRESOURCELIST resource_list) noexcept {
    UNREFERENCED_PARAMETER(resource_list);

    // Compile/link boundary only. This callback is intentionally fail-closed
    // until real wave/topology miniport objects are created and registered.
    if (device_object == nullptr || irp == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    return STATUS_NOT_SUPPORTED;
}

} // namespace

extern "C" NTSTATUS VsnPortClsAddDeviceScaffold(
    PDRIVER_OBJECT driver_object,
    PDEVICE_OBJECT physical_device_object) noexcept {
    if (driver_object == nullptr || physical_device_object == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    return PcAddAdapterDevice(
        driver_object,
        physical_device_object,
        VsnPortClsStartDeviceScaffold,
        kVsnPortClsMaxSubdevices,
        0u);
}

extern "C" NTSTATUS VsnPortClsInitializeAdapterScaffold(
    PDRIVER_OBJECT driver_object,
    PUNICODE_STRING registry_path) noexcept {
    if (driver_object == nullptr || registry_path == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    // This function is deliberately not DriverEntry yet. Wiring PortCls into
    // the live entry point requires refactoring the existing KMDF control
    // surface to WDF miniport/control-device semantics so PortCls owns the PnP
    // dispatch path. Until that refactor is verified, this linkage remains a
    // fail-closed compile contract rather than a runtime registration claim.
    return PcInitializeAdapterDriver(
        driver_object,
        registry_path,
        VsnPortClsAddDeviceScaffold);
}
