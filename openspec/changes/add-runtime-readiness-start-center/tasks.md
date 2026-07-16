## 1. Phase 3 scope, entry, and impact gates

- [x] 1.1 Reconfirm Phase 2 evidence, current dirty worktree, absence of an existing Phase 3 change, and OpenSpec status before implementation.
- [x] 1.2 Record fresh GitNexus upstream-impact results for every existing function, class, method, interface, or shared object selected for modification; report HIGH/CRITICAL blast radius before editing.
- [x] 1.3 Add the Phase 3 implementation plan and keep it limited to Runtime Readiness + Start Center, not Phase 4 First Signal or later phases.

## 2. Shared contracts and pure readiness model

- [x] 2.1 Add failing shared-schema tests for `RuntimeReadinessSnapshot`, `ReadinessCheck`, `DeviceCandidate`, `SerialConnectionDraft`, readiness diagnostics, generation metadata, strict unknown-field rejection, bounds, and display-safe redaction.
- [x] 2.2 Implement the shared/core readiness contracts without exposing raw provider data, raw errors/stacks, full paths, credentials, scripts, firmware/binary data, terminal transcript, or Main-only approval objects.
- [x] 2.3 Add failing pure aggregation/reducer tests for loading, ready, action-required, blocked, unavailable, partial provider failure, timeout, abort, stale generation, and no-workspace states.
- [x] 2.4 Implement the pure readiness aggregation state model with latest-generation semantics and provider-isolated diagnostics.

## 3. Read-only providers and app-status extraction

- [x] 3.1 Add failing provider tests proving runtime/app status, serial discovery, optional workspace/profile summaries, reusable sessions, and agent-integration facts are collected without connection, write, reset, flash, GDB/J-Link/RTT launch, install, or workspace/profile mutation side effects.
- [x] 3.2 After fresh impacts, extract reusable app-status/runbook logic into a core `RuntimeReadinessService` provider layer while keeping existing MCP `get_app_status` behavior and result shape compatible.
- [x] 3.3 Add tests for provider timeout/abort, serial empty/error/loading separation, optional workspace/profile missing/invalid/conflict summaries, and active session suggestions.

## 4. Device candidates, drafts, and preferences

- [x] 4.1 Add failing `DeviceCandidateResolver` tests for 0/1/multiple serial ports, exact/likely/unknown confidence, saved-profile evidence, profile/live conflict, no COM-name-to-target inference, low-confidence no auto-submit, port reordering, and same VID/PID multi-device cases.
- [x] 4.2 Implement candidate resolution and display-safe evidence summaries.
- [x] 4.3 Add failing `SerialConnectionDraft` tests proving candidate/manual/advanced/session-create round-trip, parameter source preservation, side-effect metadata, safe missing/conflict reasons, and no implicit connection.
- [x] 4.4 Implement `SerialConnectionDraft` helpers and manual serial path integration points without changing existing `SessionManager`, `Transport`, or `WriteQueue` behavior.
- [x] 4.5 Add failing versioned preferences tests for recent workspace/profile hints, dismissed hints, migration, unknown version, corrupt/oversized file, unsafe secret-like fields, and safe-default diagnostics.
- [x] 4.6 Implement the readiness preferences adapter as hints only; it must never prove readiness, auto-connect, or block scanning.

## 5. Main IPC, preload, and mock bridge

- [x] 5.1 Add failing Main IPC tests for `readiness:get/refresh/subscribe/unsubscribe/event`, listener-before-snapshot, destroyed-window cleanup, send race, malformed cursor/payload, overlapping refresh latest-wins, stale generation rejection, and display-safe DTO-only output.
- [x] 5.2 After fresh impacts, register readiness IPC in Main composition without disturbing existing activity/session/control-profile IPC.
- [x] 5.3 Add failing preload tests for narrow `window.linkterm.readiness` methods, runtime parsing of invoke responses/pushed events, listener removal, malformed-payload rejection, and no exposed `ipcRenderer`.
- [x] 5.4 Extend the mock preload API fixture with deterministic readiness snapshot/event/refresh race helpers.

## 6. Renderer hydration and Start Center UI

- [x] 6.1 Add failing renderer reducer/hook tests for initial loading, subscribe-before-snapshot buffering, generation latest-wins, stale event discard, refresh retry, partial diagnostics, preference corruption display, and cleanup on unmount.
- [x] 6.2 Implement renderer readiness hydration using only `window.linkterm.readiness` display-safe DTOs.
- [x] 6.3 Add failing component tests for Start Center no-session replacement, skeleton/no-device flicker prevention, primary/secondary action limits, readiness checklist states, candidate evidence/confidence, manual entry, recent profile/workspace suggestions, refresh, safe copy diagnostics, and empty/error/blocked/ready states.
- [x] 6.4 Implement `StartCenter`, `ReadinessChecklist`, `DeviceCandidateList`, `ManualPortEntry`, and related components with bounded rendering and English/Chinese copy.
- [x] 6.5 Add failing integration tests proving `Advanced connection…` opens the existing `ConnectionDialog`, draft prefill/round-trip is safe, active sessions keep the terminal as primary UI, and Phase 3 does not display first-signal completion/waiting states.
- [x] 6.6 Wire Start Center into `App` only for the no-active-session canvas, preserving Activity Center, SessionTabBar, existing origin behavior, and ConnectionDialog advanced flow.

## 7. Accessibility, i18n, performance, and no-side-effect evidence

- [x] 7.1 Add accessibility tests for keyboard navigation, roles/names, status text not color-only, focus return after dialogs, manual entry labels/errors, and distinct loading/empty/error/blocked/ready announcements.
- [x] 7.2 Add bilingual key-coverage tests for every new label, status, diagnostic, action, disabled reason, and candidate/draft message in `en.ts` and `zh.ts`.
- [x] 7.3 Add large-list/bounded-render tests for many checks/candidates/recent items and terminal-adjacent rendering stability.
- [x] 7.4 Add no-hardware-side-effect tests/spies proving readiness refresh and Start Center rendering do not call session create/open, serial write, reset, flash, J-Link/RTT/GDB, install, or workspace/profile mutation paths.

## 8. Review and verification

- [x] 8.1 Run focused tests after each vertical slice: core readiness, candidate/draft/preferences, Main IPC/preload, renderer hydration/components, App integration, and affected Phase 1/2 activity bridge tests.
- [x] 8.2 Run lint, production build, full tests, coverage report, runtime/tooling license validation, and production dependency audit with fresh output.
- [x] 8.3 Request independent requirements/UI-accessibility and code-quality/security reviews; resolve every valid finding and rerun affected checks.
- [x] 8.4 Run verification-before-completion, OpenSpec strict validation, `git diff --check`, directed GitNexus PDG/taint checks for readiness IPC/preload/provider boundaries, and `detect_changes` against `main`.
- [x] 8.5 Record Phase 3 evidence, known limits, no-hardware-side-effect evidence, readiness/provider/candidate/preference results, a11y/i18n/performance results, and explicitly request authorization before Phase 4.

## Completion notes

- Phase 3 completion MUST NOT be described as First Success completion. First Success still requires Phase 4 Serial First Signal with non-empty device text visible after xterm completion acknowledgement.
- Phase 3 Start Center CTA MUST fall back to existing ConnectionDialog or remain feature-flagged until Phase 4 supplies the monitor/status model.
