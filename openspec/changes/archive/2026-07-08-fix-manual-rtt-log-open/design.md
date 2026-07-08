## Design

### Manual RTT Target Selection

The New Connection dialog will treat a workspace root as the normal manual RTT log target. The form sends `root` to `window.linkterm.rttLog.open`; the existing IPC handler already supports root/profile opening through `prepareProfileRttLogTarget`.

The `probeId` field remains available as an advanced/manual-handle fallback. If both root and probe id are present, root wins because it is the stable user-facing identifier and ensures the App path uses the same managed GDB/RTT setup as MCP.

### Saved Profiles

RTT Log becomes a saved connection profile type with non-sensitive fields only:

- `root` for the normal workspace-profile path. This is required for saved profiles.
- `channelIndex`, `pollIntervalMs`, and `maxBytesPerRead`.

Probe handles remain available only for direct manual opens that reuse an already-connected backend handle. They SHALL NOT be persisted as saved RTT profiles, because they are runtime handles and would create a misleading saved connection that may not reopen after restart.

Saved RTT opens must call the same RTT open helper as the manual App path and MCP `open_rtt_log_session`, because generic `session.create` cannot prepare J-Link/GDB/RTT state.

### Session Metadata

The renderer should add the returned `probeId` and `channelIndex` to the App store. For profile/root opens, these values come from IPC after backend preparation. If IPC omits them unexpectedly, the renderer falls back to the requested values for compatibility with older mocks/backends.

Saved RTT open/save responses should also return RTT metadata so the renderer can hydrate the visible tab exactly like a direct `rttLog.open` response.

### RTT Terminal Input

RTT Log sessions should be writable only when the backend exposes an RTT down-channel. The UI and MCP should not add a separate RTT-specific write API; they should use the existing `session.write` / `write_to_session` path so human and AI input remains ordered by the shared WriteQueue and visible in transcript audit events.

The J-Link backend will add `rttWrite(probeId, channelIndex, data)` and the socket-backed RTT telnet session will write bytes to the existing SEGGER RTT telnet socket. This keeps RTT socket details inside the backend.

`rttConnect` channel metadata is the capability boundary. The socket-backed SEGGER RTT Telnet session reports both the readable up channel and the writable down channel for channel 0. `rttRead` accepts only matching up-channel metadata; `rttWrite` accepts only matching down-channel metadata. If a backend cannot prove a down channel exists, `rttWrite` throws a stable invalid-state error and the RTT session records a non-fatal writer error in its transcript instead of adding a misleading human/AI audit data event.

Renderer IPC calls return a structured `PreloadResult`, not rejected promises for normal failures. `TerminalView` must inspect that result; on `{success:false}`, it appends a local visible error line to the current xterm so humans immediately see the failure. The main process still records backend writer failures in the transcript when the write reached the session layer.

Manual RTT input uses terminal command-line line endings. For RTT log tabs, a bare xterm Enter byte (`\r`) is normalized to `\r\n` before `session.write`, matching the default MCP `send_and_wait` line ending and the existing serial-terminal expectation. Other bytes, including Ctrl-C, pass through unchanged.

### Validation

The RTT direct-open form requires either a workspace root or a probe id, plus a non-negative integer channel. The error text should name both accepted target inputs so the user is not forced toward internal probe handles.

The RTT saved-profile path requires a workspace root and rejects probe-id-only submissions before calling `connections.saveAndOpen`. Core saved-profile schemas also require `root` for `type="rtt-log"` so non-UI callers cannot persist transient probe handles.

### MCP UI Prefill

`ui_configure` may set `type="rtt-log"` and prefill non-sensitive RTT fields (`rttRoot`, `rttProbeId`, `rttChannel`). The renderer consumes those fields through the same ConnectionDialog form state used by manual entry.

### Non-Goals

- No changes to J-Link backend probing, flash, reset, halt, or RTT transport internals.
- No separate renderer-only RTT write channel; all writes continue through the existing session write contract.
