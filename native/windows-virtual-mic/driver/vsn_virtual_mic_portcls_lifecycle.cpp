#include <ntifs.h>
#include <wdf.h>
#include <portcls.h>

#include "../include/vsn_virtual_mic_portcls_install.h"
#include "../include/vsn_virtual_mic_topology_miniport.h"
#include "../include/vsn_virtual_mic_wavert_contract.h"
#include "../include/vsn_virtual_mic_wavert_miniport.h"

namespace {

using namespace vsn::virtual_mic;

constexpr ULONG kVsnPortClsMaxSubdevices = 2u; // WaveRT + topology.
static_assert(kVsnPortClsMaxSubdevices == 2u, "PortCls subdevice budget drifted");

// PcRegisterSubdevice retains the supplied name buffer; these names therefore
// have static storage for the full lifetime of the adapter device.
WCHAR kVsnTopologySubdeviceName[] = L"VSNTopology";
WCHAR kVsnWaveSubdeviceName[] = L"VSNWave";

void ReleaseUnknown(PUNKNOWN& value) noexcept {
    if (value != nullptr) {
        value->Release();
        value = nullptr;
    }
}

NTSTATUS UnregisterSubdevice(
    PDEVICE_OBJECT device_object,
    PUNKNOWN port_unknown) noexcept {
    if (device_object == nullptr || port_unknown == nullptr) {
        return STATUS_SUCCESS;
    }

    PUNREGISTERSUBDEVICE unregister_subdevice = nullptr;
    NTSTATUS status = port_unknown->QueryInterface(
        IID_IUnregisterSubdevice,
        reinterpret_cast<PVOID*>(&unregister_subdevice));
    if (NT_SUCCESS(status)) {
        status = unregister_subdevice->UnregisterSubdevice(
            device_object,
            port_unknown);
        unregister_subdevice->Release();
    }
    return status;
}

extern "C" NTSTATUS VsnPortClsStartDeviceScaffold(
    PDEVICE_OBJECT device_object,
    PIRP irp,
    PRESOURCELIST resource_list) noexcept {
    PAGED_CODE();

    if (device_object == nullptr || irp == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    PUNKNOWN topology_miniport = nullptr;
    PUNKNOWN wave_miniport = nullptr;
    PUNKNOWN topology_port = nullptr;
    PUNKNOWN wave_port = nullptr;

    bool topology_registered = false;
    bool wave_registered = false;

    NTSTATUS status = VsnCreateVirtualMicTopologyMiniport(
        &topology_miniport,
        nullptr);
    if (!NT_SUCCESS(status)) {
        goto Exit;
    }

    status = VsnPortClsInstallSubdevice(
        device_object,
        irp,
        kVsnTopologySubdeviceName,
        &CLSID_PortTopology,
        topology_miniport,
        nullptr,
        resource_list,
        &topology_port);
    if (!NT_SUCCESS(status)) {
        goto Exit;
    }
    topology_registered = true;

    status = VsnCreateVirtualMicWaveRtMiniport(
        &wave_miniport,
        nullptr);
    if (!NT_SUCCESS(status)) {
        goto Exit;
    }

    status = VsnPortClsInstallSubdevice(
        device_object,
        irp,
        kVsnWaveSubdeviceName,
        &CLSID_PortWaveRT,
        wave_miniport,
        nullptr,
        resource_list,
        &wave_port);
    if (!NT_SUCCESS(status)) {
        goto Exit;
    }
    wave_registered = true;

    // Capture endpoint direction follows the Microsoft SimpleAudioSample
    // microphone pair: topology bridge output -> WaveRT bridge input.
    status = VsnPortClsRegisterPhysicalConnection(
        device_object,
        topology_port,
        kWaveRtTopologyBridgePin,
        wave_port,
        kWaveRtWaveBridgePin);

Exit:
    if (!NT_SUCCESS(status)) {
        // Unwind in reverse registration order. A failed physical-connection
        // call publishes no successful endpoint claim, so subdevice teardown is
        // sufficient for the single-connection topology used here.
        if (wave_registered) {
            const NTSTATUS unregister_wave =
                UnregisterSubdevice(device_object, wave_port);
            UNREFERENCED_PARAMETER(unregister_wave);
        }
        if (topology_registered) {
            const NTSTATUS unregister_topology =
                UnregisterSubdevice(device_object, topology_port);
            UNREFERENCED_PARAMETER(unregister_topology);
        }
    }

    ReleaseUnknown(wave_port);
    ReleaseUnknown(topology_port);
    ReleaseUnknown(wave_miniport);
    ReleaseUnknown(topology_miniport);
    return status;
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

    return PcInitializeAdapterDriver(
        driver_object,
        registry_path,
        VsnPortClsAddDeviceScaffold);
}
