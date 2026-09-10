# Windows Audio Implementation Contract

**Module:** MOD-002 — Desktop Audio Core & Virtual Devices  
**Work unit:** WU-002  
**Status:** implementation in progress

## Objective

Provide a low-latency Windows audio path that captures a selected physical microphone, runs VSN realtime processing, and exposes processed or safely bypassed audio to calling applications through an OS-visible VSN virtual microphone.

The verified implementation currently reaches a WDK-buildable KMDF control-driver/shared-memory boundary. It does **not** yet provide the final WaveRT/PortCls audio miniport or an installed OS-visible microphone endpoint.

## Platform APIs

The critical Windows realtime path uses native Windows audio/device APIs:

- MMDevice API / `IMMDeviceEnumerator` for endpoint discovery and default endpoint resolution;
- `IMMNotificationClient` for endpoint lifecycle notifications;
- WASAPI and `IAudioClient3` for capture stream setup and period planning;
- `IAudioCaptureClient` for capture packets;
- event-driven buffering for normal realtime capture;
- WDF/KMDF for the current virtual-mic control-driver boundary;
- planned PortCls/WaveRT miniport architecture for the OS-visible virtual microphone endpoint.

Microsoft architectural references include WASAPI/Core Audio, WDF, WaveRT and the SysVAD virtual-audio sample. The production VSN driver must use only the minimum required endpoint/transport surface rather than shipping an unchanged sample implementation.

## Internal audio contract

Initial internal reference format:

- 48 kHz;
- mono microphone path;
- F32 normalized samples;
- 10 ms frames where endpoint/provider constraints permit;
- monotonic sequence numbers and capture timestamps;
- bounded queues only.

Endpoint-native formats may differ. Conversion must remain explicit and benchmarked.

## Device selection and recovery

`native/audio-core::device::DeviceCatalog` remains the platform-neutral source of truth.

Capture selection order:

1. active user-preferred endpoint;
2. active Windows communications-default endpoint;
3. deterministic active fallback;
4. visible no-input state.

Recovery requirements include unplug/replug, Bluetooth/headset disconnect, default-device change, disabled/enabled endpoints, sleep/wake, stream invalidation and recoverable audio-service interruption.

Current hosted-CI evidence covers deterministic selection/reselection, structured retryable failures, `CaptureRuntime` bounded reopen recovery and the MMDevice notification bridge. Physical hardware event delivery/recovery is still a controlled-machine verification item.

## Realtime failure isolation

Optional AI processing must not become a single point of failure for base call audio.

- optional processing failure returns the original input frame through safe bypass;
- bounded queues drop according to realtime policy instead of accumulating latency indefinitely;
- provider/network/UI/meeting-intelligence failures must not terminate microphone capture;
- virtual-mic underrun must produce fresh silence rather than replay stale speech;
- supported failure paths should reach usable bypass within the non-functional requirement target.

## Virtual microphone architecture

Target path:

```text
Physical microphone
    -> WASAPI capture backend
    -> vsn-audio-core frame queue
    -> optional realtime AI pipeline
    -> safe bypass/fallback selector
    -> user-mode virtual-mic producer
    -> verified shared-region/control contract
    -> kernel ring consumer
    -> WaveRT/PortCls VSN capture endpoint
    -> Zoom / Teams / Meet / dialers / browser apps
```

## Verified user-mode output boundary

`VirtualMicStagingBuffer` and `VirtualMicOutputBridge` are CI verified:

- one fixed output format per session;
- bounded queue;
- oldest-frame drop on overflow;
- fresh-silence output on underrun;
- explicit accepted/drop/underrun counters;
- processed output and safe-bypass originals use the same virtual-mic staging path.

## Shared protocol and ring contract

Rust and C++ share a versioned wire contract.

`VirtualMicProtocolHeader` / `ProtocolHeader` and `VirtualMicCursorSnapshot` / `CursorSnapshot` provide:

- stable C-compatible layout;
- protocol magic/version/header-size validation;
- non-zero session generation;
- fixed sample rate/channel/sample format/frame duration/ring capacity/samples-per-frame geometry;
- monotonic producer and consumer sequences;
- deterministic cyclic-ring slot planning;
- bounded overrun normalization by discarding the oldest logical window.

The C++ ABI is MSVC x64 verified with exact structure sizes/alignment/offsets locked by `static_assert`.

## Cursor synchronization and shared-region layout

`vsn_virtual_mic_cursor_sync.h` and `vsn_virtual_mic_region_layout.h` provide the shared-memory synchronization contract.

- aligned 64-bit cursor operations use Windows interlocked primitives;
- stable reads are bounded;
- stale generations and cursor regressions are rejected;
- producer publication occurs after the PCM slot write;
- consumer publication occurs after the PCM slot read;
- session reset uses generation `0` only after producer/consumer quiescence;
- region geometry is 64-byte aligned and overflow checked.

Reference layout for 48 kHz mono F32, 10 ms frames, ring capacity 4:

- header: offset `0`, 40 bytes;
- cursor block: offset `64`, 40 bytes;
- audio: offset `128`;
- frame: `1,920` bytes;
- ring: `7,680` bytes;
- total: `7,808` bytes.

## User-mode shared-section implementation

`vsn_virtual_mic_shared_section.h` provides a CI-verified user-mode shared mapping used by transport/security tests:

- `CreateFileMappingW(INVALID_HANDLE_VALUE, ...)` + `MapViewOfFile`;
- unnamed mapping;
- validated layout-derived size;
- configurable 16 MiB default maximum;
- non-inheritable handle;
- protected DACL restricted to LocalSystem plus the current authenticated process user;
- initialized protocol/cursors;
- second-view propagation checks for protocol/audio/cursors;
- explicit handle/DACL inspection in Windows CI.

This user-mode helper is test evidence for the shared-region contract. The secure installed-driver connection path is the driver-owned handshake described below.

## Device-control ABI v2

`vsn_virtual_mic_device_control.h` defines the current kernel/user control contract.

IOCTLs:

- `CONNECT`;
- `DISCONNECT`;
- `QUERY_STATUS`.

All use `METHOD_BUFFERED` and require `FILE_READ_ACCESS | FILE_WRITE_ACCESS`.

The security-critical v2 change is that **CONNECT no longer accepts a caller-provided section handle**. The request carries validated protocol geometry/session metadata. The driver creates the section itself and returns a user handle only after successful initialization.

The v1 user-supplied-handle assumption was removed before KMDF implementation. Secure-v2 verification passed AI Native run `34537871677` and Windows run `34537871806`, then merged to `main` as `3953069f468c46d744f30625b3696e5b12f03a77`.

## KMDF control-driver boundary

`native/windows-virtual-mic/driver/vsn_virtual_mic_control.cpp` implements the current WDK control plane.

Build contract:

- x64 KMDF Desktop driver;
- minimum KMDF 1.21;
- pinned Microsoft WDK/SDK NuGet `10.0.28000.2526`;
- `/W4` and project warnings-as-errors retained;
- WDK post-build API validation remains enabled;
- Desktop target classification is intentional because this product is a Windows desktop calling application and the current section-mapping path uses desktop-driver DDIs.

Development device security:

- device interface is restricted to LocalSystem and built-in Administrators;
- runtime non-admin broker/interface policy is not yet finalized and must not be inferred from this development ACL;
- requestor mode is checked for the IOCTL path;
- connection ownership is fenced by requestor process ID plus WDF file object;
- session generation is also checked for disconnect/status operations.

CONNECT lifecycle:

1. retrieve and exactly size-check the buffered v2 request;
2. validate protocol/session geometry and bounded region size;
3. resolve the requestor process;
4. create a paging-file-backed section while attached to requestor context;
5. immediately retain an independent kernel section-object reference;
6. map the retained object into system space;
7. zero/initialize protocol header and generation-fenced cursor block;
8. store immutable authoritative protocol geometry in device context;
9. retain requestor PID + owning file object;
10. return the user section handle and ready response only after successful initialization.

The kernel does not rely on user-written mapped header bytes as authoritative configuration after CONNECT; driver context holds the validated geometry.

QUERY_STATUS reads a stable cursor snapshot through the retained system-space mapping. DISCONNECT and cleanup release the system-space view and section-object reference. File cleanup handles owner-close teardown; device cleanup also performs bounded teardown. The WDF wait-lock lifetime is driver-parented so it remains valid through device cleanup.

## Current CI evidence

Latest implementation head: `6bb193f96ecec505f341600b5577b18e4046a89c`.

Verified green runs:

- AI Native Quality Gates: `34539554036`;
- Windows Audio Validation: `34539554115`.

The Windows run verifies, in order:

- pinned Rust toolchain install;
- `vsn-windows-audio` compile;
- Clippy with warnings denied;
- Windows Rust tests;
- pinned WDK/SDK package restore;
- KMDF `vsn_virtual_mic_control.sys` build;
- WDK post-build validation;
- native C++ protocol/cursor/layout/shared-section/device-control compile/run regression tests.

The implementation merged to main as `b2761ad400d92c1d810751fabcf4b071a40dfb9c`.

## What this evidence proves

The repository now has code-level and hosted-Windows-CI evidence for:

- event-driven WASAPI capture foundation;
- device lifecycle/recovery state machines;
- user-mode virtual-mic staging and safe-bypass routing;
- Rust/C++ protocol ABI;
- shared cursor synchronization and region layout;
- real Windows shared-memory behavior/security tests;
- secure driver-owned CONNECT-v2 contract;
- WDK-buildable KMDF control driver;
- kernel-created shared-section lifecycle with retained object reference/system-space mapping;
- access-restricted control interface and bounded ownership/cleanup logic.

## What is still not proven

This evidence does **not** yet prove:

- a WaveRT/PortCls audio miniport/topology;
- an OS-visible VSN microphone endpoint;
- actual kernel audio consumption from the ring on an audio-engine schedule;
- WaveRT position/notification behavior;
- INF/package installation or test signing;
- runtime `DeviceIoControl` against an installed VSN device;
- endpoint enumeration through Windows Core Audio;
- processed/bypass audio reaching Zoom, Teams, Meet, dialers or browsers;
- physical hotplug/default-device recovery on controlled hardware;
- controlled-hardware CPU, callback deadline, latency or jitter targets;
- production signing/install/update/uninstall/rollback behavior.

## Next WU-002 implementation boundary

The next authorized implementation slice remains inside `WU-002`:

1. establish the minimal WDK WaveRT/PortCls virtual-microphone endpoint/topology skeleton;
2. bind a kernel ring-consumer path to the retained shared region without trusting mutable user configuration;
3. implement bounded underrun/silence and generation-reset behavior at the audio-consumer boundary;
4. add compile/static contract checks in hosted Windows CI;
5. then add an INF/test package and controlled Windows-machine install/enumeration/runtime handshake evidence;
6. only after endpoint enumeration and real audio flow should calling-app compatibility testing begin.

`WU-002` must remain in progress until its acceptance criterion is actually satisfied: approved desktop calling applications consume processed audio with safe bypass through the OS-visible VSN virtual microphone.

## Driver security and release requirements

Before production release:

- least-privilege runtime access design, not the current admin-only development interface;
- approved driver signing/package/catalog path;
- installation/uninstallation/update/rollback verification;
- supported Windows compatibility matrix;
- crash/reboot/sleep/wake/device-loss testing;
- relevant Driver Verifier/HLK review;
- no embedded production secrets/signing keys;
- installer failure must not leave a partially active routing path.
