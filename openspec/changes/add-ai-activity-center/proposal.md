## Why

Phase 1 created a Main-owned, display-safe activity ledger and preload bridge, but users still cannot see what AI work is happening unless they inspect raw test surfaces or infer it from terminal side effects. The next independently shippable slice is a read-only Activity Center: it makes AI terminal and non-terminal actions visible, grouped, searchable, and explainable while preserving existing product behavior and trust boundaries.

## What Changes

- Add a renderer-owned activity feature that hydrates from `window.linkterm.activity`, attaches the pushed-event listener before subscribing, applies the returned snapshot cut, buffers concurrent events, detects sequence gaps, and resynchronizes without trusting Renderer-supplied identity.
- Add a pure activity view-model/reducer for active/attention/task grouping, read-only burst folding, filters, safe detail expansion, workflow-step rendering, and bounded visible lists. Every retained operation/call remains queryable through filters/details, but ordinary read-only bursts do not become top-level UI noise.
- Add an `AiStatusCapsule` and right-side `ActivityCenterDrawer` with accessible English/Chinese labels, keyboard-close behavior, non-invasive overlay behavior, reduced-motion-safe status indicators, and no full terminal transcript mirroring.
- Upgrade `OriginIndicator` into an Activity Center session-filter entry while preserving its current lightweight origin-dot semantics and improving its accessible name.
- Add the minimum Phase 2 context actions: `Go to session`, `Diagnose`, and `Copy summary`. Unavailable actions explain why; available actions use existing UI/preload surfaces and do not add new backend side effects.
- Preserve AI-created session non-stealing behavior by default. If Phase 2 exposes a `Follow AI` affordance, it is opt-in UI state only and does not change `SessionManager` semantics.

## Scope Boundaries

This change does not implement Runtime Readiness/Start Center, Serial First Signal, Human Approval Broker, Pause/Take Over, durable audit/export/retention, remote approval, cloud services, telemetry, databases, or hardware rollback promises. It does not change the Phase 1 ledger contracts, MCP tool result shapes, authorization behavior, existing `confirm=true` acknowledgement semantics, or any real hardware effect.

## Capabilities

### New Capabilities

- `ai-activity-center`: Defines the Phase 2 renderer Activity Center, AI status capsule, session-filter origin entry, grouping/filtering/folding, safe summaries, workflow-step visibility, snapshot/event hydration, accessibility, i18n, and large-list performance requirements.

### Modified Capabilities

No runtime capability requirement changes. This change consumes the Phase 1 activity bridge and existing renderer/session surfaces to present display-safe activity views only.

## Impact

- Expected implementation areas:
  - `src/renderer/features/activity/` or equivalent isolated renderer feature for reducer, selectors, hydration hook, and UI components.
  - `src/renderer/App.tsx`, `src/renderer/components/OriginIndicator.tsx`, `src/renderer/components/SessionTabBar.tsx`, `src/renderer/store/app-store.ts`, `src/renderer/i18n/en.ts`, `src/renderer/i18n/zh.ts`, and `tests/fixtures/mock-preload-api.ts`.
  - Focused unit/component tests under `tests/unit/renderer/` plus preload/mock integration tests that exercise snapshot-before/after-event races and reload hydration.
- Existing symbol edits require fresh GitNexus upstream impact before implementation. Likely seams include `App`, `OriginIndicator`, `SessionTabBar`, `useAppStore`, `createMockPreloadAPI`, and i18n exports.
- Renderer receives only Phase 1 display-safe DTOs. No Main-only `PreparedOperation`, `Grant`, `AuthorizationRecord`, `CallerPrincipalId`, `Lease`, `CompensationCandidate`, raw tool arguments, raw evidence, raw errors, terminal transcript, firmware bytes, screenshots, credentials, tokens, or backend handles may cross into Activity Center state.
- No new runtime dependency is expected. If virtualization requires one, that must be justified separately and pass license/dependency review before implementation.
