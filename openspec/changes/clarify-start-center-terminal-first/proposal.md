## Why

The current Start Center presents observation, readiness, control profiles, J-Link/RTT status, diagnostics, recent profiles, and manual serial entry at the same visual level. A user who only wants to open a serial terminal must infer which of several overlapping entries is correct, while the Activity Center and control-profile sidebar consume attention and space.

The approved design makes the first screen terminal-first: one clear serial-terminal action, one unified serial-source area, and advanced device/AI observation features kept available but secondary.

## What Changes

- Make `Open serial terminal` the single primary Start Center intent.
- Unify discovered serial ports and manual port entry into one serial-device area; keep saved connection profiles in the existing `ConnectionDialog` instead of duplicating incomplete profile rows on Start Center.
- Keep the existing `ConnectionDialog`, `SessionManager`, `Transport`, and `WriteQueue` paths as the only connection/write boundaries.
- Move J-Link, RTT, firmware, Agent, control-profile, compensation, and detailed diagnostics into a collapsed `Advanced devices` area.
- Hide the control-profile sidebar while the app is in the no-session Start Center state; preserve it for active sessions and control-profile workflows.
- Keep Activity Center closed by default on Start Center and expose it as an observation-only drawer from the header.
- Update Chinese and English copy, keyboard semantics, focus behavior, and responsive layout.

## Scope Boundaries

This change is renderer information architecture only. It does not change AI execution, authorization, approval, pause/takeover, transport protocols, serial drivers, J-Link/RTT backends, audit storage, telemetry, cloud services, or hardware behavior. Human and AI continue to share the existing terminal session and input boundary without mutual takeover or approval prompts.

## Impact

- Primary renderer seams: `StartCenter`, `App`, `ConnectionDialog`, `ActivityCenterDrawer`, and readiness/activity i18n.
- Primary tests: Start Center component/a11y/bounded-render/no-side-effects tests, App start-center tests, Activity Center component tests, bilingual key coverage, and ConnectionDialog regression tests.
- Existing dirty worktree changes must remain untouched unless a directly affected symbol requires a minimal compatible edit.
- Before editing any existing symbol, GitNexus upstream impact must be run and HIGH/CRITICAL risk must be reported before proceeding.

## Success Criteria

- A new user can find `Open serial terminal` immediately and open a detected or manually entered COM port with one clear action.
- No-session Start Center does not show a duplicate control-profile sidebar or place J-Link/RTT/Agent blockers in the primary serial path.
- Activity Center remains available for observation and audit but does not request approval, pause AI, take over input, or disable terminal typing.
- Chinese/English, keyboard, large/small window, and existing connection/session regression tests pass.
