# Windows Audio Implementation Contract

**Module:** MOD-002 — Desktop Audio Core & Virtual Devices  
**Work unit:** WU-002  
**Status:** implementation in progress

## Objective

Provide a low-latency Windows audio path that captures a selected physical microphone, runs VSN realtime processing, and exposes processed or safely bypassed audio to calling applications through an OS-visible VSN virtual microphone.

The verified implementation currently reaches a WDK-buildable KMDF control-driver plus a race-safe kernel/user shared-ring consumer boundary. It does **not** yet provide the final WaveRT/PortCls audio miniport or an installed OS-visible microphone endpoint.

## Platform APIs

The critical Windows realtime path uses native Windows audio/device APIs:

- MMDevice API / `IMMDeviceEnumerator` for endpoint discovery and default endpoint resolution;
- `IMMNotificationClient` for endpoint lifecycle notifications;
- WASAPI and `IAudioClient3` for capture stream setup and period planning;
- `IAudioCaptureClient` for capture packets;
- event-driven buffering for normal realtime capture;
- WDF/KMDF for the current virtual-mic control/shared-memory boundary;
- planned PortCls/WaveRT miniport architecture for the OS-visible virtual microphone endpoint.

Microsoft architectural references include WASAPI/Core Audio, WDF, WaveRT, SysVAD and the Simple Audio Sample. The production VSN driver must use only the minimum required endpoint/transport surface rather than shipping an unchanged sample implementation.

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
    -> verified protocol-v2 shared region / KMDF control plane
    -> guarded kernel ring consumer
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

## Shared protocol v2 and ring contract

Rust and C++ share a versioned wire contract. Protocol version 2 adds one aligned 64-bit seqlock-style stamp per PCM ring slot so a consumer can prove a slot was not concurrently reused while its PCM bytes were copied.

`VirtualMicProtocolHeader` / `ProtocolHeader`, `VirtualMicCursorSnapshot` / `CursorSnapshot`, and `VirtualMicFrameSlotStamp` / `FrameSlotStamp` provide:

- stable C-compatible layout;
- protocol magic/version/header-size validation;
- non-zero session generation;
- fixed sample rate/channel/sample format/frame duration/ring capacity/samples-per-frame geometry;
- monotonic producer and consumer sequences;
- deterministic cyclic-ring slot planning;
- bounded overrun normalization by discarding the oldest logical window;
- an 8-byte slot stamp encoding stable/writing state plus logical frame sequence;
- a bounded frame-sequence range compatible with that encoding.

Producer publication order is:

1. publish the target slot's `writing` stamp;
2. write the complete PCM frame;
3. publish the target slot's stable sequence stamp;
4. publish the global producer cursor.

The consumer validates the exact stable stamp both before and after PCM copy. If the producer begins reusing that physical slot during the copy, the consumer rejects the frame instead of exposing torn PCM.

The C++ ABI is MSVC x64 verified with exact structure sizes/alignment/offsets locked by `static_assert`, and the Rust mirror has matching version/stamp semantics.

## Cursor synchronization and shared-region layout

`vsn_virtual_mic_cursor_sync.h`, `vsn_virtual_mic_slot_sync.h` and `vsn_virtual_mic_region_layout.h` provide the shared-memory synchronization contract.

- aligned 64-bit cursor and slot-stamp operations use Windows interlocked primitives;
- stable cursor reads are bounded;
- stale generations, cursor regressions and unencodable frame sequences are rejected;
- exact multi-frame overrun drops can be accounted atomically;
- session reset uses generation `0` only after producer/consumer quiescence;
- region geometry is 64-byte aligned and overflow checked.

Reference layout for 48 kHz mono F32, 10 ms frames, ring capacity 4:

- header: offset `0`, 40 bytes;
- cursor block: offset `64`, 40 bytes;
- slot-stamp array: offset `128`, 4 × 8 bytes = 32 bytes;
- audio: offset `192`;
- frame: `1,920` bytes;
- ring: `7,680` bytes;
- total: `7,872` bytes.

## User-mode shared-section implementation

`vsn_virtual_mic_shared_section.h` provides a CI-verified user-mode shared mapping used by transport/security tests:

- `CreateFileMappingW(INVALID_HANDLE_VALUE, ...)` + `MapViewOfFile`;
- unnamed mapping;
- validated layout-derived size;
- configurable 16 MiB default maximum;
- non-inheritable handle;
- protected DACL restricted to LocalSystem plus the current authenticated process user;
- initialized protocol/cursors/slot-stamp storage;
- second-view propagation checks for protocol/audio/cursors/slot stamps;
- explicit handle/DACL inspection in Windows CI.

This user-mode helper is test evidence for the shared-region contract. The secure installed-driver connection path is the driver-owned handshake described below.

## Device-control ABI v2

`vsn_virtual_mic_device_control.h` defines the current kernel/user control contract.

IOCTLs:

- `CONNECT`;
- `DISCONNECT`;
- `QUERY_STATUS`.

All use `METHOD_BUFFERED` and require `FILE_READ_ACCESS | FILE_WRITE_ACCESS`.

The security-critical v2 control change is that **CONNECT no longer accepts a caller-provided section handle**. The request carries validated transport-protocol geometry/session metadata. The driver creates the section itself and returns a user handle only after successful initialization.

The original user-supplied-handle assumption was removed before KMDF implementation. Secure control-v2 verification passed AI Native run `34537871677` and Windows run `34537871806`, then merged to `main` as `3953069f468c46d744f30625b3696e5b12f03a77`.

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
7. zero/initialize protocol header, generation-fenced cursor block and v2 slot-stamp storage;
8. store immutable authoritative protocol geometry in device context;
9. retain requestor PID + owning file object;
10. return the user section handle and ready response only after successful initialization.

The kernel does not rely on user-written mapped header bytes as authoritative configuration after CONNECT; driver context holds the validated geometry.

QUERY_STATUS reads a stable cursor snapshot through the retained system-space mapping. DISCONNECT and cleanup release the system-space view and section-object reference. File cleanup handles owner-close teardown; device cleanup also performs bounded teardown. The WDF wait-lock lifetime is driver-parented so it remains valid through device cleanup.

## Guarded kernel/user ring-consumer boundary

`vsn_virtual_mic_ring_consumer.h` is shared between user-mode contract tests and the WDK build. `native/windows-virtual-mic/driver/vsn_virtual_mic_ring_contract.cpp` compiles and links the exact consumer through the real KMDF/WDK translation environment.

`ConsumeOneRingFrame`:

- accepts the immutable CONNECT-time `ProtocolHeader` retained by the driver rather than trusting mutable mapped header bytes;
- verifies expected session generation, mapped-region size and exact output-frame size;
- reads a bounded stable cursor snapshot;
- normalizes overruns to the oldest retained logical frame and records the exact number of dropped frames;
- on underrun, emits a freshly zeroed frame, increments underrun accounting and leaves the consumer cursor unchanged;
- before copy, requires the target slot stamp to equal the expected stable logical sequence;
- copies one bounded PCM frame;
- performs a read barrier and rechecks the exact same stable stamp;
- if the stamp changed or indicates a concurrent/future write, zeros the output, returns `kSlotUnstable`, and does not advance the consumer cursor;
- publishes the next consumer sequence only after a stable copy;
- contains no sleep/retry loop.

The Windows regression suite includes a deliberate slot-reuse race that begins writing a future logical frame into the physical slot still targeted by the consumer before the future global producer cursor is published. Protocol v2 rejects that slot and prevents partial PCM exposure.

## Current CI evidence

Latest implementation head: `7948c1dc31a05fc5688d9d2b7f0da8d00605037d`.

Verified green runs:

- AI Native Quality Gates: `34541120876`;
- Windows Audio Validation: `34541120903`.

The Windows run verifies, in order:

- pinned Rust toolchain install;
- `vsn-windows-audio` compile;
- Clippy with warnings denied;
- Windows Rust tests including protocol-v2 stamp semantics;
- pinned WDK/SDK package restore;
- KMDF `vsn_virtual_mic_control.sys` build with the ring-consumer compile probe linked in;
- WDK post-build validation;
- native C++ protocol/cursor/layout/shared-section/device-control/ring-consumer compile/run regression tests, including the deliberate concurrent-slot-reuse case.

The guarded ring-consumer implementation merged to main as `9c57207482bdc20ca5dc70a06cbb43c0cfa86741`.

## What this evidence proves

The repository now has code-level and hosted-Windows-CI evidence for:

- event-driven WASAPI capture foundation;
- device lifecycle/recovery state machines;
- user-mode virtual-mic staging and safe-bypass routing;
- Rust/C++ transport protocol v2 ABI;
- shared cursor synchronization and guarded slot layout;
- real Windows shared-memory behavior/security tests;
- secure driver-owned CONNECT-v2 control contract;
- WDK-buildable KMDF control driver;
- kernel-created shared-section lifecycle with retained object reference/system-space mapping;
- access-restricted control interface and bounded ownership/cleanup logic;
- exact overrun accounting and fresh-silence underrun behavior at the shared-ring consumer boundary;
- before/after slot-stamp validation that rejects concurrent slot reuse/torn PCM;
- successful compilation/linkage of that same consumer helper in the real WDK driver target.

## What is still not proven

This evidence does **not** yet prove:

- a WaveRT/PortCls audio miniport/topology;
- an OS-visible VSN microphone endpoint;
- audio-engine scheduling that invokes the guarded consumer;
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

1. establish the minimal WDK PortCls/WaveRT virtual-microphone capture endpoint/topology scaffold;
2. define the initial 48 kHz mono capture data-range/format contract and single capture-stream boundary;
3. bind the WaveRT stream-copy/scheduling boundary to the verified guarded ring consumer while preserving immutable CONNECT-time geometry;
4. add position/notification state with bounded underrun behavior and compile/static contract checks in hosted Windows CI;
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
