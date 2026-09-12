# Windows Audio Implementation Contract

**Module:** MOD-002 — Desktop Audio Core & Virtual Devices  
**Work unit:** WU-002  
**Status:** implementation in progress

## Objective

Provide a low-latency Windows audio path that captures a selected physical microphone, runs VSN realtime processing, and exposes processed or safely bypassed audio to calling applications through an OS-visible VSN virtual microphone.

The verified implementation currently reaches a WDK-buildable driver, race-safe kernel/user shared-ring consumer, compile-verified PortCls/WaveRT capture/topology descriptors, fail-closed PortCls adapter lifecycle/stream contracts, a secure raw WDM CONNECT/DISCONNECT/QUERY_STATUS control runtime, and a live PortCls-primary DriverEntry using the supported KMDF-miniport initialization pattern. PortCls `StartDevice` remains deliberately fail-closed until concrete wave/topology miniports exist. No installed OS-visible microphone endpoint is claimed yet.

## Platform APIs

The critical Windows realtime path uses native Windows audio/device APIs:

- MMDevice API / `IMMDeviceEnumerator` for endpoint discovery and default endpoint resolution;
- `IMMNotificationClient` for endpoint lifecycle notifications;
- WASAPI and `IAudioClient3` for capture stream setup and period planning;
- `IAudioCaptureClient` for capture packets;
- event-driven buffering for normal realtime capture;
- WDF/KMDF only as a miniport helper, with `WdfDriverInitNoDispatchOverride`;
- PortCls/WaveRT and Kernel Streaming descriptors for the virtual microphone endpoint contract;
- `PcInitializeAdapterDriver`, `PcAddAdapterDevice` and `PcDispatchIrp` for PortCls adapter lifecycle and selective IRP forwarding;
- `IoCreateDeviceSecure` plus raw WDM IRP dispatch for the same-driver secure control device;
- planned concrete PortCls wave/topology miniports and `IMiniportWaveRT` capture stream for the OS-visible endpoint.

Microsoft KMDF miniport guidance requires `WdfDriverInitNoDispatchOverride` before `WdfDriverCreate`, requires the port driver rather than KMDF to own IRP dispatch, requires `WdfDeviceMiniportCreate` rather than ordinary framework device creation for miniport devices, and disallows framework control-device objects for miniport drivers. Microsoft PortCls guidance states that `PcInitializeAdapterDriver` installs PortCls handlers and that a driver which subsequently overrides selected handlers can call `PcDispatchIrp` for requests that belong to PortCls. The official Windows audio samples use `WDF_NO_EVENT_CALLBACK` + `WdfDriverInitNoDispatchOverride` + `WdfDriverCreate` + `PcInitializeAdapterDriver`, and unload PortCls before `WdfDriverMiniportUnload`.

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
    -> protocol-v2 shared region / secure raw WDM control device
    -> guarded kernel ring consumer
    -> PortCls/WaveRT capture miniport + stream
    -> OS-visible VSN microphone endpoint
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

CONNECT no longer accepts a caller-provided section handle. The request carries validated transport-protocol geometry/session metadata. The driver creates the section itself and returns a user handle only after successful initialization.

## Guarded kernel/user ring-consumer boundary

`vsn_virtual_mic_ring_consumer.h` is shared between user-mode contract tests and the WDK build. `native/windows-virtual-mic/driver/vsn_virtual_mic_ring_contract.cpp` compiles and links the exact consumer through the real WDK translation environment.

`ConsumeOneRingFrame`:

- accepts immutable CONNECT-time protocol geometry rather than trusting mutable mapped header bytes;
- verifies expected session generation, mapped-region size and exact output-frame size;
- reads a bounded stable cursor snapshot;
- normalizes overruns to the oldest retained logical frame and records exact dropped frames;
- on underrun, emits a freshly zeroed frame, increments underrun accounting and leaves the consumer cursor unchanged;
- requires the target slot stamp to equal the expected stable logical sequence before copy;
- copies one bounded PCM frame;
- performs a read barrier and rechecks the same stable stamp;
- zeros output and does not advance the consumer if concurrent slot reuse is detected;
- publishes the next consumer sequence only after a stable copy;
- contains no sleep/retry loop.

## PortCls/WaveRT descriptor scaffold

`native/windows-virtual-mic/driver/vsn_virtual_mic_wavert_scaffold.cpp` and `vsn_virtual_mic_wavert_contract.h` define the build-verified endpoint descriptor boundary.

Initial capture contract:

- sample rate: `48,000 Hz`;
- channels: `1`;
- sample width: `32-bit`;
- subtype: `KSDATAFORMAT_SUBTYPE_IEEE_FLOAT`;
- block align: `4` bytes;
- average byte rate: `192,000` bytes/second;
- maximum capture streams: `1`.

The compile-verified wave-filter descriptor contains a topology bridge pin, one host capture pin, one `KSNODETYPE_ADC` node and bridge → ADC → capture connections. The minimal topology descriptor contains one `KSNODETYPE_MICROPHONE` source pin, one audio bridge pin and a direct source-to-bridge connection. Volume/mute/jack property claims remain intentionally absent.

The WDK target links `portcls.lib`, `stdunk.lib`, `libcntpr.lib` and `wdmsec.lib` and preserves WDK post-build validation.

## PortCls lifecycle and live DriverEntry

`native/windows-virtual-mic/driver/vsn_virtual_mic_portcls_lifecycle.cpp` provides:

- `VsnPortClsInitializeAdapterScaffold` -> `PcInitializeAdapterDriver`;
- `VsnPortClsAddDeviceScaffold` -> `PcAddAdapterDevice` with room for exactly two subdevices (wave + topology);
- a `StartDevice` callback that validates inputs and deliberately returns `STATUS_NOT_SUPPORTED` until actual miniports are implemented.

`native/windows-virtual-mic/driver/vsn_virtual_mic_control.cpp` now owns the live entry sequence verified in PR #25:

1. `WDF_DRIVER_CONFIG_INIT(..., WDF_NO_EVENT_CALLBACK)`;
2. set `WdfDriverInitNoDispatchOverride`;
3. call `WdfDriverCreate`;
4. call `VsnPortClsInitializeAdapterScaffold` / `PcInitializeAdapterDriver`;
5. capture PortCls CREATE/CLOSE/CLEANUP/DEVICE_CONTROL handlers plus PortCls unload;
6. install the VSN raw WDM CREATE/CLOSE/CLEANUP and DEVICE_CONTROL multiplexers;
7. create/publish the secure raw control device only after the final dispatch table is ready;
8. on failure, restore captured PortCls dispatch, invoke PortCls unload when available, then `WdfDriverMiniportUnload`;
9. on normal unload, delete the raw control surface, invoke saved PortCls unload, then `WdfDriverMiniportUnload`.

The first CI attempt for this slice, Windows run `34713657493`, failed correctly because `WdfDriverMiniportUnload` was not declared. Adding the required `<wdfminiport.h>` include fixed that issue. AI Native run `34713869004` and Windows run `34713869035` both passed on implementation head `228a3edef05ef1598dec8f13af282950d2479764`; PR #25 merged as `14fd4c55ae6ad44d1e43af3ea574e66427f7551e`.

This proves live class-driver ownership and control dispatch multiplexing at build/contract-test level only. It does not prove a PortCls endpoint because `StartDevice` remains fail-closed.

## Secure raw WDM control runtime

`native/windows-virtual-mic/driver/vsn_virtual_mic_wdm_control_scaffold.cpp` provides the supported same-driver raw WDM control plane:

- `IoCreateDeviceSecure` creates `\\Device\\VsnVirtualMicControl`;
- security class GUID `{A47B0129-C8DA-4A5E-B8C4-6D8E20AC37F2}` is unique to this VSN control device;
- development SDDL is `D:P(A;;GA;;;SY)(A;;GA;;;BA)` for LocalSystem and built-in Administrators;
- `FILE_DEVICE_SECURE_OPEN` and `DO_BUFFERED_IO` are set;
- `\\DosDevices\\VsnVirtualMicControl` is created only after the secure device object succeeds;
- global publication occurs only after device extension, secure device object and symbolic link are initialized;
- teardown deletes the symbolic link before the device object and releases retained connection resources;
- CREATE/CLOSE/CLEANUP and DEVICE_CONTROL wrappers use real `DRIVER_DISPATCH` signatures;
- wrappers handle only the exact VSN control `PDEVICE_OBJECT` and forward PortCls devices through `PcDispatchIrp`;
- CREATE rejects kernel-mode opens and requires an exact file object;
- IOCTL handling requires `UserMode`, PASSIVE_LEVEL and `IoValidateDeviceIoControlAccess(FILE_READ_ACCESS | FILE_WRITE_ACCESS)`;
- CONNECT/DISCONNECT/QUERY_STATUS use METHOD_BUFFERED `Irp->AssociatedIrp.SystemBuffer` with exact sizing;
- CONNECT copies request input before writing the aliased response buffer;
- ownership is fenced by `IoGetRequestorProcessId`, exact current-stack `PFILE_OBJECT` and session generation;
- CONNECT preserves driver-created requestor-context section creation, independent kernel object reference, system-space mapping, protocol/cursor initialization and immutable validated geometry;
- QUERY_STATUS reads a bounded stable cursor snapshot;
- DISCONNECT, owning `IRP_MJ_CLEANUP`, scaffold deletion and section-creation errors perform bounded teardown;
- mutable connection state is protected by a PASSIVE-safe kernel mutex.

Secure raw WDM runtime evidence: AI Native run `34713202688`, Windows run `34713202712`, implementation head `f7c701eaf7b12c4ce7f6814f64ef9e4c9b04e417`, merged as `6c395ef7cbd7afc5caa3daac506dee16073335fe`.

## WaveRT stream state / position contract

`vsn_virtual_mic_wavert_stream_contract.h` defines a bounded platform-neutral runtime contract for the upcoming capture stream. The WDK translation unit statically verifies state values against `KSSTATE_STOP`, `KSSTATE_ACQUIRE`, `KSSTATE_PAUSE` and `KSSTATE_RUN`.

The contract provides:

- adjacent `STOP ↔ ACQUIRE ↔ PAUSE ↔ RUN` transitions only, with idempotent same-state requests;
- aligned non-zero DMA-buffer geometry and aligned notification interval validation;
- position advancement only while RUN;
- cyclic byte position modulo allocated WaveRT buffer;
- monotonic linear byte position;
- notification-byte accumulation and total due-notification accounting;
- STOP reset of cyclic/linear positions and notification counters;
- transactional overflow rejection so failed advances do not partially mutate position or notification state.

The reference test uses a `7,680` byte cyclic buffer, `4` byte block alignment and `1,920` byte notification interval, matching one 10 ms 48 kHz mono F32 frame per notification. This remains a stream-state contract: there is still no concrete `IMiniportWaveRTStream` object or audio-engine timer/DPC path.

## Current CI evidence

Latest merged implementation head before squash: `228a3edef05ef1598dec8f13af282950d2479764`.

Verified green runs:

- AI Native Quality Gates: `34713869004`;
- Windows Audio Validation: `34713869035`.

The Windows run verifies:

- pinned Rust toolchain install;
- `vsn-windows-audio` compile;
- Clippy with warnings denied;
- Windows Rust tests including protocol-v2 stamp semantics;
- pinned WDK/SDK package restore;
- `vsn_virtual_mic_control.sys` build with live PortCls-primary DriverEntry, guarded ring consumer, PortCls descriptors/lifecycle linkage, WaveRT stream-state probe and secure raw-WDM runtime linked in;
- WDK post-build validation;
- native C++ protocol/cursor/layout/shared-section/device-control/ring-consumer/WaveRT-descriptor/WaveRT-stream contract tests.

PR #25 merged this boundary to `main` as `14fd4c55ae6ad44d1e43af3ea574e66427f7551e`.

## What this evidence proves

The repository now has code-level and hosted-Windows-CI evidence for:

- event-driven WASAPI capture foundation;
- device lifecycle/recovery state machines;
- user-mode virtual-mic staging and safe-bypass routing;
- Rust/C++ transport protocol v2 ABI;
- shared cursor synchronization and guarded slot layout;
- real Windows shared-memory behavior/security tests;
- secure driver-owned CONNECT-v2 control contract;
- WDK-buildable driver target;
- kernel-created shared-section lifecycle with retained object reference/system-space mapping;
- exact overrun accounting and fresh-silence underrun behavior at the shared-ring consumer boundary;
- before/after slot-stamp validation that rejects concurrent slot reuse/torn PCM;
- build-valid PortCls/KS wave and topology descriptors for the initial 48 kHz mono IEEE-float capture contract;
- WDK-locked WaveRT state values plus bounded cyclic/linear position and notification accounting contracts;
- secure raw-WDM named-control-device creation and teardown;
- exact control-device dispatch discrimination and PortCls forwarding;
- raw-WDM UserMode/read-write access enforcement, exact METHOD_BUFFERED parsing, PID/file/generation ownership fencing, driver-owned section lifecycle, stable status snapshots and owner cleanup;
- live KMDF-miniport/PortCls DriverEntry ordering with raw-WDM dispatch multiplexing and bounded failure/unload unwind.

## What is still not proven

This evidence does **not** yet prove:

- actual wave/topology miniport objects and registration during PortCls `StartDevice`;
- an `IMiniportWaveRT` capture-stream implementation;
- audio-engine scheduling that invokes the guarded consumer;
- live WaveRT position/notification delivery;
- an OS-visible VSN microphone endpoint;
- INF/package installation or test signing;
- runtime `DeviceIoControl` against an installed VSN device;
- endpoint enumeration through Windows Core Audio;
- processed/bypass audio reaching Zoom, Teams, Meet, dialers or browsers;
- physical hotplug/default-device recovery on controlled hardware;
- controlled-hardware CPU, callback deadline, latency or jitter targets;
- production signing/install/update/uninstall/rollback behavior.

## Next WU-002 implementation boundary

The next authorized implementation slice remains inside `WU-002`:

1. implement minimal topology and WaveRT capture miniport objects against the verified descriptors;
2. replace the fail-closed `StartDevice` path with bounded registration of exactly those two subdevices, including deterministic rollback on partial registration failure;
3. implement a concrete `IMiniportWaveRT` capture-stream object with the verified 48 kHz mono F32 contract;
4. bind stream-copy scheduling to `ConsumeOneRingFrame` and the verified WaveRT state/position/notification contract without unbounded waits;
5. keep runtime control ownership and generation fencing consistent with the secure raw WDM connection;
6. after that slice is CI green, add an INF/test package and controlled Windows-machine install/enumeration/runtime handshake evidence;
7. only after endpoint enumeration and real audio flow should calling-app compatibility testing begin.

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