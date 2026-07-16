## 1. Phase 5 scope, entry, and impact gates

- [x] 1.1 Reconfirm Phase 4 evidence, current dirty worktree, absence of an existing Phase 5 implementation, and OpenSpec status before product-code implementation.
- [x] 1.2 Record fresh GitNexus upstream-impact results for every existing function, class, method, interface, or shared object selected for modification; report HIGH/CRITICAL blast radius before editing.
- [x] 1.3 Keep Phase 5 limited to Human Approval; do not implement J-Link/RTT journey expansion, Pause/Take Over, durable audit/export/clear, cloud/telemetry/database, generic chat UI, compensation/reflash UI, or hardware rollback.

## 2. Shared display-safe contracts and Main-only core schemas

- [x] 2.1 Add failing shared-schema tests for `ApprovalCapabilitiesView`, `ApprovalRequestView`, `AuthorizationDisplay`, approval snapshot/event/resolve DTOs, strict unknown-field rejection, bounded safe diagnostics, queue/revision ordering, and display-safe labels.
- [x] 2.2 Implement shared approval DTO schemas without exposing `PreparedOperation`, `ApprovalGrant`, `AuthorizationRecord`, `CallerPrincipalId`, nonces, source refs, internal fingerprints/digests, prepared bytes/handles, raw rule ids/config, raw errors/stacks, scripts, firmware bytes, credentials, or backend handles.
- [x] 2.3 Add failing internal core-schema tests for `PreparedOperation`, `ApprovalRequest`, `ApprovalGrant`, `AuthorizationRecord`, `PreparedContinuation`, `ApprovalBrokerLimits`, and `CallerPrincipalId` ownership/lifetime constraints.
- [x] 2.4 Implement Main-only approval core contracts in a non-preload path and prove they are not imported by renderer/shared display code.

## 3. ApprovalModePolicy and stable principal mapping

- [x] 3.1 Add failing tests proving desktop defaults to `interactive-required`, true headless defaults to `headless-deny`, `automation-allowlisted` is disabled in Phase 5, and args/headers/Renderer/window/transport/reconnect cannot downgrade mode.
- [x] 3.2 Implement immutable `ApprovalModePolicy` in Main/core and expose only display-safe capabilities.
- [x] 3.3 Add failing tests for stable `CallerPrincipalId` mapping: shared runtime credential HTTP/stdio/proxy reconnects map to one local-MCP principal, desktop Renderer maps to a distinct runtime principal, and client-supplied ids/correlation/display names are ignored for grant binding and rate limiting.
- [x] 3.4 Implement principal mapping without exposing raw tokens or internal principal ids to Renderer.

## 4. Side-effect-free preparation and effect fingerprinting

- [x] 4.1 Add failing pure fingerprint tests for canonical args, excluded non-semantic fields (`confirm`, `approvalId`, correlation/request/display hints), expanded defaults, continuation kind/surface/mode, profile revision, target binding, plan steps, artifact hash/size, path realpath/symlink changes, and deterministic ordering.
- [x] 4.2 Add failing read-only facade tests proving prepare may call only allowlisted status/detect/catalog/profile/path/hash methods and calls zero connect/halt/run/reset/write/erase/flash/start-server/session-open/workspace-mutate/job-start methods.
- [x] 4.3 Implement `PreparedOperation` creation and effect fingerprinting for the initial migrated MCP/control-workflow/direct-download surfaces.
- [x] 4.4 Add tests for bounded/no-handle prepare release semantics, artifact size limits, total prepared bytes limits, malformed/oversized input safe errors, and resource release on deny/expire/supersede/consume/shutdown. Explicit prepare cancellation API is not present in Phase 5.

## 5. ApprovalBroker state machine, limits, and mandatory AuthorizationRecord

- [x] 5.1 Add failing pure broker tests for pending dedupe, queue ordering, deny, TTL expiry, approved, consumed, consumed replay, correct consumer effect supersede, wrong principal/kind/surface/mode rejection preserving grant, per-principal/global pending limits, per-principal/global rate limits, and approved-unconsumed grant preservation under pressure.
- [x] 5.2 Add failing fault-injection tests for `AuthorizationRecord` schema/serialization/capacity/append failure, subscriber throw, best-effort ledger failure, and consume-after-backend-throw semantics; authority must fail closed or preserve prior state as specified.
- [x] 5.3 Implement the broker as a Main-owned serialized authority with one-time grants and mandatory authorization records.
- [x] 5.4 Prove `approval:resolve` records decisions only and never calls effectful backend methods.

## 6. Main IPC, preload, and mock bridge

- [x] 6.1 Add failing Main IPC tests for `approval:capabilities/snapshot/subscribe/unsubscribe/resolve/event`, listener-before-snapshot, destroyed-window cleanup, send race cleanup, malformed request/payload, stale revision rejection, queue ordering, sender validation, and display-safe DTO-only output.
- [x] 6.2 After fresh impacts, register approval IPC in Main composition without disturbing activity/readiness/session/first-signal/control-profile IPC.
- [x] 6.3 Add failing preload tests for narrow `window.linkterm.approval` methods, runtime parsing of invoke responses/pushed events, invalid-payload safe diagnostics, listener removal, and no exposed `ipcRenderer`.
- [x] 6.4 Extend the mock preload API fixture with deterministic approval snapshot/event/resolve/revision/invalid-payload helpers.

## 7. Renderer Approval Sheet and Activity authorization labels

- [x] 7.1 Add failing reducer/hydration tests for approval queue snapshot/event ordering, pending/approved-ready/denied/expired/superseded/consumed states, stale event discard, malformed payload diagnostics, and cleanup on unmount.
- [x] 7.2 Add failing component tests for Approval Sheet risk/action/target/argument/step/artifact display, one-at-a-time queueing, deny, approve once, expiry, approved-ready-to-continue, no rollback wording, focus return, non-stealing assertive notification, keyboard access, and small-window layout.
- [x] 7.3 Implement Approval Sheet UI using only display-safe approval DTOs.
- [x] 7.4 Add failing Activity Center tests proving caller acknowledgement, client-acknowledged-not-authorized, approved-once-by-you, and future automation labels are distinct in text/icon/screen-reader output.
- [x] 7.5 Implement authorization display mapping and EN/ZH strings without leaking internal authority fields.

## 8. MCP high-impact approval migration

- [x] 8.1 Add failing MCP boundary tests proving `confirm=true` alone in `interactive-required` mode does not execute high-impact debug/runtime/control-workflow tools and effectful backend calls remain 0.
- [x] 8.2 Add failing retry/continuation tests proving a valid approval grant executes exactly once, consumed replay does not reexecute, wrong principal/kind/surface/mode preserves the original grant, and correct-consumer effect changes supersede and require a new approval.
- [x] 8.3 After fresh impacts, migrate the central MCP registry/high-impact handler path to prepare/request/consume without bypassing existing `IJLinkBackend`, manager, JobManager, or tool result contracts.
- [x] 8.4 Preserve legacy missing-acknowledgement behavior where applicable while making acknowledged-but-unapproved requests return stable approval-required evidence.
- [x] 8.5 Update tool descriptions/runbook/schema/error compatibility so legacy clients fail closed with upgrade guidance rather than silently executing.

## 9. Control Profile direct RUN/START_DOWNLOAD migration

- [x] 9.1 Add failing Main IPC/direct-download tests proving the initial Download click or hard-coded `confirm:true` only prepares/requests approval and does not execute or start a job.
- [x] 9.2 Add failing continuation tests for `CONTROL_PROFILE_RUN_DOWNLOAD` sync mode and `CONTROL_PROFILE_START_DOWNLOAD` background mode using `{ kind: 'continue-approved', approvalId }`, including approve→Renderer reload→explicit Continue, duplicate continuation, wrong surface/mode, MCP/IPC cross-consume, and effect/profile/artifact/target changes.
- [x] 9.3 After fresh impacts, migrate `registerControlProfileIpc` RUN/START_DOWNLOAD through the same broker without bypassing existing control-profile manager, workflow runner, JobManager, or backend boundaries.
- [x] 9.4 Prove direct IPC and MCP cannot double-consume the same grant.

## 10. Accessibility, i18n, performance, and no-side-effect evidence

- [x] 10.1 Add accessibility tests for Approval Sheet roles/names, keyboard operation, focus return, assertive-but-non-stealing announcements, status text not color-only, expiry messaging, and reduced-motion-safe presentation.
- [x] 10.2 Add bilingual key-coverage tests for every new approval label, status, diagnostic, disabled reason, authorization label, action, plan-step message, expiry/deny/supersede text, and safe error in `en.ts` and `zh.ts`.
- [x] 10.3 Add performance/bounded-render tests for many pending requests, large plan steps, rate-limited prepare bursts, and renderer queue hydration without degrading terminal-adjacent rendering.
- [x] 10.4 Add no-hardware-side-effect tests/spies proving prepare/deny/expire/wrong-consumer/quota/resolve/malformed/replay paths do not connect, write, reset, flash, erase, launch J-Link/RTT/GDB, start jobs, mutate workspace/profile, or execute real hardware side effects.

## 11. Review and verification

- [x] 11.1 Run focused tests after each vertical slice: shared DTOs, core broker, principal/mode, fingerprint/prepare, IPC/preload, renderer approval UI, Activity labels, MCP migration, direct Control Profile migration, and affected Phase 1-4 bridge tests.
- [x] 11.2 Run lint, production build, full tests, coverage report, runtime/tooling license validation, and production dependency audit with fresh output.
- [x] 11.3 Request independent requirements/UI-accessibility and code-quality/security reviews; resolve every valid finding and rerun affected checks.
- [x] 11.4 Run verification-before-completion, OpenSpec strict validation, `git diff --check`, directed GitNexus PDG/taint checks for approval IPC/preload/broker/registry/control-profile boundaries, and `detect_changes` against `main`.
- [x] 11.5 Record Phase 5 evidence, known limits, no-hardware-side-effect evidence, broker/fingerprint/principal/continuation results, a11y/i18n/performance results, and explicitly request authorization before Phase 6.

## Completion notes

- Phase 5 completion may claim Human Approval only if `confirm=true` and button click alone cannot execute approval-required operations in interactive mode, and valid grants are Main-owned, bound, short-lived, and consumed once.
- Phase 5 completion MUST NOT be described as A+D completion. J-Link/RTT journey expansion, Pause/Take Over, and Durable Audit remain future phases.
