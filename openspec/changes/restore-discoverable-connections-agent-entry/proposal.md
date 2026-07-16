# Proposal: Restore discoverable saved connections and MCP entry

## Why

The Start Center currently hides global saved connection summaries inside the generic connection dialog, while MCP/Agent integration is only named as “Agent” inside a collapsed advanced section. Existing data remains in `%APPDATA%\\linkterm-v2\\connections.json`, but users cannot discover it from the first screen.

## What changes

- Show a bounded list of saved connection summaries in the Start Center serial-device area.
- Open a selected summary through the existing preload `connections.open` and App session-store boundary.
- Clarify the advanced disclosure as containing MCP / Agent injection and control profiles.
- Keep all persistence, transport, SessionManager, WriteQueue, MCP execution, and hardware boundaries unchanged.

## Non-goals

- No data migration, deletion, or storage-path change.
- No new hardware operation, approval, pause, takeover, telemetry, cloud service, or database.
