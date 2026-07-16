# Design: Phase 2 AI Activity Center

## Goals

- Make AI work visible without turning every MCP call into top-level noise.
- Keep the renderer strictly read-only with respect to the activity ledger.
- Preserve terminal responsiveness and existing session behavior.
- Use Phase 1 display-safe contracts as the only activity data source.
- Deliver bilingual, keyboard-accessible UI from the first slice.

## Data ownership

Main owns activity capture, sequence, cursor identity, redaction, health, and lifecycle semantics. Renderer owns only an ephemeral view model:

```text
Main OperationLedger
  -> preload activity namespace
    -> renderer activity hydration controller
      -> pure activity reducer/selectors
        -> AiStatusCapsule / ActivityCenterDrawer
```

The renderer must not synthesize operation/call identity. It may derive display grouping ids from display-safe `operationId`, `callId`, action, target aliases, and correlation hints, but those derived ids are view keys only.

## Hydration protocol

Phase 2 must follow the Phase 1 bridge protocol:

1. Register the local pushed-event listener.
2. Call `activity.subscribe({ cursor? })`.
3. Buffer pushed events that arrive while the subscribe call is pending.
4. Replace local retained state from the returned snapshot cut C.
5. Discard buffered events whose `(runtimeId, sequence)` are at or below C.
6. Apply only newer, contiguous events.
7. If runtime changes, cursor is rejected, sequence has a gap, or local state becomes inconsistent, request a new snapshot and expose a non-blocking diagnostic badge rather than silently pretending history is complete.

The hook must unsubscribe on unmount and must tolerate Renderer reloads, destroyed windows, malformed preload results, and duplicate pushed events.

## View model

The reducer stores:

- latest snapshot cursor and runtime id;
- retained event views by sequence;
- operation summaries keyed by `operationId`;
- call summaries keyed by `callId`;
- workflow step summaries for workflow operations;
- visible group summaries for active/attention/task/read-only burst groups;
- filter state, drawer state, selected item, and transient hydration diagnostics.

The reducer must be pure and covered without React. It cannot store functions, DOM nodes, xterm instances, subscriptions, raw errors, or unknown fields from unvalidated payloads.

## Default grouping

Default drawer mode is `Active & attention`.

Top-level cards:

- non-terminal active/running/queued/cancel-requested operations;
- pending/awaiting approval fixtures when present in display-safe data;
- failed/rejected/denied/expired/superseded/interrupted items that need attention;
- workflow/task groups with steps;
- collapsed read-only burst groups.

History and filters can reveal every retained operation/call in the Phase 1 window. A retained event must remain queryable even when folded out of the default top-level list.

Read-only burst folding groups adjacent low-risk calls when they share actor/surface/action family/target and occur within a bounded time window. Folding affects presentation only; details still list the member operations/calls.

## UI surfaces

### AI status capsule

The capsule lives in the existing app chrome. It summarizes highest-priority state:

1. pending approval / approval-required display states when present;
2. failed or attention-needed;
3. running;
4. idle.

Future Pause state has higher precedence, but Phase 2 does not implement Pause. The capsule must not pulse or flicker for low-value read-only bursts. Clicking the capsule opens the drawer.

### Activity Center drawer

The drawer overlays the main content instead of permanently compressing terminal width. At very small widths it may take the full content area. It includes:

- mode tabs for active/attention and history;
- filters by actor, risk, phase, session/workspace/target, and text/action code;
- group cards with safe labels, phase, duration, risk, actor, and target aliases;
- expandable event/call detail using display-safe fields only;
- workflow steps and progress when present;
- context actions.

### OriginIndicator entry

`OriginIndicator` remains a lightweight origin display, but receives an accessible button/entry mode in session tabs. Clicking it opens Activity Center filtered to that session. The accessible name must describe current AI/human/system activity rather than only saying `origin-indicator`.

## Context actions

- `Go to session`: available when the selected activity has a display-safe session target that maps to an existing renderer session. It focuses the existing session tab only when the user clicks it.
- `Diagnose`: first version is a safe UI affordance that opens/copies a diagnostic context or points to an existing diagnostic action when one exists. It must not start J-Link, flash, reset, open sessions, or run hardware tools.
- `Copy summary`: copies a bounded, redacted, display-safe summary. It must not include raw terminal output, raw paths beyond allowed aliases/basenames, raw evidence, stacks, credentials, tokens, scripts, screenshots, or firmware/binary data.

Unavailable actions render disabled with a reason.

## AI-created session focus behavior

Phase 2 must not let AI-created sessions steal user focus by default. New activity can show a drawer/capsule badge and optional `Follow AI` UI state. `Follow AI` is renderer-local and opt-in; it does not change Main/session authorization or creation semantics.

## Accessibility, i18n, and performance

- Every status/control has English and Chinese strings.
- Drawer supports keyboard open/close, focus placement, Escape close, screen-reader labels, and reduced-motion-safe status.
- Visible rows are bounded or virtualized. Large retained lists must not render every event into the DOM at once.
- Terminal input/scroll should not regress under a synthetic large activity list; tests must cover bounded DOM/render behavior and at least one terminal-adjacent regression check.

## Risks and mitigations

- **Snapshot/event race**: listener-before-subscribe buffering and sequence-gap resnapshot.
- **UI noise**: default grouping and read-only burst folding.
- **Sensitive data exposure**: consume strict display-safe DTOs only; copy/detail actions use allowlisted fields.
- **Terminal performance regression**: bounded rendering and focused tests.
- **Scope creep into approval/pause/readiness**: render only existing display-safe states and disabled/placeholder labels when data is not yet produced.
