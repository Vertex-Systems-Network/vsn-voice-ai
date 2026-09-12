#pragma once

#include <ntifs.h>
#include <portcls.h>

// Creates the minimal VSN WaveRT capture miniport shell. The returned IUnknown
// carries one caller-owned reference. Concrete WaveRT stream creation remains a
// separate slice and NewStream therefore fails closed after validation.
extern "C" NTSTATUS VsnCreateVirtualMicWaveRtMiniport(
    PUNKNOWN* out_unknown,
    PUNKNOWN unknown_outer) noexcept;
