# Design: Terminal-first Start Center

## Existing boundaries

`App` owns the no-session canvas, session shell, control-profile sidebar, Activity Center state, and ConnectionDialog mounting. `StartCenter` owns readiness presentation and routes explicit serial actions to callbacks supplied by `App`. `ConnectionDialog` remains the reusable connection form. Readiness and Activity Center provide display-safe DTOs; no new Main/preload contract is needed.

## Layout

When there is no active session, render a full-width Start Center with this order:

1. Header: title, short description, one `Open serial terminal` primary action, refresh, and a secondary `First-success guide` action.
2. `Serial devices`: detected candidates first and manual port/baud entry second. Saved connection profiles remain inside the existing `ConnectionDialog` opened by the primary action; they are not duplicated as incomplete Start Center rows.
3. `Advanced devices` disclosure: J-Link, RTT, firmware, Agent, control-profile, compensation, and detailed diagnostics.

When an active session or review panel exists, preserve the existing terminal/review layout and control-profile behavior.

## Action mapping

- Detected serial candidate -> existing candidate callback -> existing serial draft/ConnectionDialog/session path.
- Manual serial entry -> existing manual callback -> existing serial draft/ConnectionDialog/session path.
- Saved connection profile -> existing `ConnectionDialog` saved-profile list; no new readiness DTO or duplicate Start Center row.
- First-success guide -> existing guided entry only; it is not the primary manual terminal action.
- Advanced devices -> disclosure only; its actions keep their current safety and explicit-action semantics.

No renderer action directly opens a transport or writes bytes. Activity Center open/close must not change terminal focus or input availability.

## State and responsive behavior

- `App` does not render `ControlProfileSidebar` for the no-session Start Center branch.
- Start Center owns a local disclosure state for advanced devices; readiness data and AI activity state remain unchanged.
- Candidate, manual, and recent lists remain bounded as today.
- At narrow widths, serial sections stack vertically and advanced content remains below the primary path without horizontal overflow.
- Activity Center remains a fixed observation drawer and is closed by default when Start Center is shown.

## Copy and accessibility

Add paired English/Chinese keys for the primary action, serial-device section, reopen/open actions, first-success guide, advanced-device disclosure, empty/error/validation states, and Activity Center observation entry. Button names must describe the action (`Open serial terminal`, not `Observe device output`), and disclosure state must be exposed through `aria-expanded` and accessible labeling.

## Verification strategy

- Add failing component tests for primary action, unified serial area, disclosure, and bounded rendering before implementation.
- Add App tests for no-session sidebar suppression and active-session preservation.
- Add i18n/a11y tests and ConnectionDialog regression coverage.
- Run focused tests after each slice, then full tests, lint, TypeScript, build, license validation, OpenSpec strict validation, GitNexus impact/detect_changes, and Windows manual screenshot/input checks.
