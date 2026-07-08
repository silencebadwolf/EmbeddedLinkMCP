## Why

The New Connection dialog exposes "RTT Log" as a manual session type, but it requires a raw `probeId`. That value is an internal LinkTerm J-Link handle produced after backend activation, so a human cannot reliably know it or create an RTT log from the App without first using AI/MCP tools.

This breaks the intended App/MCP symmetry: profile/root RTT log opening works for automation, but the manual App path still depends on an internal handle.

## What Changes

- Add a workspace-root input and browse action to the manual RTT Log form in the New Connection dialog.
- When a workspace root is provided, call `rttLog.open({ root, channelIndex, label })` so the existing profile/root RTT preparation path owns J-Link/GDB/RTT setup.
- Keep probe-id based opening as an advanced fallback for reusing an already connected backend handle.
- Allow RTT Log profiles to be saved and reopened from the same saved-connection list as serial/SSH/local-shell profiles.
- Require saved RTT Log profiles to use a stable workspace root; probe handles remain a direct-open fallback only because they are runtime handles.
- Route saved RTT Log opens through the RTT-specific root/probe preparation path, never through generic `session.create`.
- Make RTT Log terminal input writable through the existing `session.write` / `write_to_session` queue by forwarding bytes to the J-Link RTT down-channel.
- Make RTT writes capability-backed and visible: writes MUST only report success when the backend exposes a matching RTT down-channel, and UI/MCP failures MUST be surfaced in the same RTT transcript instead of being silently ignored.
- Normalize human Enter for RTT terminals to the same command-line line ending used by MCP terminal helpers, so manual RTT interaction behaves like serial terminal interaction.
- Allow MCP UI patches to prefill the RTT Log connection form so App and MCP setup share the same visible path.
- Update validation and tests so a manual RTT log can be created, saved, reopened, and typed into with a workspace root and no probe id.

## Impact

- Affected code areas:
  - `src/renderer/components/ConnectionDialog.tsx`
  - renderer i18n strings
  - renderer connection dialog tests
- Behavior impact:
  - Users can create an RTT log tab manually from a workspace control profile.
  - Users can save and reopen RTT log targets without re-entering the workspace path every time.
  - Saved RTT profiles cannot silently persist a transient internal probe handle.
  - Human and AI terminal writes share the same transcript/write queue for RTT sessions.
  - Existing probe-id based RTT creation continues to work.
  - No flash, reset, halt, or firmware changes are introduced.
