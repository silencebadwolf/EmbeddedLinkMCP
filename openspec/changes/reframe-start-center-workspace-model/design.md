# Design: Workspace-first Start Center

## Domain model

The renderer presents three distinct concepts:

1. **System configuration** — MCP injection, Agent integrations, global AI preferences, Activity Center and audit preferences. It is shared by all workspaces and is opened from the application chrome.
2. **Device workspace** — a saved target description containing device identity, serial/J-Link/RTT links, firmware and other device facts. It may be full or serial-only.
3. **Session** — a live runtime instance created from a workspace or from a temporary serial connection. It uses the existing SessionManager, WriteQueue, Transport and terminal focus boundary.

The renderer derives display-safe `WorkspaceSummary` values from existing `SavedControlProfileRecordPayload` and serial `SavedConnectionSummary` values. No new IPC method or persistence schema is introduced.

## Start Center layout

The no-session page renders, in order:

1. `Saved workspaces`: bounded cards with label, type badge, device/link/firmware summary, `Open workspace`, and a secondary `Delete workspace` action. Full control-profile records and serial-only saved connection records use the same card component but remain distinguishable by their type badge.
2. Empty state when there are no cards, without listing current COM ports.
3. `New device workspace`: one entry that opens `ControlProfilePanel`.

The Start Center does not render an advanced-device disclosure, readiness diagnostics, candidate lists, or first-success shortcuts. MCP/Agent integration is not rendered as a workspace field. The existing system-level Agent panel remains reachable from the header.

Deleting a card is confirmed in the renderer and dispatched to the existing source-specific persistence API: `controlProfile.deleteRecord` for full workspaces and `connections.delete` for serial-only workspaces. Success removes only the saved card; it does not destroy or mutate a live session. Failure leaves the card in place and exposes the returned error.

## Creation flow

`ControlProfilePanel` begins with a local chooser:

- `Serial-only connection` closes the chooser and delegates to the existing `ConnectionDialog`. The user can open once or save the connection through the existing saved-connection path.
- `Full device workspace` reveals the existing control-profile form and preserves its current validation and save/open callbacks.

The panel must not implement a second serial picker, baud validator, saved-connection loader, or session creator.

## Compatibility and safety

- Existing control-profile records are displayed as full workspace summaries.
- Existing saved serial connections are displayed as serial-only summaries; non-serial saved connection types remain accessible through ConnectionDialog without being mislabelled as device workspaces.
- Deleting a saved record does not close an already opened session or perform a hardware operation.
- MCP/Agent data is never copied into `WorkspaceSummary`.
- Activity Center remains observation-only and opening or closing it must not change terminal focus.
- No new action performs flash, erase, reset, J-Link attach, RTT start, or other hardware side effects.
