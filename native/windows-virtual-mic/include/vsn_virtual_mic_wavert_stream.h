#pragma once

#include <ntifs.h>
#include <portcls.h>

// Creates a bounded capture-only WaveRT stream object against the caller-owned
// PortCls stream interface. The object starts in KSSTATE_STOP, supports the
// fixed VSN virtual-microphone format and retains no ownership of the format
// pointer after construction. The returned interface carries one caller-owned
// reference.
extern "C" NTSTATUS VsnCreateVirtualMicWaveRtStream(
    PMINIPORTWAVERTSTREAM* out_stream,
    PUNKNOWN unknown_outer,
    PPORTWAVERTSTREAM port_stream,
    PKSDATAFORMAT data_format) noexcept;
