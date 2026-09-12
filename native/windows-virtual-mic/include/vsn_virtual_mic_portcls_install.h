#pragma once

#include <ntifs.h>
#include <portcls.h>

// Creates a system PortCls port, binds it to a caller-owned custom miniport,
// registers the resulting subdevice and optionally returns an IUnknown reference
// for later physical-connection registration. The Name buffer must remain valid
// for the lifetime of the device object, as required by PcRegisterSubdevice.
extern "C" NTSTATUS VsnPortClsInstallSubdevice(
    PDEVICE_OBJECT device_object,
    PIRP irp,
    PWSTR name,
    const GUID* port_class_id,
    PUNKNOWN miniport_unknown,
    PUNKNOWN unknown_adapter,
    PRESOURCELIST resource_list,
    PUNKNOWN* out_port_unknown) noexcept;

// Registers an in-adapter physical connection between two already registered
// PortCls subdevices. PortCls requires IPort-derived IUnknown pointers here.
extern "C" NTSTATUS VsnPortClsRegisterPhysicalConnection(
    PDEVICE_OBJECT device_object,
    PUNKNOWN from_port_unknown,
    ULONG from_pin,
    PUNKNOWN to_port_unknown,
    ULONG to_pin) noexcept;
