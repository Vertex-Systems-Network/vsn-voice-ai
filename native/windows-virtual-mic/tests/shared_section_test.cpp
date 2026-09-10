#include "vsn_virtual_mic_shared_section.h"

#include <Aclapi.h>

#include <cstdio>
#include <vector>

namespace {

using vsn::virtual_mic::ContractStatus;
using vsn::virtual_mic::CursorSnapshot;
using vsn::virtual_mic::CursorSyncStatus;
using vsn::virtual_mic::PlanSharedRegionLayout;
using vsn::virtual_mic::ProtocolHeader;
using vsn::virtual_mic::PublishProducerSequence;
using vsn::virtual_mic::ReadStableCursorSnapshot;
using vsn::virtual_mic::SharedRegionLayout;
using vsn::virtual_mic::SharedRegionStatus;
using vsn::virtual_mic::SharedSection;
using vsn::virtual_mic::SharedSectionStatus;
using vsn::virtual_mic::ValidateHeader;
using vsn::virtual_mic::kProtocolMagic;
using vsn::virtual_mic::kProtocolVersion;
using vsn::virtual_mic::kSampleFormatF32Le;

int Require(bool condition, const char* message) {
    if (condition) {
        return 0;
    }
    std::fprintf(stderr, "virtual-mic shared section validation failed: %s\n", message);
    return 1;
}

ProtocolHeader ReferenceHeader() {
    return ProtocolHeader{
        kProtocolMagic,
        kProtocolVersion,
        static_cast<uint16_t>(sizeof(ProtocolHeader)),
        21u,
        48'000u,
        1u,
        kSampleFormatF32Le,
        10'000u,
        4u,
        480u,
        0u,
    };
}

bool ReadCurrentUserSid(std::vector<uint8_t>* storage, PSID* sid) {
    if (storage == nullptr || sid == nullptr) {
        return false;
    }

    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
        return false;
    }

    DWORD bytes = 0u;
    if (GetTokenInformation(token, TokenUser, nullptr, 0u, &bytes) ||
        GetLastError() != ERROR_INSUFFICIENT_BUFFER || bytes == 0u) {
        CloseHandle(token);
        return false;
    }

    storage->resize(bytes);
    if (!GetTokenInformation(token, TokenUser, storage->data(), bytes, &bytes)) {
        CloseHandle(token);
        return false;
    }
    CloseHandle(token);

    const auto* token_user = reinterpret_cast<const TOKEN_USER*>(storage->data());
    *sid = token_user->User.Sid;
    return IsValidSid(*sid) != FALSE;
}

bool ValidateRestrictedDacl(HANDLE mapping) {
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    PACL dacl = nullptr;
    const DWORD security_result = GetSecurityInfo(
        mapping,
        SE_KERNEL_OBJECT,
        DACL_SECURITY_INFORMATION,
        nullptr,
        nullptr,
        &dacl,
        nullptr,
        &descriptor);
    if (security_result != ERROR_SUCCESS || descriptor == nullptr || dacl == nullptr) {
        if (descriptor != nullptr) {
            LocalFree(descriptor);
        }
        return false;
    }

    SECURITY_DESCRIPTOR_CONTROL control = 0u;
    DWORD revision = 0u;
    const bool protected_dacl =
        GetSecurityDescriptorControl(descriptor, &control, &revision) != FALSE &&
        (control & SE_DACL_PROTECTED) != 0u;

    ACL_SIZE_INFORMATION acl_info{};
    const bool acl_info_ok =
        GetAclInformation(dacl, &acl_info, sizeof(acl_info), AclSizeInformation) != FALSE;

    std::vector<uint8_t> user_storage;
    PSID user_sid = nullptr;
    const bool user_sid_ok = ReadCurrentUserSid(&user_storage, &user_sid);

    BYTE system_sid_storage[SECURITY_MAX_SID_SIZE]{};
    DWORD system_sid_bytes = sizeof(system_sid_storage);
    const bool system_sid_ok =
        CreateWellKnownSid(
            WinLocalSystemSid,
            nullptr,
            system_sid_storage,
            &system_sid_bytes) != FALSE;

    bool user_allow_found = false;
    bool system_allow_found = false;
    bool only_allow_aces = true;

    if (acl_info_ok && user_sid_ok && system_sid_ok) {
        for (DWORD index = 0u; index < acl_info.AceCount; ++index) {
            void* ace_raw = nullptr;
            if (!GetAce(dacl, index, &ace_raw) || ace_raw == nullptr) {
                only_allow_aces = false;
                break;
            }

            const auto* header = static_cast<const ACE_HEADER*>(ace_raw);
            if (header->AceType != ACCESS_ALLOWED_ACE_TYPE) {
                only_allow_aces = false;
                continue;
            }

            const auto* allow_ace = static_cast<const ACCESS_ALLOWED_ACE*>(ace_raw);
            PSID ace_sid = const_cast<DWORD*>(&allow_ace->SidStart);
            if (EqualSid(ace_sid, user_sid) != FALSE) {
                user_allow_found = true;
            }
            if (EqualSid(ace_sid, system_sid_storage) != FALSE) {
                system_allow_found = true;
            }
        }
    }

    const bool result =
        protected_dacl && acl_info_ok && acl_info.AceCount == 2u &&
        user_sid_ok && system_sid_ok && only_allow_aces &&
        user_allow_found && system_allow_found;
    LocalFree(descriptor);
    return result;
}

} // namespace

int main() {
    const ProtocolHeader reference = ReferenceHeader();
    if (Require(ValidateHeader(reference) == ContractStatus::kOk, "reference header rejected")) {
        return 1;
    }

    SharedRegionLayout reference_layout{};
    if (Require(
            PlanSharedRegionLayout(reference, &reference_layout) == SharedRegionStatus::kOk,
            "reference region layout rejected")) {
        return 1;
    }

    SharedSection too_small;
    if (Require(
            SharedSection::Create(
                reference,
                &too_small,
                nullptr,
                reference_layout.total_bytes - 1u) == SharedSectionStatus::kRegionTooLarge,
            "mapping size limit did not reject oversized region") ||
        Require(!too_small.valid(), "failed mapping unexpectedly produced a valid section")) {
        return 1;
    }

    ProtocolHeader invalid = reference;
    invalid.magic = 0u;
    SharedSection invalid_section;
    if (Require(
            SharedSection::Create(invalid, &invalid_section) == SharedSectionStatus::kInvalidHeader,
            "invalid protocol header created a shared section")) {
        return 1;
    }

    SharedSection section;
    DWORD create_error = ERROR_SUCCESS;
    if (Require(
            SharedSection::Create(reference, &section, &create_error) == SharedSectionStatus::kOk,
            "shared section creation failed") ||
        Require(create_error == ERROR_SUCCESS, "shared section returned unexpected Win32 error") ||
        Require(section.valid(), "created shared section is invalid") ||
        Require(section.handle() != nullptr, "created shared section handle is null") ||
        Require(section.view() != nullptr, "created shared section view is null") ||
        Require(section.header() != nullptr, "mapped protocol header is null") ||
        Require(section.cursors() != nullptr, "mapped cursor block is null") ||
        Require(section.audio_data() != nullptr, "mapped audio ring is null")) {
        return 1;
    }

    if (Require(
            ValidateHeader(*section.header()) == ContractStatus::kOk,
            "mapped protocol header is invalid") ||
        Require(section.header()->session_generation == 21u, "mapped generation mismatch") ||
        Require(section.layout().total_bytes == 7'808u, "mapped total size mismatch")) {
        return 1;
    }

    DWORD handle_flags = 0u;
    if (Require(
            GetHandleInformation(section.handle(), &handle_flags) != FALSE,
            "could not inspect mapping handle flags") ||
        Require((handle_flags & HANDLE_FLAG_INHERIT) == 0u, "mapping handle is inheritable") ||
        Require(ValidateRestrictedDacl(section.handle()), "mapping DACL is not restricted as expected")) {
        return 1;
    }

    CursorSnapshot snapshot{};
    if (Require(
            ReadStableCursorSnapshot(section.cursors(), &snapshot) == CursorSyncStatus::kOk,
            "initial mapped cursor snapshot failed") ||
        Require(snapshot.session_generation == 21u, "mapped cursor generation mismatch") ||
        Require(snapshot.producer_sequence == 0u, "mapped producer did not initialize to zero") ||
        Require(snapshot.consumer_sequence == 0u, "mapped consumer did not initialize to zero")) {
        return 1;
    }

    void* second_view = MapViewOfFile(
        section.handle(),
        FILE_MAP_READ | FILE_MAP_WRITE,
        0u,
        0u,
        static_cast<SIZE_T>(section.layout().total_bytes));
    if (Require(second_view != nullptr, "second view mapping failed")) {
        return 1;
    }

    auto* second_bytes = static_cast<uint8_t*>(second_view);
    const auto* second_header = reinterpret_cast<const ProtocolHeader*>(
        second_bytes + section.layout().header_offset);
    auto* second_cursors = reinterpret_cast<CursorSnapshot*>(
        second_bytes + section.layout().cursor_offset);
    auto* second_audio = second_bytes + section.layout().audio_offset;

    section.audio_data()[0] = 0x11u;
    section.audio_data()[1] = 0x22u;
    section.audio_data()[2] = 0x33u;
    section.audio_data()[3] = 0x44u;

    if (Require(
            ValidateHeader(*second_header) == ContractStatus::kOk,
            "second view protocol header is invalid") ||
        Require(second_audio[0] == 0x11u, "shared audio byte 0 did not propagate") ||
        Require(second_audio[1] == 0x22u, "shared audio byte 1 did not propagate") ||
        Require(second_audio[2] == 0x33u, "shared audio byte 2 did not propagate") ||
        Require(second_audio[3] == 0x44u, "shared audio byte 3 did not propagate")) {
        UnmapViewOfFile(second_view);
        return 1;
    }

    if (Require(
            PublishProducerSequence(section.cursors(), 21u, 1u) == CursorSyncStatus::kOk,
            "producer publication through first view failed") ||
        Require(
            ReadStableCursorSnapshot(second_cursors, &snapshot) == CursorSyncStatus::kOk,
            "cursor read through second view failed") ||
        Require(snapshot.producer_sequence == 1u, "producer publication did not cross views")) {
        UnmapViewOfFile(second_view);
        return 1;
    }

    UnmapViewOfFile(second_view);
    section.Reset();
    if (Require(!section.valid(), "section remained valid after reset")) {
        return 1;
    }

    std::puts("VSN virtual microphone shared section validation passed.");
    return 0;
}
