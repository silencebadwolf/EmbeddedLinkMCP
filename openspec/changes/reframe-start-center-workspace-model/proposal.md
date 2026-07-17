# Proposal: Reframe the Start Center around device workspaces

## Why

The current Start Center presents saved connections, manual opening, control profiles, readiness, and MCP/Agent integration as competing entry points. Users cannot tell whether a control profile is a device workspace, a temporary serial connection, or a system-level AI setting. This makes a simple serial session look like a full hardware setup and makes saved device workspaces harder to find.

## What changes

- Put saved device workspaces first on the no-session Start Center.
- Treat a workspace as device identity, link method, firmware, and related device facts.
- Keep MCP injection and Agent configuration as system-level settings shared by all workspaces.
- Make “New device workspace” the single creation entry; its first choice is “Serial-only connection” or “Full device workspace”.
- Let serial-only setup open a temporary session or save a lightweight serial workspace, while reusing the existing ConnectionDialog and SessionManager path.
- Remove the Start Center's `Advanced devices` disclosure; J-Link, RTT and firmware remain part of full workspace configuration, while MCP/Agent and Activity Center remain system-level entries.
- Add a clear delete action to every saved workspace without closing any terminal session that is already open.

## Scope boundaries

This is a renderer information-architecture change. It does not change persistence formats, MCP execution, Agent behavior, authorization, Activity/Audit semantics, SessionManager, WriteQueue, Transport, J-Link/RTT backends, serial drivers, or hardware operations. Existing saved data must remain readable and must not be deleted or silently overwritten.

## Success criteria

- A saved full workspace opens from the first screen with one action.
- A user can create a temporary serial session without filling full device fields.
- A user can save that serial connection as a lightweight workspace.
- MCP/Agent configuration is discoverable from system chrome and is absent from workspace summaries.
- The home page does not show a COM list or duplicate manual serial entry.
- The home page does not show an advanced-device, readiness-diagnostic, or first-success shortcut.
- A saved full or serial-only workspace can be deleted from its card after confirmation, and a storage failure leaves the card visible.
- Human and AI continue to share the same terminal session and input boundary.
