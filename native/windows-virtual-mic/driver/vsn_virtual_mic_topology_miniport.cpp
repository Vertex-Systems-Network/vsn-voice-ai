#include <ntifs.h>
#include <portcls.h>
#include <stdunk.h>

#include "../include/vsn_virtual_mic_topology_miniport.h"

extern "C" const PCFILTER_DESCRIPTOR* VsnVirtualMicTopologyFilterDescriptor() noexcept;

namespace {

constexpr ULONG kVsnTopologyPoolTag = 'TnSV';

class VsnVirtualMicTopologyMiniport final :
    public IMiniportTopology,
    public CUnknown {
public:
    DECLARE_STD_UNKNOWN();
    IMP_IMiniportTopology;

    explicit VsnVirtualMicTopologyMiniport(PUNKNOWN unknown_outer) noexcept
        : CUnknown(unknown_outer) {}

    static void* operator new(size_t size) noexcept {
        return ExAllocatePool2(POOL_FLAG_NON_PAGED, size, kVsnTopologyPoolTag);
    }

    static void operator delete(void* memory) noexcept {
        if (memory != nullptr) {
            ExFreePoolWithTag(memory, kVsnTopologyPoolTag);
        }
    }

    static void operator delete(void* memory, size_t) noexcept {
        operator delete(memory);
    }

    STDMETHODIMP NonDelegatingQueryInterface(
        REFIID interface_id,
        PVOID* object) override;
};

#pragma code_seg("PAGE")
STDMETHODIMP VsnVirtualMicTopologyMiniport::NonDelegatingQueryInterface(
    REFIID interface_id,
    PVOID* object) {
    PAGED_CODE();

    if (object == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    *object = nullptr;

    if (IsEqualGUIDAligned(interface_id, IID_IUnknown)) {
        *object = PUNKNOWN(this);
    } else if (IsEqualGUIDAligned(interface_id, IID_IMiniport)) {
        *object = PMINIPORT(this);
    } else if (IsEqualGUIDAligned(interface_id, IID_IMiniportTopology)) {
        *object = PMINIPORTTOPOLOGY(this);
    } else {
        return STATUS_INVALID_PARAMETER;
    }

    PUNKNOWN(*object)->AddRef();
    return STATUS_SUCCESS;
}

STDMETHODIMP VsnVirtualMicTopologyMiniport::DataRangeIntersection(
    ULONG pin_id,
    PKSDATARANGE client_data_range,
    PKSDATARANGE my_data_range,
    ULONG output_buffer_length,
    PVOID resultant_format,
    PULONG resultant_format_length) {
    PAGED_CODE();

    UNREFERENCED_PARAMETER(pin_id);
    UNREFERENCED_PARAMETER(client_data_range);
    UNREFERENCED_PARAMETER(my_data_range);
    UNREFERENCED_PARAMETER(output_buffer_length);
    UNREFERENCED_PARAMETER(resultant_format);

    if (resultant_format_length == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    *resultant_format_length = 0u;

    // The topology filter only bridges the fixed analog-style connection.
    // Let PortCls perform its default data-range intersection handling.
    return STATUS_NOT_IMPLEMENTED;
}

STDMETHODIMP VsnVirtualMicTopologyMiniport::GetDescription(
    PPCFILTER_DESCRIPTOR* out_filter_descriptor) {
    PAGED_CODE();

    if (out_filter_descriptor == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }

    *out_filter_descriptor =
        const_cast<PPCFILTER_DESCRIPTOR>(VsnVirtualMicTopologyFilterDescriptor());
    return STATUS_SUCCESS;
}

STDMETHODIMP VsnVirtualMicTopologyMiniport::Init(
    PUNKNOWN unknown_adapter,
    PRESOURCELIST resource_list,
    PPORTTOPOLOGY port) {
    PAGED_CODE();

    UNREFERENCED_PARAMETER(unknown_adapter);
    UNREFERENCED_PARAMETER(resource_list);

    // This virtual endpoint has no physical topology hardware to initialize,
    // but PortCls must provide the topology port that is being bound.
    return port != nullptr ? STATUS_SUCCESS : STATUS_INVALID_PARAMETER;
}
#pragma code_seg()

} // namespace

#pragma code_seg("PAGE")
extern "C" NTSTATUS VsnCreateVirtualMicTopologyMiniport(
    PUNKNOWN* out_unknown,
    PUNKNOWN unknown_outer) noexcept {
    PAGED_CODE();

    if (out_unknown == nullptr) {
        return STATUS_INVALID_PARAMETER;
    }
    *out_unknown = nullptr;

    auto* miniport = new VsnVirtualMicTopologyMiniport(unknown_outer);
    if (miniport == nullptr) {
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    miniport->AddRef();
    *out_unknown = PUNKNOWN(miniport);
    return STATUS_SUCCESS;
}
#pragma code_seg()
