# restore-discoverable-connections-agent-entry

## Scope

Restore discoverability for existing global connection profiles while reducing the Start Center to one manual connection entry. Serial, RTT, SSH, and local-shell choices are shown only after that entry opens the existing connection dialog.

## Non-goals

- No connection schema or storage-path migration.
- No serial candidate list or independent manual-serial card on Start Center.
- No changes to serial transport, SessionManager, WriteQueue, MCP injection behavior, or hardware operations.
- No new approval, pause, takeover, telemetry, cloud service, or database behavior.

## Acceptance criteria

- Start Center shows saved global connections first when they exist.
- Start Center has one secondary `Manual open` entry; it opens the existing connection dialog where all connection types are selected.
- A saved connection can be opened with one explicit action through the existing `connections.open` IPC path.
- Start Center does not render the current COM list or a separate manual-serial form.
- Existing saved profiles remain in `%APPDATA%\\linkterm-v2\\connections.json` and are not copied or deleted.
- Advanced-device disclosure names MCP/Agent injection and control-profile configuration explicitly.
- English and Chinese labels remain semantically equivalent.
- Empty Start Center still hides the control-profile sidebar and does not create a session until the user chooses an action.

## Test strategy

- Add failing renderer tests for saved-profile rendering/open callback and explicit MCP/Agent copy.
- Run focused renderer tests, then lint, TypeScript, build, full test suite, license validation, OpenSpec strict validation, and GitNexus detect_changes.
