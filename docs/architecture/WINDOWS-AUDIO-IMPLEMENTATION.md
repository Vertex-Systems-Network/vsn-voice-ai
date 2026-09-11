# Windows Audio Implementation Contract

**Module:** MOD-002 — Desktop Audio Core & Virtual Devices  
**Work unit:** WU-002  
**Status:** implementation in progress

## Objective

Provide a low-latency Windows audio path that captures a selected physical microphone, runs VSN realtime processing, and exposes processed or safely bypassed audio to calling applications through an OS-visible VSN virtual microphone.

The verified implementation currently reaches a WDK-buildable KMDF control driver, a race-safe kernel/user shared-ring consumer, compile-verified PortCls/WaveRT capture/topology descriptors, fail-closed PortCls adapter lifecycle linkage, a bounded WaveRT stream state/position contract and a WDK-verified fail-closed raw WDM control-device scaffold. The earlier WDF control-device experiment has been removed from the current driver tree because Microsoft KMDF miniport restrictions make framework control-device objects invalid for the intended live PortCls architecture. No installed OS-visible microphone endpoint is claimed yet.

## Platform APIs

The critical Windows realtime path uses native Windows audio/device APIs:

- MMDevice API / `IMMDeviceEnumerator` for endpoint discovery and default endpoint resolution;
- `IMMNotificationClient` for endpoint lifecycle notifications;
- WASAPI and `IAudioClient3` for capture stream setup and period planning;
- `IAudioCaptureClient` for capture packets;
- event-driven buffering for normal realtime capture;
- WDF/KMDF for the current verified control/shared-memory implementation and future miniport helper objects where permitted;
- PortCls/WaveRT and Kernel Streaming descriptors for the virtual microphone endpoint contract;
- `PcInitializeAdapterDriver`, `PcAddAdapterDevice` and `PcDispatchIrp` for the PortCls adapter lifecycle and selective IRP forwarding;
- `IoCreateDeviceSecure` plus raw WDM IRP dispatch for the same-driver secure control device;
- planned PortCls wave/topology miniports and `IMiniportWaveRT` capture stream for the OS-visible endpoint.

Microsoft architectural references include WASAPI/Core Audio, WDF miniport restrictions, PortCls DDI guidance, WaveRT, SysVAD and the Simple Audio Sample. The production VSN driver must use only the minimum required endpoint/transport surface rather than shipping an unchanged sample implementation.

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

The security-critical v2 control change is that **CONNECT no longer accepts a caller-provided section handle**. The request carries validated transport-protocol geometry/session metadata. The driver creates the section itself and returns a user handle only after successful initialization.

The original user-supplied-handle assumption was removed before KMDF implementation. Secure control-v2 verification passed AI Native run `34537871677` and Windows run `34537871806`, then merged to `main` as `3953069f468c46d744f30625b3696e5b12f03a77`.

## KMDF control-driver boundary

`native/windows-virtual-mic/driver/vsn_virtual_mic_control.cpp` implements the current live WDK control plane.

Build contract:

- x64 KMDF Desktop driver;
- minimum KMDF 1.21;
- pinned Microsoft WDK/SDK NuGet `10.0.28000.2526`;
- `/W4` and project warnings-as-errors retained;
- WDK post-build API validation remains enabled;
- Desktop target classification is intentional because this product is a Windows desktop calling application and the current section-mapping path uses desktop-driver DDIs.

Development device security:

- current device interface is restricted to LocalSystem and built-in Administrators;
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

The current `DriverEntry` remains a normal KMDF PnP control-driver entry point. Its secure behavior is implementation evidence that must be preserved when the control surface is ported to the raw-WDM PortCls architecture.

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

## PortCls/WaveRT descriptor scaffold

`native/windows-virtual-mic/driver/vsn_virtual_mic_wavert_scaffold.cpp` and `vsn_virtual_mic_wavert_contract.h` define the first build-verified endpoint descriptor boundary.

Initial capture contract:

- sample rate: `48,000 Hz`;
- channels: `1`;
- sample width: `32-bit`;
- subtype: `KSDATAFORMAT_SUBTYPE_IEEE_FLOAT`;
- block align: `4` bytes;
- average byte rate: `192,000` bytes/second;
- maximum capture streams: `1`.

The endpoint format intentionally matches the shared F32 ring so this stage does not hide a format conversion inside the miniport. Any later Windows mix-format expansion must be explicit and benchmarked.

The compile-verified wave-filter descriptor contains:

- a topology bridge pin with `KSPIN_DATAFLOW_IN`;
- one host capture pin with `KSPIN_DATAFLOW_OUT` / `KSPIN_COMMUNICATION_SINK`;
- one `KSNODETYPE_ADC` node;
- bridge → ADC → capture-pin connections.

The minimal topology descriptor contains:

- one `KSNODETYPE_MICROPHONE` source pin;
- one audio bridge pin;
- a direct source-to-bridge connection;
- no volume/mute/jack property claims yet.

The WDK target links `portcls.lib`, `stdunk.lib`, `libcntpr.lib` and `wdmsec.lib`, defines `PC_IMPLEMENTATION`, compiles the KS/PortCls descriptors and raw WDM control scaffold into `vsn_virtual_mic_control.sys`, and preserves WDK post-build validation. `wavert_contract_test.cpp` independently locks the initial format and descriptor indices.

## Fail-closed PortCls lifecycle boundary

`native/windows-virtual-mic/driver/vsn_virtual_mic_portcls_lifecycle.cpp` references the real PortCls adapter APIs in the WDK target:

- `VsnPortClsInitializeAdapterScaffold` calls `PcInitializeAdapterDriver`;
- `VsnPortClsAddDeviceScaffold` calls `PcAddAdapterDevice` with room for exactly two subdevices (wave + topology);
- the associated `StartDevice` callback validates its inputs and deliberately returns `STATUS_NOT_SUPPORTED`.

This is a compile/link proof, not live registration. `VsnPortClsInitializeAdapterScaffold` is intentionally **not** the current `DriverEntry`.

## Control-plane architecture correction and raw WDM scaffold

A WDF control-device scaffold was added and CI verified in merge `f084e4be4d7930830ca68948699c26e42fc036c1`. It proved that the desired naming, SDDL and fail-closed semantics compiled, but Microsoft KMDF miniport guidance later established that framework control-device objects are not valid in the intended `WdfDriverInitNoDispatchOverride` PortCls miniport architecture. The subsequent secure migration experiment in PR #18 was closed without merge, and the unsupported WDF control-device source has now been removed from the current driver tree.

The corrected same-driver control-plane design is raw WDM. `native/windows-virtual-mic/driver/vsn_virtual_mic_wdm_control_scaffold.cpp` now provides a WDK-verified fail-closed boundary:

- `IoCreateDeviceSecure` creates `\\Device\\VsnVirtualMicControl`;
- security class GUID is `{A47B0129-C8DA-4A5E-B8C4-6D8E20AC37F2}` and is used only for this VSN control device;
- development SDDL remains `D:P(A;;GA;;;SY)(A;;GA;;;BA)` for LocalSystem and built-in Administrators;
- `FILE_DEVICE_SECURE_OPEN` is set and the device uses `DO_BUFFERED_IO`;
- `\\DosDevices\\VsnVirtualMicControl` is created only after the secure device object succeeds;
- global publication happens only after both device object and symbolic link exist;
- teardown deletes the symbolic link before the device object and clears global identity state;
- CREATE/CLOSE/CLEANUP and DEVICE_CONTROL wrappers use real `DRIVER_DISPATCH` signatures;
- wrappers handle requests only for the exact VSN control `PDEVICE_OBJECT`;
- any request targeting a PortCls-created non-control device is forwarded to `PcDispatchIrp`;
- CREATE and DEVICE_CONTROL on the control object return `STATUS_DEVICE_NOT_READY`, so no CONNECT ABI is accidentally exposed.

These functions are deliberately not installed into live `DriverEntry` yet. This slice proves secure device construction, bounded teardown, dispatch typing, exact-device multiplexing and PortCls forwarding only.

The next security port must preserve the existing control invariants while converting from WDF request semantics to WDM IRP semantics:

1. require user-mode requestor semantics equivalent to the current implementation;
2. enforce `FILE_READ_ACCESS | FILE_WRITE_ACCESS` for CONNECT/DISCONNECT/QUERY_STATUS, including dynamic access validation as appropriate;
3. use METHOD_BUFFERED `Irp->AssociatedIrp.SystemBuffer` and exact `InputBufferLength` / `OutputBufferLength` checks;
4. copy CONNECT input before writing the shared system buffer response;
5. use `IoGetRequestorProcessId` and the exact current-stack `PFILE_OBJECT` for ownership fencing;
6. retain session-generation fencing;
7. preserve driver-created section creation in requestor process context, independent section-object reference, system-space mapping and immutable validated protocol geometry;
8. release the connection on owning `IRP_MJ_CLEANUP` and on bounded control-device teardown.

## WaveRT stream state / position contract

`vsn_virtual_mic_wavert_stream_contract.h` defines a bounded, platform-neutral runtime contract for the upcoming capture stream. `vsn_virtual_mic_wavert_stream_contract.cpp` compiles that contract inside the WDK target and statically verifies the state values against `KSSTATE_STOP`, `KSSTATE_ACQUIRE`, `KSSTATE_PAUSE` and `KSSTATE_RUN`.

The contract provides:

- adjacent `STOP ↔ ACQUIRE ↔ PAUSE ↔ RUN` transitions only, while allowing an idempotent same-state request;
- aligned non-zero DMA-buffer geometry and aligned notification interval validation;
- position advancement only while RUN;
- cyclic byte position modulo the allocated WaveRT buffer;
- monotonic linear byte position;
- notification-byte accumulation and total due-notification accounting;
- STOP reset of cyclic/linear positions and notification counters;
- transactional overflow rejection so failed advances do not partially mutate position or notification state.

The current reference test uses a `7,680` byte cyclic buffer, `4` byte block alignment and `1,920` byte notification interval, matching one 10 ms 48 kHz mono F32 frame per notification. This is a stream-state contract only: there is still no concrete `IMiniportWaveRTStream` object or audio-engine timer/DPC path.

## Current CI evidence

Latest merged implementation head: `dbc33d15e7bcc7c0e540c96839ea501883838e54`.

Verified green runs:

- AI Native Quality Gates: `34545966880`;
- Windows Audio Validation: `34545966842`.

The Windows run verifies the merged boundary through:

- pinned Rust toolchain install;
- `vsn-windows-audio` compile;
- Clippy with warnings denied;
- Windows Rust tests including protocol-v2 stamp semantics;
- pinned WDK/SDK package restore;
- `vsn_virtual_mic_control.sys` build with guarded ring consumer, PortCls descriptors/lifecycle linkage, WaveRT stream-state probe and raw WDM `IoCreateDeviceSecure` / `PcDispatchIrp` scaffold linked in;
- WDK post-build validation;
- native C++ protocol/cursor/layout/shared-section/device-control/ring-consumer/WaveRT-descriptor/WaveRT-stream compile/run regression tests.

The raw WDM control-device scaffold merged to main as `e31e40c0a78dcdf99396ea8a0bf3648691416b35`. The architecture correction preceding it merged as `2665954315b52d01b3e59b6fb283f0da2a053eed`. The WDF control-device experiment remains historical evidence only; its source is no longer in the current tree and PR #18 remains closed unmerged.

## What this evidence proves

The repository now has code-level and hosted-Windows-CI evidence for:

- event-driven WASAPI capture foundation;
- device lifecycle/recovery state machines;
- user-mode virtual-mic staging and safe-bypass routing;
- Rust/C++ transport protocol v2 ABI;
- shared cursor synchronization and guarded slot layout;
- real Windows shared-memory behavior/security tests;
- secure driver-owned CONNECT-v2 control contract in the current KMDF implementation;
- WDK-buildable current KMDF control driver;
- kernel-created shared-section lifecycle with retained object reference/system-space mapping;
- access-restricted current control interface and bounded ownership/cleanup logic;
- exact overrun accounting and fresh-silence underrun behavior at the shared-ring consumer boundary;
- before/after slot-stamp validation that rejects concurrent slot reuse/torn PCM;
- successful compilation/linkage of that same consumer helper in the real WDK driver target;
- build-valid PortCls/KS wave and topology descriptors for the initial 48 kHz mono IEEE-float capture contract;
- successful WDK linkage against `PcInitializeAdapterDriver` / `PcAddAdapterDevice` through a fail-closed lifecycle scaffold;
- WDK-locked WaveRT state values plus bounded cyclic/linear position and notification accounting contracts;
- secure raw-WDM named-control-device creation and teardown primitives compiled through `IoCreateDeviceSecure` / `wdmsec.lib`;
- exact control-device dispatch discrimination and PortCls forwarding with real `DRIVER_DISPATCH` signatures;
- fail-closed raw control behavior while the security-sensitive CONNECT runtime remains intentionally absent.

## What is still not proven

This evidence does **not** yet prove:

- WDM IRP/PFILE_OBJECT equivalents of the current requestor PID/file/session fencing and cleanup semantics;
- raw-WDM CONNECT/DISCONNECT/QUERY_STATUS using the verified driver-owned section lifecycle;
- a PortCls-primary live `DriverEntry` with the raw WDM dispatch wrappers installed;
- live PortCls adapter initialization or wave/topology miniport registration;
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

1. port the verified CONNECT/DISCONNECT/QUERY_STATUS request parsing and status responses into raw WDM handlers using METHOD_BUFFERED `SystemBuffer` with exact size checks;
2. enforce user-mode and read/write access requirements before any control operation;
3. move requestor ownership to `IoGetRequestorProcessId` + exact `PFILE_OBJECT` + session generation;
4. preserve the driver-created shared-section lifecycle, immutable validated protocol geometry, cursor initialization/status snapshots and bounded cleanup/error paths;
5. implement owning-file `IRP_MJ_CLEANUP` teardown and control-device teardown under a PASSIVE-safe synchronization primitive;
6. keep these secure WDM handlers disconnected from live `DriverEntry` until WDK/CI verification is green;
7. only then switch live `DriverEntry` to WDF miniport/no-dispatch-override assistance plus `PcInitializeAdapterDriver`, create the raw WDM control DO, install its dispatch wrappers, and keep PortCls `StartDevice` fail-closed;
8. then implement/register the minimal wave/topology miniports and concrete `IMiniportWaveRT` capture stream, binding stream-copy scheduling to `ConsumeOneRingFrame` and the verified position/notification contract;
9. then add an INF/test package and controlled Windows-machine install/enumeration/runtime handshake evidence;
10. only after endpoint enumeration and real audio flow should calling-app compatibility testing begin.

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