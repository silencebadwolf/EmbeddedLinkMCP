# Design: Phase 3 Runtime Readiness + Start Center

## Goals

- Make the first screen task-oriented without hiding professional advanced connection paths.
- Build readiness from real, read-only facts owned by Main/core, not from renderer guesses or persisted wizard steps.
- Support safe partial results: runtime, serial, optional workspace/profile, sessions, and agent integration can update independently.
- Preserve Phase 0–2 behavior and trust boundaries while preparing Phase 4 first-signal work.
- Provide bilingual, keyboard-accessible UI from the first slice.

## Non-goals

- Completing the “first successful journey” milestone. Phase 4 owns signal detection, replay, xterm completion acknowledgement, silent/late states, and focus policy.
- Running hardware tools beyond existing read-only discovery. Phase 3 must not open/reserve serial ports, connect sessions, toggle DTR/RTS, write payloads, reset, flash, launch GDB/J-Link/RTT, or install tooling from readiness.
- Implementing Human Approval, grants, Pause/Take Over, durable audit, export/clear, cloud/database/telemetry, or rollback/checkpoint claims.
- Replacing `ConnectionDialog`; Start Center routes into it for advanced and Phase-3 fallback flows.

## Ownership model

```text
Main/core providers
  -> RuntimeReadinessService
    -> display-safe RuntimeReadinessSnapshot
      -> readiness IPC/preload
        -> renderer readiness hydration
          -> StartCenter / ReadinessChecklist / DeviceCandidateList
            -> existing ConnectionDialog or existing session APIs after user action
```

Main/core owns facts, generation, provider timeout/abort classification, display-safe mapping, and candidate confidence. Renderer owns only ephemeral presentation state, local filters/details, and versioned non-sensitive preferences such as dismissed hints.

## RuntimeReadinessSnapshot

The shared DTO uses `schemaVersion: '1.0.0'` and contains:

- `snapshotId`, `generation`, `generatedAt`;
- `status`: aggregate `checking | ready | action-required | blocked | unavailable`;
- `checks`: bounded display-safe checks with stable `code`, `scope`, `status`, `severity`, safe `summaryCode`, params, evidence refs, and recommended action codes;
- `deviceCandidates`: bounded candidate summaries with `kind`, `label`, `confidence`, safe evidence, optional serial parameters, and `requiresUserConfirmation`;
- `reusableSessions` and `reusableProfiles`: display-safe summaries only;
- optional `workspace`: display-safe alias/status, never raw config;
- `diagnostics`: bounded codes for provider timeout, partial failure, malformed preference fallback, stale generation, and unsupported provider.

Core returns codes and safe params; renderer supplies English/Chinese copy. Unknown fields fail strict parsing at preload/renderer boundaries.

## Provider aggregation

`RuntimeReadinessService` runs providers under an AbortSignal and per-provider timeout:

- runtime/app status: code freshness/runtime health from existing provider seams;
- serial discovery: existing serial list provider, with empty/error/checking separated;
- optional workspace/profile: safe summary of saved workspace/profile facts when available;
- reusable sessions: current session summaries suitable for “Back to session” suggestions;
- agent integration: read-only availability/diagnostic summary.

Provider failures produce an individual `action-required`/`unavailable` check and a diagnostic; they do not discard other provider results. Aborted or stale generations cannot overwrite newer snapshots.

J-Link, firmware, RTT, flash/verify, and specialized probe readiness are intentionally postponed to Phase 6.

## Device candidates and ConnectionDrafts

`DeviceCandidateResolver` combines live serial discovery, saved connection/profile facts, and reusable session facts:

- `exact` requires stable identity evidence, not merely “there is one port”.
- `likely` may come from matching profile/port metadata but must show source and may require confirmation.
- `unknown` candidates remain selectable/manual but cannot be auto-submitted.
- Multiple candidates are never auto-chosen.
- COM names alone do not imply MCU target.
- Profile/live conflicts set `requiresUserConfirmation=true` and show both facts safely.

`SerialConnectionDraft` is the handoff object between Start Center, candidate details, manual entry, advanced connection, and eventual session creation. It records:

- selected source: `live-discovery | saved-profile | manual | reusable-session`;
- serial settings and their source/default status;
- connection side-effect metadata: port reservation, no payload during connect, DTR/RTS/control-line behavior when known, and possible board reset wording;
- validation status and safe missing/conflict reasons.

Phase 3 can prefill the existing `ConnectionDialog` from a draft, but any actual session creation remains an explicit user action through existing session APIs.

## Readiness IPC/preload

Phase 3 adds stable readiness channels:

```text
readiness:get
readiness:refresh
readiness:subscribe
readiness:event
```

The preload namespace exposes:

```ts
window.linkterm.readiness.get()
window.linkterm.readiness.refresh()
window.linkterm.readiness.subscribe()
window.linkterm.readiness.unsubscribe()
window.linkterm.readiness.onEvent(handler)
```

The subscribe path follows the Phase 2 listener-before-subscribe discipline. Renderer attaches `onEvent`, subscribes, hydrates from the returned snapshot cut, and ignores stale events with a lower generation. `refresh` starts a new generation; overlapping refreshes use latest-wins semantics. Malformed invoke responses or pushed events become local diagnostics and do not mutate retained readiness facts.

The IPC implementation must unregister destroyed windows, tolerate send races, and expose only display-safe DTOs.

## Preferences

Start Center preferences use a dedicated versioned adapter, separate from activity/audit state:

- recent workspace/profile identifiers or display aliases;
- dismissed hint ids;
- optional last selected intent/draft fields that are non-sensitive.

The adapter must reject unknown versions, malformed JSON, unsafe shapes, oversized values, and secret-like fields by returning safe defaults plus diagnostics. Preferences are hints only: they never prove readiness, never auto-connect, and never block a fresh readiness scan.

## Start Center UI

Start Center replaces the no-active-session empty canvas. It is not a modal and not a permanent homepage.

Required presentation:

- one primary task intent: “Observe device output”;
- at most three secondary actions, including `Advanced connection…`;
- readiness checklist with loading skeleton/checking state and no “no device” flicker before serial discovery resolves;
- detected candidates with evidence/confidence and manual port entry when serial is empty/error/unknown;
- recent profile/workspace suggestions that show what would be reused, not just a name;
- refresh action and copy-safe diagnostics when available;
- `Advanced connection…` opens the existing `ConnectionDialog`;
- with active sessions, the terminal remains primary and Start Center is available only through an explicit entry point.

Before Phase 4, `Observe device output` must either open an existing connection flow with a draft/prefill or remain feature-flagged. It cannot show first-signal steps, success claims, or “waiting for first signal” states that require the Phase 4 monitor.

## Accessibility, i18n, and performance

- All new labels/statuses/errors/actions have English and Chinese strings.
- The primary task, refresh, manual entry, candidate selection, and advanced path are reachable by keyboard.
- Status is communicated through text and roles, not color alone.
- Loading, empty, error, blocked, ready, and partial-result states have distinct accessible names.
- Start Center does not intercept terminal typing when a terminal is focused.
- Candidate and check lists render bounded rows and remain responsive with large synthetic provider outputs.

## Risks and mitigations

- **Wizard state drift**: derive Start Center state from readiness snapshots and session facts; persist only hints/drafts, never a completed step number.
- **Unsafe auto action**: readiness is read-only and candidates are never auto-submitted; connection requires existing explicit user action.
- **Stale hotplug result**: generation/latest-wins, abort support, and candidate revalidation before any plan/session creation.
- **Sensitive data leakage**: shared strict display-safe schemas, safe workspace aliases, bounded diagnostics, no raw provider errors/stacks/config.
- **Scope creep into Phase 4/5/6**: CTA fallback to `ConnectionDialog`; no firstSignal IPC, no approval broker, no J-Link/RTT specialized checks.
- **Existing advanced user regression**: keep `ConnectionDialog` and active-terminal behavior intact; Start Center only replaces the empty no-session canvas.

## Migration plan

1. Add shared readiness schemas and core pure reducers/resolvers with no production wiring.
2. Add provider aggregation over existing read-only runtime/serial/workspace/profile/session facts.
3. Add versioned preferences adapter and corruption/migration tests.
4. Add readiness IPC/preload/mock bridge with listener-before-subscribe and generation tests.
5. Add renderer readiness hydration and Start Center components behind the no-session canvas.
6. Wire `Advanced connection…` and draft prefill to existing `ConnectionDialog` only after impact review.
7. Run focused tests after each slice, then lint/build/full tests/coverage/license/audit/OpenSpec/GitNexus verification and independent review.

Rollback is additive: remove Start Center integration, then readiness IPC registration, then new readiness modules. Existing session creation and advanced connection remain available throughout.
