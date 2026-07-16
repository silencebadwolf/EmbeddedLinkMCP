# Phase 3 Evidence: add-runtime-readiness-start-center

Date: 2026-07-13

Status: Phase 3 Runtime Readiness + Start Center closeout evidence is captured. This
document covers Phase 3 only and is the handoff point for requesting user authorization
before Phase 4. It does not claim Phase 4 Serial First Signal, Phase 5 Human Approval,
Phase 6 J-Link/RTT, Phase 7 Pause/Take Over, Phase 8 Durable Audit, or the overall A+D
goal is complete.

## Scope delivered

Phase 3 implements read-only Runtime Readiness + Start Center:

- Main/core readiness snapshot aggregation for runtime status, serial discovery, optional
  workspace/profile summaries, reusable sessions, and agent integration facts.
- Strict shared readiness DTO schemas with generation metadata, bounded arrays, strict
  unknown-field rejection, and display-safe strings.
- Device candidate resolution, serial connection drafts, and versioned readiness preferences.
- Additive MCP `get_app_status` readiness data while preserving the existing result shape.
- Main readiness IPC, preload readiness namespace, mock preload helpers, and renderer
  hydration with latest-generation semantics.
- Start Center for the no-active-session canvas, with readiness checklist, candidates,
  manual serial path, recent profiles, diagnostics, refresh, and existing advanced
  `ConnectionDialog` fallback.
- Candidate/manual handoff through `SerialConnectionDraft` and `NonSensitivePrefill`,
  preserving draft source, candidate id, validation status, side-effect metadata,
  `dataBits`, `stopBits`, and `parity` without auto-connecting.
- Primary "Observe device output" behavior remains safe:
  - exactly one serial candidate: opens the existing `ConnectionDialog` with draft-backed
    candidate prefill for user review;
  - zero or multiple serial candidates: opens the existing advanced connection flow without
    silently choosing a candidate.

Explicitly out of scope for Phase 3:

- Serial First Signal completion, xterm completion acknowledgement, or first-success
  milestone display.
- Human Approval Broker, `PreparedOperation`, grants, approval continuation,
  `AuthorizationRecord`, `CallerPrincipalId`, `Lease`, or `CompensationCandidate`.
- Pause / Take Over.
- J-Link/RTT-specific readiness, firmware download/observe flows, GDB launch, reset, flash,
  durable JSONL audit/export/clear, remote approval, cloud services, databases, telemetry,
  generic chat UI, or hardware rollback promises.
- Real hardware side effects.

## Display-safe and trust-boundary evidence

- Renderer readiness state is hydrated only from `window.linkterm.readiness` DTOs and is
  parsed through shared schemas before use.
- Preload parses readiness invoke responses and pushed readiness events before handing data
  to Renderer callbacks.
- Malformed pushed readiness events now produce a bounded display-safe diagnostic
  `{ code: "readiness.invalid_payload", severity: "error" }` and do not expose the raw
  payload.
- Main readiness IPC parses requests/cursors and broadcasts schema-validated
  `ReadinessEvent` payloads.
- Runtime providers summarize facts into display-safe checks, diagnostics, candidates, and
  profile/session hints. Tests cover redaction and strict schema rejection.
- Oversized provider contributions are truncated into bounded lists and emit
  `readiness.provider_truncated` instead of turning the whole provider contribution into
  `readiness.provider_invalid`.
- Renderer Start Center actions do not auto-connect:
  - `Advanced connection…` opens the existing `ConnectionDialog`.
  - Manual serial path creates a safe serial draft/prefill only.
  - Candidate review creates a safe candidate draft/prefill only.
  - Refresh uses the readiness hydration controller.
- No Phase 3 renderer path receives Main-only approval/grant/lease/compensation objects.
- Renderer readiness hydration tears down its local subscription listener after malformed
  subscribe payloads or non-cursor subscribe failures, so a failed start cannot leave a stale
  local listener registered or cause a later `start()` call to return early.

## TDD and review-fix evidence

The final residual review issue was fixed with an explicit red-green cycle:

- Added failing test:
  `tests/unit/renderer/readiness/start-center-components.test.tsx` proves multiple detected
  serial candidates do not let the primary CTA silently choose the first candidate.
- Red result before implementation:
  `pnpm exec vitest run tests/unit/renderer/readiness/start-center-components.test.tsx`
  failed with 1 failed test because `onUseCandidate` was called with `COM7`.
- Implementation:
  `StartCenter` now filters serial candidates and only uses a primary candidate when the
  count is exactly 1; otherwise it falls back to `onAdvancedConnection()`.
- Green result:
  `pnpm exec vitest run tests/unit/renderer/readiness/start-center-components.test.tsx`
  passed: 1 file / 5 tests.

## GitNexus impact evidence

Fresh upstream impact was run before modifying existing product symbols during Phase 3.
Notable recorded results:

- `PreloadAPI`: CRITICAL; reported before continuing. The implementation was kept additive
  by adding narrow `activity`/`readiness` namespaces and runtime parsing tests.
- `ReadinessNamespace`: HIGH; reported before continuing. Changes were limited to the
  readiness namespace and a display-safe invalid-payload callback.
- `NonSensitivePrefill`: HIGH; reported before continuing. Changes only add serial draft
  metadata and serial line-setting fields used by existing dialog prefill.
- `RuntimeReadinessService`: HIGH; reported before continuing. Changes were limited to
  provider contribution bounding/truncation and diagnostic generation.
- `StartCenter`: LOW before the final multi-candidate primary CTA fix; 2 impacted symbols,
  1 direct caller (`App`), and App-related process coverage.
- Other Phase 3 surfaces such as `App`, `useRuntimeReadinessState`,
  `createRuntimeReadinessHydrationController`, `recordRuntimeReadinessDiagnostic`,
  `ConnectionDialog`, draft helpers, and i18n helpers were LOW or covered as additive
  surfaces after index refresh.
- GitNexus could not always resolve test-fixture symbols by name; those seams are covered by
  focused mock-preload, renderer, and App tests.

## Independent review evidence

Independent reviews were requested and all valid Critical/Important findings were resolved.

Requirements/UI-accessibility review:

- Initial result: Fail with 2 Critical and 6 Important findings.
- Valid findings fixed:
  - missing primary observe task and per-candidate action;
  - Start Center handoff bypassing `SerialConnectionDraft` metadata;
  - malformed pushed readiness events silently dropped;
  - refresh bypassing hydration controller;
  - dynamic readiness UI rendering raw DTO codes/statuses;
  - candidate draft parameter sources / serial settings handoff gaps;
  - long candidate label bounding;
  - reduced motion and bounded diagnostics.
- Follow-up result after fixes: one residual Important for multi-candidate primary observe
  silently choosing the first candidate.
- Final follow-up after TDD fix: Critical: none; Important: none; gate Pass.
- Reviewer verification:
  `pnpm exec vitest run tests/unit/renderer/readiness/start-center-components.test.tsx tests/unit/renderer/App.start-center.test.tsx`
  passed: 2 files / 11 tests.

Quality/security review:

- Initial result: Pass with fixes, 3 Important findings.
- Valid findings fixed:
  - Start Center refresh now routes through the hydration controller;
  - malformed preload readiness events now emit a display-safe diagnostic without raw payload;
  - oversized provider contributions are truncated with a safe warning rather than failing the
    whole provider.
- Follow-up result: Critical: none; Important: none; gate Pass.
- Reviewer verification:
  `pnpm exec vitest run tests/unit/main/preload-readiness.test.ts tests/unit/renderer/readiness/readiness-hydration.test.ts tests/unit/renderer/App.start-center.test.tsx tests/unit/core/readiness/runtime-readiness-service.test.ts tests/unit/shared/readiness-contract.test.ts`
  passed: 5 files / 38 tests.

## Fresh validation evidence

Final verification after the residual multi-candidate fix:

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/unit/renderer/readiness/start-center-components.test.tsx` | PASS: 1 file / 5 tests |
| `pnpm exec vitest run tests/unit/renderer/readiness tests/unit/renderer/App.start-center.test.tsx tests/unit/renderer/App.test.tsx tests/unit/renderer/components/ConnectionDialog.test.tsx tests/unit/shared/readiness-contract.test.ts tests/unit/core/readiness tests/unit/main/ipc/readiness-ipc.test.ts tests/unit/main/preload-readiness.test.ts` | PASS: 18 files / 119 tests |
| `pnpm run lint` | PASS |
| `pnpm run build` | PASS, with existing Vite chunk-size warning |
| `pnpm run validate:licenses` | PASS: 19 runtime dependencies and 29 packages in 1 audited dev-tooling production closure |
| `pnpm audit --prod` | PASS: no known vulnerabilities |
| `pnpm run test` | PASS: 141 files / 1774 tests |
| `pnpm run test:coverage` | PASS: 141 files / 1774 tests; statements 81.62%, branches 73.39%, functions 83.53%, lines 84.04% |
| `pnpm exec openspec validate add-runtime-readiness-start-center --strict` | PASS |
| `git diff --check` | PASS, LF→CRLF warnings only |

## Accessibility, i18n, performance, and no-side-effect evidence

Automated renderer coverage includes:

- Named major Start Center regions: Readiness checklist, Device candidates, Manual serial
  path, Recent profiles, and Diagnostics.
- Runtime readiness status text for loading/checking, ready, blocked, action-required, and
  unavailable states; status is not color-only.
- Labelled manual serial input with accessible description and disabled reason.
- Keyboard-operable advanced action, manual path, primary observe action, and per-candidate
  review actions.
- Primary observe action does not silently select the first candidate when multiple serial
  candidates exist.
- English and Chinese readiness key coverage for labels, status strings, diagnostics,
  actions, disabled reasons, candidates, and draft messages.
- Dynamic DTO values are rendered through safe label helpers for readiness codes/statuses,
  scopes, confidence values, params, diagnostics, and blockers.
- Reduced-motion-safe loading skeletons use `motion-safe:animate-pulse`.
- Bounded visible rendering for large readiness lists:
  - 8 checks.
  - 6 candidates.
  - 5 profiles.
  - bounded diagnostics/copy list.
- Active sessions keep the terminal as the primary canvas even with a large readiness
  snapshot.
- Start Center render and readiness refresh do not call session create/open, serial write,
  RTT/J-Link, flash/download, install/uninstall, or profile/workspace mutation spies.

## GitNexus PDG / taint / detect_changes evidence

Latest GitNexus index status:

- `node .gitnexus/run.cjs analyze --pdg`
- PASS: 33,697 nodes / 62,287 edges / 489 clusters / 300 flows.

Directed taint checks recorded 0 findings for:

- `src/main/ipc/readiness-ipc.ts`
- `src/main/preload.ts`
- `src/core/readiness/readiness-providers.ts`
- `src/core/readiness/runtime-readiness-service.ts`
- `src/shared/readiness-contract.ts`
- `src/shared/serial-connection-draft.ts`
- `src/renderer/features/readiness/readiness-hydration.ts`

Caveat: GitNexus taint 0 findings is not proof of safety. GitNexus notes that
closure/callback, property/field, implicit/control-dependence, and some sanitizer patterns
are not fully modeled.

Directed PDG checks:

- `src/main/ipc/readiness-ipc.ts`: controls 52 / flows 54.
- `src/main/preload.ts`: controls 4 / flows 57.
- `src/core/readiness/runtime-readiness-service.ts`: controls 23 / flows 81.
- `src/renderer/features/readiness/readiness-hydration.ts`: controls 51 / flows 48.

`detect_changes({ scope: "compare", base_ref: "main" })` result:

- CRITICAL: 43 indexed changed files / 212 changed indexed symbols / 37 affected processes.
- This reflects the cumulative dirty Phase 0 + Phase 1 + Phase 2 + Phase 3 worktree, not a
  Phase 3-only isolated diff.
- The reported affected processes include expected readiness/App/dialog/hydration/runbook
  flows, but also earlier Phase 0–2 surfaces such as control-profile, activity, MCP registry,
  control-workflow, and license-validation work.
- Because no phase commits exist yet and several files carry cumulative cross-phase edits,
  this `detect_changes` result is useful as a regression scope warning, not as a clean
  Phase 3-only proof.

## Known warnings and limits

- Worktree remains intentionally dirty with Phase 0, Phase 1, Phase 2, and Phase 3
  uncommitted changes. Do not reset or clean it.
- `detect_changes(compare main)` remains CRITICAL because all phases are uncommitted in one
  worktree. This limitation is recorded rather than hidden.
- Vite warns about chunks larger than 500 KiB during production build; this is not currently
  configured as a failure.
- `git diff --check` emits LF→CRLF normalization warnings on Windows and exits 0.
- No real hardware side-effect validation was performed.
- Readiness diagnostics are visibly bounded and copy-bounded. The local reducer diagnostic
  history remains append-only; current tests cover bounded rendering/copy, not long-lived
  unbounded runtime accumulation.
- Phase 3 does not complete the First Success journey; that requires Phase 4 Serial First
  Signal with non-empty device text visible after xterm completion acknowledgement.

## Closeout status

Phase 3 Runtime Readiness + Start Center closeout gates are satisfied with the scope caveat
above recorded.

Before any Phase 4 implementation, request and receive explicit user authorization to enter
Phase 4 Serial First Signal. Do not describe Phase 3 as A+D completion.
