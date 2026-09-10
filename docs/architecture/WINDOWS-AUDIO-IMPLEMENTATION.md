# Windows Audio Implementation Contract

**Module:** MOD-002 — Desktop Audio Core & Virtual Devices  
**Work unit:** WU-002  
**Status:** implementation in progress

## Objective

Provide a low-latency Windows audio path that captures a selected physical microphone, runs VSN realtime processing, and exposes the processed stream to calling applications through a VSN virtual microphone without making optional AI processing a single point of failure.

## Platform APIs

The Windows implementation uses the native Windows Core Audio stack rather than a generic high-level audio wrapper for the critical realtime path.

- **MMDevice API / `IMMDeviceEnumerator`** for capture/render endpoint discovery and default endpoint resolution.
- **`IMMNotificationClient`** for device add/remove/state/default-device notifications.
- **WASAPI** for user-mode capture/render streams.
- **`IAudioClient3`** where available to query supported shared-mode engine periods and initialize low-period shared streams.
- **`IAudioCaptureClient`** for microphone capture buffers.
- **Event-driven buffering** rather than polling for the normal realtime path.
- **`AUDCLNT_E_DEVICE_INVALIDATED` recovery** as a normal device-lifecycle event, not an unrecoverable application failure.

Microsoft references:

- https://learn.microsoft.com/windows/win32/coreaudio/wasapi
- https://learn.microsoft.com/windows/win32/coreaudio/core-audio-interfaces
- https://learn.microsoft.com/windows/win32/api/audioclient/nn-audioclient-iaudioclient3

## Internal audio contract

The platform backend must normalize endpoint-specific data into `vsn-audio-core` contracts before optional AI stages.

Initial internal reference format:

- 48 kHz sample rate;
- mono capture for the initial microphone path;
- 32-bit floating-point normalized samples;
- 10 ms frames where endpoint/provider constraints permit;
- monotonic sequence numbers;
- monotonic capture timestamps;
- bounded queues only.

Endpoint-native formats may differ. Format negotiation/conversion must be explicit and benchmarked; silently changing the internal frame contract is not allowed.

## Device selection and recovery

`native/audio-core::device::DeviceCatalog` is the platform-neutral source of truth for selection behavior.

Selection order for capture:

1. active user-preferred capture endpoint;
2. active Windows communications-default capture endpoint;
3. deterministic active capture fallback;
4. visible no-input state if no usable capture endpoint exists.

Required recovery cases:

- microphone unplug/replug;
- Bluetooth/headset disconnect;
- default communications device change;
- device disabled/enabled;
- sleep/wake;
- stream invalidation;
- application audio-service interruption where recoverable.

Recovery must not create an unbounded reopen loop. Repeated identical failures require bounded backoff and a visible degraded/bypassed state.

The current implementation separates MMDevice callback delivery from recovery execution. `IMMNotificationClient` publishes relevant endpoint events into a bounded non-blocking queue; owner-thread runtime code drains and evaluates the batch, then requests at most one capture invalidation/recovery transition for a relevant active capture-route change. Recovery itself remains externally scheduled through `CaptureRuntime`, preserving sequence continuity and bounded retry policy.

## Realtime failure isolation

The call audio path has higher priority than optional AI stages.

- An enhancement/accent/translation stage failure returns the original input frame through the safe-bypass path.
- Queue overload drops according to bounded realtime policy rather than accumulating latency indefinitely.
- Meeting notes, transcription, analytics, telemetry and web UI failures cannot terminate microphone capture.
- Provider/network failures must never make the virtual microphone permanently silent when a local bypass path is still available.

Target from `NON-FUNCTIONAL-REQUIREMENTS.md`: usable processing bypass within 250 ms of a detected supported failure case.

## Virtual microphone architecture

A production Windows virtual microphone requires an OS-visible audio endpoint. The initial production direction is a signed Windows audio driver using Microsoft-supported WDM/WaveRT virtual-audio architecture, with the Microsoft **SysVAD** sample used as architectural reference.

References:

- https://learn.microsoft.com/windows-hardware/drivers/audio/sample-audio-drivers
- https://learn.microsoft.com/samples/microsoft/windows-driver-samples/sysvad-virtual-audio-device-driver-sample/
- https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad

The VSN driver must be reduced to the minimum endpoint/transport surface required by the product rather than shipping an unchanged sample driver.

Planned boundary:

```text
Physical microphone
    -> WASAPI capture backend
    -> vsn-audio-core frame queue
    -> optional realtime AI pipeline
    -> safe bypass/fallback selector
    -> user-mode <-> virtual-device transport
    -> VSN virtual microphone endpoint
    -> Zoom / Teams / Meet / dialers / browser apps
```

### Current user-mode staging boundary

The repository contains a CI-verified user-mode staging/output contract before the future driver boundary:

- `VirtualMicStagingBuffer` accepts one fixed `AudioFormat` and uses a bounded frame queue;
- overflow drops the oldest queued frame rather than allowing latency to grow without bound;
- underrun produces a fresh silence frame with a caller-supplied sequence/timestamp rather than replaying stale speech;
- accepted-frame, overflow-drop and underrun counters are explicit;
- format mismatches are rejected;
- `VirtualMicOutputBridge` sends both successfully processed `AudioPipeline` output and the original safe-bypass frame produced after an optional processing-stage failure into the same staging path.

### Driver-facing protocol contract

The Rust implementation contains a CI-verified, versioned driver-facing metadata/ring contract in `virtual_mic_protocol`:

- `VirtualMicProtocolHeader` and `VirtualMicCursorSnapshot` use `#[repr(C)]` for a stable native binding boundary on the verified Windows x64 target;
- the header carries protocol magic/version, header size, non-zero session generation, sample rate, channels, sample format, frame duration, ring capacity and samples per frame;
- protocol validation rejects incompatible magic/version/header size, invalid audio geometry, unsupported sample format, stale session generation and non-zero reserved fields;
- producer and consumer sequences are monotonic within a session generation;
- `plan_ring_window` maps those sequences to deterministic cyclic-buffer slots;
- if producer distance exceeds ring capacity, the plan advances the logical consumer boundary and discards the oldest frames rather than allowing unbounded latency.

### C++ / future WDK ABI binding

`native/windows-virtual-mic/include/vsn_virtual_mic_protocol.h` mirrors the Rust contract for the future driver boundary and is compiled/executed with MSVC x64 in Windows CI.

The C++ binding verifies:

- protocol magic is the little-endian byte sequence `VSNM`;
- `ProtocolHeader` is exactly 40 bytes, 8-byte aligned, with every field offset locked by `static_assert`;
- `CursorSnapshot` is exactly 40 bytes, 8-byte aligned, with every field offset locked by `static_assert`;
- C++ validation mirrors protocol version, header size, session generation, audio geometry, sample-format, frame-size and reserved-field constraints;
- C++ cyclic ring planning mirrors Rust producer/consumer, wrap, stale-generation, reversed-cursor and oldest-frame overrun behavior.

### Shared cursor synchronization and region layout

The synchronization/layout transport slices are CI verified on MSVC x64:

- `vsn_virtual_mic_cursor_sync.h` accesses the aligned 64-bit cursor fields with Windows `Interlocked*64` primitives, uses bounded stable-snapshot reads, rejects producer/consumer regressions and stale session generations, and atomically tracks overrun/underrun counters;
- producer publication occurs only after the PCM slot is fully written, and consumer publication occurs only after the slot is fully read; the interlocked publication operations provide the user-mode Windows memory barrier for this contract;
- session rollover uses generation `0` as an invalid reset marker and is explicitly permitted only after producer and consumer endpoints have been quiesced; this does not claim lock-free concurrent reset safety;
- `vsn_virtual_mic_region_layout.h` defines a deterministic 64-byte-aligned shared-region geometry: protocol header, cursor block, then PCM ring;
- for the 48 kHz, mono, F32, 10 ms, four-frame reference contract, the header is at offset `0` (40 bytes), cursors at offset `64` (40 bytes), audio at offset `128`, each frame is `1,920` bytes, the ring is `7,680` bytes and total mapping size is `7,808` bytes;
- mapping-size arithmetic is checked and rejects overflow before allocation/mapping is attempted.

### Real user-mode shared-section boundary

`vsn_virtual_mic_shared_section.h` now turns the verified layout into an actual user-mode Windows shared section:

- the section is created with `CreateFileMappingW(INVALID_HANDLE_VALUE, ...)` and mapped with `MapViewOfFile`;
- the mapping is intentionally unnamed, avoiding a globally discoverable/pre-creatable mapping name at this boundary;
- the mapping size comes from the validated region layout and is rejected above a configurable hard limit (16 MiB by default);
- the handle is non-inheritable;
- the security descriptor uses a protected DACL containing only LocalSystem full control and the current authenticated process user read/write access;
- the mapped region is zero-initialized, receives the validated protocol header and initializes the generation-fenced cursor block;
- Windows CI maps a second independent view of the same section and verifies protocol bytes, PCM bytes and producer-cursor publication are visible across both views;
- Windows CI also inspects the handle flags and DACL rather than treating the intended security policy as documentation-only.

This proves real user-mode Windows section creation/mapping and same-process multi-view sharing. It does **not** prove kernel-side section referencing or mapping, cross-process broker handoff, device-interface authorization, or a WaveRT endpoint.

### Device-control ABI for future kernel binding

`vsn_virtual_mic_device_control.h` defines the versioned control contract that a future VSN WDK device will consume:

- `CONNECT`, `DISCONNECT` and `QUERY_STATUS` IOCTLs use `METHOD_BUFFERED`;
- each IOCTL requires both `FILE_READ_ACCESS` and `FILE_WRITE_ACCESS` on the device handle;
- request/response structures have locked x64 size, alignment and field offsets;
- `CONNECT` carries non-zero session generation, the caller's shared-section handle value, exact section byte size and expected virtual-mic protocol magic/version;
- validation rejects null/invalid handle values, zero/oversized mappings, stale/zero generations, mismatched protocol identity, unsupported flags and non-zero reserved fields;
- status validation rejects unknown runtime states and consumer cursors ahead of the producer;
- Windows CI constructs a valid `CONNECT` request from a real `SharedSection` handle and validates the complete request/response contract.

The control ABI is intentionally not evidence of a functioning device. No `DeviceIoControl` call is issued against VSN hardware because no VSN WDK device/interface has been implemented or installed yet. The future kernel handler must independently authorize the caller, reference the supplied section handle in the issuing process context, validate the section object and mapped protocol/size, and own a bounded disconnect/cleanup lifecycle.

The staging/output boundary plus the Rust/C++ protocol, cursor synchronization, region layout, real user-mode mapping and device-control ABI still do not create an OS-visible microphone or calling-application route.

## Driver security and release requirements

Development/test driver code is not production distribution evidence.

Before production release:

- WDK-compatible reproducible build;
- signed driver package/catalog using an approved production signing path;
- installation/uninstallation/upgrade rollback tests;
- non-admin runtime operation after installation;
- Windows supported-version compatibility matrix;
- crash/reboot/sleep/wake tests;
- HLK-relevant test review and documented expected exceptions, if any;
- no embedded production secrets or signing keys;
- installer must fail safely if driver installation is incomplete.

## Verification plan

### CI-verified implementation foundation

- platform-neutral device selection and lifecycle state tests;
- bounded frame queue and safe-bypass behavior;
- format and engine-period validation;
- shared capture cadence planning and packet-to-frame assembly;
- event-driven WASAPI capture session and bounded packet draining;
- native capture sample decoding into validated pipeline frames;
- structured classification of documented WASAPI device/resource/audio-service lifecycle failures;
- bounded externally scheduled capture reopen recovery with sequence continuity;
- `IMMNotificationClient` registration/unregistration on a dedicated Windows MTA thread;
- bounded non-blocking MMDevice notification queue with drop accounting;
- owner-thread notification-to-recovery filtering/deduplication;
- fixed-format bounded user-mode virtual-mic staging with oldest-drop overflow behavior and fresh-silence underrun behavior;
- processed-frame and safe-bypass-frame routing through the same user-mode virtual-mic staging boundary;
- versioned C-compatible virtual-mic protocol header and cursor contract;
- session-generation and fixed-audio-geometry validation;
- deterministic cyclic ring-slot planning and oldest-frame overrun normalization;
- MSVC x64 C++ ABI mirror with locked structure sizes/alignment/field offsets and matching semantic validation;
- aligned Windows interlocked 64-bit cursor publication, bounded stable snapshots, monotonicity/session checks and atomic underrun/overrun counters;
- deterministic 64-byte-aligned header/cursor/PCM shared-region layout with overflow-safe size calculation;
- real unnamed user-mode Windows section creation/mapping with bounded size, non-inheritable handle and protected current-user/LocalSystem DACL;
- two-view mapped protocol/audio/cursor propagation and security-descriptor inspection;
- versioned access-restricted CONNECT/DISCONNECT/QUERY_STATUS device-control ABI with fixed layouts and malformed-input rejection;
- Ubuntu repository-integrity checks plus Windows-native Rust compile/Clippy/tests and C++ protocol/synchronization/layout/shared-section/device-control compile/run tests.

The latest exact implementation head is `8a14b010d0c6b3e097e67d4488194734c2c0142e`, which passed Ubuntu repository-integrity run `34536677479` and Windows Audio Validation run `34536677410`, including the device-control ABI test. The preceding shared-section implementation head `f38dab24018d1c3b04008675c5ddc36e7520c07b` passed Ubuntu run `34536268804` and Windows run `34536269060`; it was merged to main as `9f24e8b56c56505df3b736e3fcf3d88ac236c465`. The device-control ABI was merged to main as `a5a372ac819d2fe2e76f6cbedc54e62bc05d4ec6`.

### Controlled Windows hardware verification still required

- capture from a physical communications microphone with confirmed `IAudioClient3` period values;
- physical unplug/replug event delivery and successful reopen;
- real default communications-device switch and successful route recovery;
- Bluetooth/headset disconnect/reconnect;
- sleep/wake and audio-service interruption recovery where supported;
- CPU usage and callback deadline misses;
- capture discontinuity detection under real hardware load;
- end-to-end capture latency and jitter measurement.

### Driver/test-machine verification still required

- WDK-buildable WaveRT endpoint and topology implementation;
- secure VSN device interface with least-privilege ACL and real IOCTL dispatch;
- kernel-side CONNECT handler that authorizes the caller, references/validates the supplied section handle, maps or otherwise safely accesses the section and owns cleanup on disconnect/process/device teardown;
- kernel-side synchronization/consumer behavior matching the verified generation/cursor publication contract;
- virtual endpoint appears as a microphone to target calling applications;
- processed and bypass audio both reach the endpoint through the actual driver transport;
- Zoom/Teams/Meet/dialer/browser compatibility;
- install/update/uninstall/rollback;
- sleep/wake and reboot persistence;
- device-loss recovery;
- no permanent silence after optional processing failure.

## Current implementation boundary

WU-002 has code-level and hosted-CI evidence for the Windows event-driven WASAPI capture path, packet decoding/reframing, bounded runtime recovery, MMDevice notification registration and notification-to-recovery bridging. It also has CI evidence for a bounded user-mode virtual-microphone staging/output layer, a versioned Rust ring/cursor protocol contract, an MSVC-verified C++ ABI mirror, aligned interlocked cursor publication/stable snapshots, deterministic overflow-safe shared-region geometry, an actual securely configured unnamed user-mode Windows file mapping with verified two-view sharing, and a versioned access-restricted user-to-driver device-control ABI. Hosted Windows CI executes the native Rust compilation/tests plus the C++ protocol/synchronization/layout/shared-section/device-control executables; Ubuntu CI verifies the wider repository integrity and platform-neutral logic.

This evidence does **not** yet prove kernel-side section consumption, a WDK WaveRT endpoint, an OS-visible production virtual microphone, calling-application compatibility, physical-device hotplug/default-device recovery on controlled hardware, hardware latency/jitter targets, or signed driver lifecycle behavior. Those remain required before MOD-002 / WU-002 can be treated as complete.
