#pragma once

#include "vsn_virtual_mic_cursor_sync.h"
#include "vsn_virtual_mic_region_layout.h"

#if !defined(_WIN32)
#error "VSN virtual microphone shared sections are Windows-only"
#endif

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <sddl.h>

#include <cstring>
#include <limits>
#include <string>
#include <utility>
#include <vector>

#pragma comment(lib, "Advapi32.lib")

namespace vsn::virtual_mic {

constexpr uint64_t kDefaultMaxSharedSectionBytes = 16u * 1024u * 1024u;

enum class SharedSectionStatus : uint32_t {
    kOk = 0u,
    kNullOutput,
    kInvalidHeader,
    kInvalidSizeLimit,
    kRegionTooLarge,
    kTokenOpenFailed,
    kTokenQueryFailed,
    kSidConversionFailed,
    kSecurityDescriptorFailed,
    kCreateMappingFailed,
    kMapViewFailed,
    kCursorInitializationFailed,
};

inline void SetSharedSectionWin32Error(DWORD* output, DWORD value) noexcept {
    if (output != nullptr) {
        *output = value;
    }
}

inline SharedSectionStatus BuildSharedSectionSecurityDescriptor(
    PSECURITY_DESCRIPTOR* output,
    DWORD* win32_error) {
    if (output == nullptr) {
        return SharedSectionStatus::kNullOutput;
    }
    *output = nullptr;
    SetSharedSectionWin32Error(win32_error, ERROR_SUCCESS);

    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
        SetSharedSectionWin32Error(win32_error, GetLastError());
        return SharedSectionStatus::kTokenOpenFailed;
    }

    DWORD token_bytes = 0u;
    if (GetTokenInformation(token, TokenUser, nullptr, 0u, &token_bytes) ||
        GetLastError() != ERROR_INSUFFICIENT_BUFFER || token_bytes == 0u) {
        const DWORD error = GetLastError();
        CloseHandle(token);
        SetSharedSectionWin32Error(win32_error, error);
        return SharedSectionStatus::kTokenQueryFailed;
    }

    std::vector<uint8_t> token_buffer(token_bytes);
    if (!GetTokenInformation(
            token,
            TokenUser,
            token_buffer.data(),
            token_bytes,
            &token_bytes)) {
        const DWORD error = GetLastError();
        CloseHandle(token);
        SetSharedSectionWin32Error(win32_error, error);
        return SharedSectionStatus::kTokenQueryFailed;
    }
    CloseHandle(token);

    const auto* token_user = reinterpret_cast<const TOKEN_USER*>(token_buffer.data());
    LPWSTR user_sid_string = nullptr;
    if (!ConvertSidToStringSidW(token_user->User.Sid, &user_sid_string)) {
        SetSharedSectionWin32Error(win32_error, GetLastError());
        return SharedSectionStatus::kSidConversionFailed;
    }

    const std::wstring sddl =
        L"D:P(A;;GA;;;SY)(A;;GRGW;;;" + std::wstring(user_sid_string) + L")";
    LocalFree(user_sid_string);

    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.c_str(),
            SDDL_REVISION_1,
            &descriptor,
            nullptr)) {
        SetSharedSectionWin32Error(win32_error, GetLastError());
        return SharedSectionStatus::kSecurityDescriptorFailed;
    }

    *output = descriptor;
    return SharedSectionStatus::kOk;
}

class SharedSection final {
public:
    SharedSection() noexcept = default;

    ~SharedSection() noexcept {
        Reset();
    }

    SharedSection(const SharedSection&) = delete;
    SharedSection& operator=(const SharedSection&) = delete;

    SharedSection(SharedSection&& other) noexcept {
        MoveFrom(std::move(other));
    }

    SharedSection& operator=(SharedSection&& other) noexcept {
        if (this != &other) {
            Reset();
            MoveFrom(std::move(other));
        }
        return *this;
    }

    static SharedSectionStatus Create(
        const ProtocolHeader& header,
        SharedSection* output,
        DWORD* win32_error = nullptr,
        uint64_t max_region_bytes = kDefaultMaxSharedSectionBytes) {
        if (output == nullptr) {
            return SharedSectionStatus::kNullOutput;
        }
        SetSharedSectionWin32Error(win32_error, ERROR_SUCCESS);

        if (ValidateHeader(header) != ContractStatus::kOk) {
            return SharedSectionStatus::kInvalidHeader;
        }
        if (max_region_bytes == 0u) {
            return SharedSectionStatus::kInvalidSizeLimit;
        }

        SharedRegionLayout layout{};
        const SharedRegionStatus layout_status = PlanSharedRegionLayout(header, &layout);
        if (layout_status == SharedRegionStatus::kInvalidHeader) {
            return SharedSectionStatus::kInvalidHeader;
        }
        if (layout_status != SharedRegionStatus::kOk ||
            layout.total_bytes > max_region_bytes ||
            layout.total_bytes >
                static_cast<uint64_t>((std::numeric_limits<SIZE_T>::max)())) {
            return SharedSectionStatus::kRegionTooLarge;
        }

        PSECURITY_DESCRIPTOR security_descriptor = nullptr;
        const SharedSectionStatus security_status =
            BuildSharedSectionSecurityDescriptor(&security_descriptor, win32_error);
        if (security_status != SharedSectionStatus::kOk) {
            return security_status;
        }

        SECURITY_ATTRIBUTES security_attributes{};
        security_attributes.nLength = sizeof(security_attributes);
        security_attributes.lpSecurityDescriptor = security_descriptor;
        security_attributes.bInheritHandle = FALSE;

        const DWORD size_high = static_cast<DWORD>(layout.total_bytes >> 32u);
        const DWORD size_low = static_cast<DWORD>(layout.total_bytes & 0xFFFFFFFFu);
        HANDLE mapping = CreateFileMappingW(
            INVALID_HANDLE_VALUE,
            &security_attributes,
            PAGE_READWRITE,
            size_high,
            size_low,
            nullptr);
        const DWORD mapping_error = mapping == nullptr ? GetLastError() : ERROR_SUCCESS;
        LocalFree(security_descriptor);

        if (mapping == nullptr) {
            SetSharedSectionWin32Error(win32_error, mapping_error);
            return SharedSectionStatus::kCreateMappingFailed;
        }

        void* view = MapViewOfFile(
            mapping,
            FILE_MAP_READ | FILE_MAP_WRITE,
            0u,
            0u,
            static_cast<SIZE_T>(layout.total_bytes));
        if (view == nullptr) {
            const DWORD error = GetLastError();
            CloseHandle(mapping);
            SetSharedSectionWin32Error(win32_error, error);
            return SharedSectionStatus::kMapViewFailed;
        }

        // Zero initialization is part of protocol v2: before producer_sequence
        // advances, all per-slot stamps are stable sequence zero values. A slot
        // is never consumed while the global producer cursor remains empty.
        std::memset(view, 0, static_cast<size_t>(layout.total_bytes));
        auto* bytes = static_cast<uint8_t*>(view);
        std::memcpy(bytes + layout.header_offset, &header, sizeof(header));
        auto* cursors = reinterpret_cast<CursorSnapshot*>(bytes + layout.cursor_offset);
        if (InitializeCursorSession(cursors, header.session_generation) != CursorSyncStatus::kOk) {
            UnmapViewOfFile(view);
            CloseHandle(mapping);
            return SharedSectionStatus::kCursorInitializationFailed;
        }

        SharedSection created;
        created.mapping_ = mapping;
        created.view_ = view;
        created.layout_ = layout;
        *output = std::move(created);
        return SharedSectionStatus::kOk;
    }

    bool valid() const noexcept {
        return mapping_ != nullptr && view_ != nullptr;
    }

    HANDLE handle() const noexcept {
        return mapping_;
    }

    void* view() const noexcept {
        return view_;
    }

    const SharedRegionLayout& layout() const noexcept {
        return layout_;
    }

    ProtocolHeader* header() const noexcept {
        if (!valid()) {
            return nullptr;
        }
        return reinterpret_cast<ProtocolHeader*>(
            static_cast<uint8_t*>(view_) + layout_.header_offset);
    }

    CursorSnapshot* cursors() const noexcept {
        if (!valid()) {
            return nullptr;
        }
        return reinterpret_cast<CursorSnapshot*>(
            static_cast<uint8_t*>(view_) + layout_.cursor_offset);
    }

    FrameSlotStamp* slot_stamps() const noexcept {
        if (!valid()) {
            return nullptr;
        }
        return reinterpret_cast<FrameSlotStamp*>(
            static_cast<uint8_t*>(view_) + layout_.slot_stamps_offset);
    }

    uint8_t* audio_data() const noexcept {
        if (!valid()) {
            return nullptr;
        }
        return static_cast<uint8_t*>(view_) + layout_.audio_offset;
    }

    void Reset() noexcept {
        if (view_ != nullptr) {
            UnmapViewOfFile(view_);
            view_ = nullptr;
        }
        if (mapping_ != nullptr) {
            CloseHandle(mapping_);
            mapping_ = nullptr;
        }
        layout_ = SharedRegionLayout{};
    }

private:
    void MoveFrom(SharedSection&& other) noexcept {
        mapping_ = other.mapping_;
        view_ = other.view_;
        layout_ = other.layout_;
        other.mapping_ = nullptr;
        other.view_ = nullptr;
        other.layout_ = SharedRegionLayout{};
    }

    HANDLE mapping_ = nullptr;
    void* view_ = nullptr;
    SharedRegionLayout layout_{};
};

} // namespace vsn::virtual_mic
