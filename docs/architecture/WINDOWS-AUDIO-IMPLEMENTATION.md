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

The repository also contains a CI-verified, versioned driver-facing metadata/ring contract in `virtual_mic_protocol`:

- `VirtualMicProtocolHeader` and `VirtualMicCursorSnapshot` use `#[repr(C)]` so their field layout is intentionally compatible with a future native C/C++ binding boundary;
- the header carries a protocol magic/version, header size, non-zero session generation, sample rate, channels, sample format, frame duration, ring capacity and samples per frame;
- protocol validation rejects incompatible magic/version/header size, invalid audio geometry, unsupported sample format, stale session generation and non-zero reserved fields;
- producer and consumer sequences are monotonic within a session generation;
- `plan_ring_window` maps those sequences to deterministic cyclic-buffer slots;
- if producer distance exceeds ring capacity, the plan advances the logical consumer boundary and discards the oldest frames rather than allowing unbounded latency.

This contract defines the intended handoff semantics only. It does **not** implement or prove shared-memory atomics, memory ordering, synchronization primitives, IOCTL/device interfaces, security descriptors/ACLs, section mapping, IRQL/DPC behavior, WaveRT position registers, kernel buffering, endpoint topology or an installed Windows audio driver. Those details must be implemented and verified in the actual C++/WDK driver boundary.

The staging/output boundary plus this protocol contract do not create an OS-visible microphone or calling-application route.

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
- Ubuntu repository-integrity checks plus Windows-native compile, Clippy and unit/smoke tests.

The latest exact implementation head for this boundary is `aa0792b81746a11d99b3b3451c3086e363714ee8`, which passed Ubuntu repository-integrity run `34525486454` and Windows Audio Validation run `34525486333`. The preceding staging/output bridge boundary passed Ubuntu run `34522943083` and Windows run `34522943093`.

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

- C++/WDK transport binding implements the protocol with correct synchronization and security boundaries;
- virtual endpoint appears as a microphone to target calling applications;
- processed and bypass audio both reach the endpoint through the actual driver transport;
- Zoom/Teams/Meet/dialer/browser compatibility;
- install/update/uninstall/rollback;
- sleep/wake and reboot persistence;
- device-loss recovery;
- no permanent silence after optional processing failure.

## Current implementation boundary

WU-002 has code-level and hosted-CI evidence for the Windows event-driven WASAPI capture path, packet decoding/reframing, bounded runtime recovery, MMDevice notification registration and notification-to-recovery bridging. It also has CI evidence for a bounded user-mode virtual-microphone staging/output layer and a versioned C-compatible ring/cursor protocol contract for the planned driver handoff. Hosted Windows CI executes the native compilation/tests and registration/unregistration smoke coverage, while Ubuntu CI verifies the wider repository integrity and platform-neutral logic.

This evidence does **not** yet prove physical-device hotplug/default-device recovery on controlled Windows hardware, an OS-visible production virtual microphone, actual shared kernel/user transport, calling-application compatibility, hardware latency/jitter targets, or signed driver lifecycle behavior. Those remain required before MOD-002 / WU-002 can be treated as complete.
