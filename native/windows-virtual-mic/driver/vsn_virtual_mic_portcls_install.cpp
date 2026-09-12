#include <ntifs.h>
#include <portcls.h>

#include "../include/vsn_virtual_mic_portcls_install.h"

extern "C" NTSTATUS VsnPortClsInstallSubdevice(
    PDEVICE_OBJECT device_object,
    PIRP irp,
    PWSTR name,
    const GUID* port_class_id,
    PUNKNOWN miniport_unknown,
    PUNKNOWN unknown_adapter,
    PRESOURCELIST resource_list,
    PUNKNOWN* out_port_unknown) noexcept {
    PAGED_CODE();

    if (out_port_unknown != nullptr) {
        *out_port_unknown = nullptr;
    }
    if (device_object == nullptr ||
        irp == nullptr ||
        name == nullptr ||
        name[0] == L'\0' ||
        port_class_id == nullptr ||
        miniport_unknown == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    PPORT port = nullptr;
    NTSTATUS status = PcNewPort(&port, *port_class_id);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    status = port->Init(
        device_object,
        irp,
        miniport_unknown,
        unknown_adapter,
        resource_list);
    if (NT_SUCCESS(status)) {
        status = PcRegisterSubdevice(device_object, name, port);
    }
    if (NT_SUCCESS(status) && out_port_unknown != nullptr) {
        *out_port_unknown = PUNKNOWN(port);
        (*out_port_unknown)->AddRef();
    }

    port->Release();
    return status;
}

extern "C" NTSTATUS VsnPortClsRegisterPhysicalConnection(
    PDEVICE_OBJECT device_object,
    PUNKNOWN from_port_unknown,
    ULONG from_pin,
    PUNKNOWN to_port_unknown,
    ULONG to_pin) noexcept {
    PAGED_CODE();

    if (device_object == nullptr ||
        from_port_unknown == nullptr ||
        to_port_unknown == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    return PcRegisterPhysicalConnection(
        device_object,
        from_port_unknown,
        from_pin,
        to_port_unknown,
        to_pin);
}
