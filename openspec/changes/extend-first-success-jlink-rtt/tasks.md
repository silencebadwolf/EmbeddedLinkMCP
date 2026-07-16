## 1. Phase 6 scope, entry, and impact gates

- [x] 1.1 Reconfirm Phase 5 evidence, current dirty worktree, absence/presence of existing Phase 6 implementation, and OpenSpec status before product-code implementation.
- [x] 1.2 Record fresh GitNexus upstream-impact results for every existing function, class, method, interface, shared schema, or React component selected for modification; report HIGH/CRITICAL blast radius before editing.
- [x] 1.3 Keep Phase 6 limited to Workspace/J-Link/RTT download-and-observe; do not implement Pause/Take Over, durable audit/export/clear, cloud/telemetry/database, generic chat UI, external installers, arbitrary repair scripts, or hardware rollback promises.
- [x] 1.4 Prove every Phase 6 validation run uses fake backends/spies/temp files/mocks only and executes no real flash, erase, reset, probe attach, GDB server, RTT server, serial payload write, or workspace-destructive action.

## 2. Shared display-safe contracts and drafts

- [x] 2.1 Add failing shared-schema tests for J-Link/firmware/RTT readiness scopes, evidence sources, actions, candidates, download-and-observe drafts, profile suggestions, and compensation summaries.
- [x] 2.2 Implement display-safe DTOs without exposing firmware bytes, full private paths, J-Link serial numbers, backend handles, raw SEGGER output, scripts, credentials, `PreparedOperation`, grants, authorization records, internal fingerprints/digests, nonces, or raw errors/stacks.
- [x] 2.3 Add failing strict unknown-field, bounded-length, bounded-list, secret-key, basename/hash-prefix, and bilingual-safe-code tests.
- [x] 2.4 Implement draft round-trip helpers preserving workspace/profile/target/firmware/RTT provenance without treating a draft as authorization.

## 3. J-Link/firmware/RTT readiness providers

- [x] 3.1 Add failing pure/provider tests for no backend, backend available, no probe, one probe, multiple probes, target catalog hit/miss, firmware missing/outside workspace/oversized/unparseable, RTT config missing, and optional workspace absent.
- [x] 3.2 Prove readiness providers are read-only: connect/reset/halt/run/flash/erase/memory-write/rtt-connect/rtt-read/GDB-server/session-open/workspace-mutate/profile-mutate call counts remain 0.
- [x] 3.3 Implement provider aggregation using the existing Runtime Readiness generation model and provider failure isolation.
- [x] 3.4 Add device candidate/draft resolver tests proving serial and J-Link cannot be auto-paired by list position/name and that conflicts require user confirmation.

## 4. Approval-gated guided Download/Flash/Reflash CTAs

- [x] 4.1 Add failing approval tests proving every new guided Download/Flash/Reflash CTA prepares/requests approval only; button click and `confirm=true` alone execute zero effectful backend calls.
- [x] 4.2 Add failing continuation tests for valid grant, consumed replay, wrong principal/kind/surface/mode, wrong target/probe, source/hash/profile/default changes, TTL expiry, denial, quota, and malformed payload.
- [x] 4.3 Implement Phase 6 approval preparation by extending existing Phase 5 Broker/preparer seams; do not create a second approval state machine or Renderer-owned authority.
- [x] 4.4 Prove `approval:resolve` remains decision-only and approved execution requires explicit continuation on the original execution surface.

## 5. Control workflow job visibility and specialized diagnostics

- [x] 5.1 Add failing workflow tests for connect, flash, verify, reset, serial observe, RTT connect, RTT observe, GDB server, diagnostics, job progress, cancellation/abort propagation, and safe next actions.
- [x] 5.2 Add failing failure-path tests for no backend, no probe, target error, firmware path/format error, flash failure, verify failure, RTT connect failure, RTT read/search failure, and RTT silent.
- [x] 5.3 Implement or refine structured diagnostics and Activity/job projections using existing `runControlWorkflow`, `ControlWorkflowJobManager`, `OperationRecorder`, and `IJLinkBackend`.
- [x] 5.4 Prove Phase 6 does not use VS Code tasks, shell commands, direct SEGGER process spawning outside `src/jlink/`, or raw terminal parsing as fallback.

## 6. J-Link/RTT first-success state and recovery UI

- [x] 6.1 Add failing reducer/component tests for J-Link/RTT states: checking, needs-workspace/profile, needs-backend, needs-probe, needs-target, needs-firmware, reviewing-plan, awaiting-approval, running-job, verifying, observing-rtt, rtt-silent, errored, completed.
- [x] 6.2 Add recovery tests for refresh readiness, edit workspace/profile, choose firmware, choose/edit target, keep waiting for RTT, view job/activity, open RTT log session, retry after failure, and go to terminal/log.
- [x] 6.3 Implement renderer UI extensions using display-safe readiness, approval, workflow, activity, and compensation summaries only.
- [x] 6.4 Add focus/non-stealing tests proving late RTT signal or job completion does not steal focus from Approval Sheet, Activity Center, advanced forms, terminal input, or another session.

## 7. Main-only CompensationCandidate and reflash summary

- [x] 7.1 Add failing core tests for candidate creation only after flash+verify success, previous known-good preservation while a new deployment is in progress, failure/unknown results not overwriting known-good, expiry/retention, and shutdown cleanup.
- [x] 7.2 Add failing matching tests for source ref/hash/size/format/base address, target/probe binding, profile revision/defaults, workflow mode, and manifest digest.
- [x] 7.3 Implement Main-only candidate storage/projection without crossing preload with internal candidate objects.
- [x] 7.4 Add failing reflash CTA tests proving mismatch hides/disables reflash, matching summary prepares a new approval, and reflash approval is one-time/single-use with effectful backend=0 until consumed.

## 8. Profile suggestion after verified success

- [x] 8.1 Add failing tests for safe profile suggestion generation from verified success, display-safe target/firmware/RTT summaries, user-confirmed save, save failure, skip, and stale profile evidence.
- [x] 8.2 Implement suggestions through existing profile/workspace managers only; do not auto-save or infer stable hardware identity.
- [x] 8.3 Prove profile save/update is separate from first-success completion and cannot authorize future high-impact operations.

## 9. Activity Center, Approval Sheet, and i18n integration

- [x] 9.1 Add failing Activity Center tests for J-Link/RTT operation grouping, job steps, authorization labels, diagnostic next actions, compensation summaries, and no rollback wording.
- [x] 9.2 Add failing Approval Sheet tests for Phase 6 action labels, target refs, firmware artifact metadata, RTT plan steps, reflash wording, expiry, denial, supersede, and approved-ready continuation.
- [x] 9.3 Add EN/ZH key-coverage tests for every new readiness, plan, diagnostic, recovery, activity, approval, compensation, profile suggestion, and safe error string.
- [x] 9.4 Implement UI copy and projections without leaking internal authority fields, raw backend output, firmware bytes, serial numbers, or private paths.

## 10. Performance, accessibility, and bounded rendering

- [x] 10.1 Add accessibility tests for keyboard operation, roles/names, non-color-only status, focus return, reduced-motion-safe progress, small windows, and screen-reader-distinct RTT vs serial silent states.
- [x] 10.2 Add performance tests for many probes, candidates, workflow steps, diagnostics, compensation summaries, and high-frequency job/RTT updates without degrading terminal-adjacent rendering.
- [x] 10.3 Add bounded diagnostic/rendering tests for large firmware metadata, large probe lists, long SEGGER messages after redaction, and long workflow plans.

## 11. Focused validation slices

- [x] 11.1 Run focused tests after each vertical slice: shared contracts, readiness providers, draft resolver, approval preparation/continuation, workflow diagnostics, renderer J-Link/RTT flow, compensation candidate, reflash CTA, profile suggestion, Activity/Approval UI, a11y/i18n/performance.
- [x] 11.2 Run affected Phase 3-5 bridge tests to prove serial first success, Start Center, Activity Center, and Human Approval behavior did not regress.
- [x] 11.3 Run lint, production build, full tests, coverage report, runtime/tooling license validation, and production dependency audit with fresh output.

## 12. Review and closeout

- [x] 12.1 Request independent requirements/UI-accessibility and code-quality/security reviews; resolve every valid finding and rerun affected checks.
- [x] 12.2 Run verification-before-completion, OpenSpec strict validation, `git diff --check`, directed GitNexus PDG/taint checks for readiness/approval/workflow/compensation/preload/renderer boundaries, and `detect_changes` against `main`.
- [x] 12.3 Record Phase 6 evidence, known limits, no-hardware-side-effect evidence, approval/Broker/compensation/reflash/profile-suggestion results, a11y/i18n/performance results, and explicitly request authorization before Phase 7.

## Completion notes

- Phase 6 completion may claim J-Link/RTT download-and-observe only if readiness is read-only, all new high-impact entry points require Phase 5 human-once single-use approval, workflow execution stays inside existing managers and `IJLinkBackend`, and known-good/reflash behavior is driven only by matching verified evidence.
- Phase 6 completion MUST NOT be described as A+D completion. Pause/Take Over and Durable Audit remain future phases.
