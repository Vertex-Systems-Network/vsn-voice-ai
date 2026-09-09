# Windows Audio Implementation Contract

**Module:** MOD-002 — Desktop Audio Core & Virtual Devices  
**Work unit:** WU-002  
**Status:** implementation in progress

## Objective

Provide a low-latency Windows audio path that captures a selected physical microphone, runs VSN realtime processing, and exposes the processed stream to calling applications through a VSN virtual microphone without making optional AI processing a single point of failure.

## Platform APIs

The Windows implementation will use the native Windows Core Audio stack rather than a generic high-level audio wrapper for the critical realtime path.

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

Kernel/user-mode transport, driver packaging and endpoint topology will be documented separately before driver code is treated as release-capable.

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

### CI-verifiable now

- platform-neutral device selection and lifecycle state tests;
- bounded frame queue behavior;
- safe-bypass behavior;
- format validation;
- Rust formatting, Clippy and unit tests.

### Windows runner / hardware verification

- endpoint enumeration;
- communications-default tracking;
- event-driven WASAPI capture;
- `IAudioClient3` period negotiation/fallback;
- invalidated-device recovery;
- hotplug/default-device changes;
- CPU usage and callback deadline misses;
- capture discontinuity detection;
- end-to-end latency measurement.

### Driver/test-machine verification

- virtual endpoint appears as a microphone to target calling applications;
- processed and bypass audio both reach the endpoint;
- install/update/uninstall/rollback;
- sleep/wake and reboot persistence;
- device-loss recovery;
- no permanent silence after optional processing failure.

## Current implementation boundary

As of the start of WU-002, the repository has the platform-neutral frame/pipeline/queue core and device-selection catalog. This is not yet evidence that Windows WASAPI capture or the virtual microphone driver works. Those claims require Windows-specific implementation and verification evidence.
