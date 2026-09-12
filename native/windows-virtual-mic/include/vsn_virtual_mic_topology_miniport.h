#pragma once

#include <ntifs.h>
#include <portcls.h>

// Creates the smallest VSN topology miniport required to bind the already
// verified topology filter descriptor to the system PortCls topology port.
// The returned IUnknown carries one caller-owned reference.
extern "C" NTSTATUS VsnCreateVirtualMicTopologyMiniport(
    PUNKNOWN* out_unknown,
    PUNKNOWN unknown_outer) noexcept;
