# Phase 6 J-Link/RTT evidence

> **历史证据说明（2026-07-15）**：本文中的 approval-bound / reflash approval 描述属于旧版
> 路线；当前 J-Link/RTT 操作通过现有校验和 admission 后自动执行，Activity/Audit 仅观察。

Date: 2026-07-14

Scope: Phase 6 only — Workspace/J-Link/RTT download-and-observe, known-good compensation reflash, and profile suggestion integration. This does not complete A+D overall and does not authorize Phase 7.

## Outcome

Phase 6 has fresh local evidence for:

- read-only J-Link/firmware/RTT readiness and Start Center integration;
- display-safe J-Link/RTT draft/review path distinct from serial first-signal;
- approval-bound download/reflash continuation using existing Main trust boundary and job manager seams;
- Main-only compensation candidate/reflash evidence matching;
- display-safe approval artifact projection using hash prefixes only;
- symlink-aware firmware metadata/current-evidence boundary checks;
- reduced-motion-safe control-profile progress UI.

## Review findings resolved

Independent Phase 6 review found five blockers/important issues. They were addressed as follows:

1. Approval DTO leaked internal digests.
   - Removed renderer/preload `plan.manifestDigest`.
   - Replaced artifact `contentSha256` with display-safe `hashSha256Prefix`.
   - Updated Approval Sheet and renderer fixtures to consume only the prefix DTO.

2. Saved firmware readiness followed a workspace symlink outside the workspace.
   - Added realpath boundary validation before reporting firmware metadata ready.
   - Added a unit test that a workspace symlink/junction to an outside firmware returns action-required/no metadata.

3. J-Link candidates entered the serial first-success flow.
   - Added a separate J-Link/RTT review state and panel in `App`.
   - The panel shows display-safe candidate/target details and does not create sessions, start downloads, connect chips, start GDB, connect RTT, reset, erase, or flash.

4. Compensation reflash eligibility was not rechecked against current profile/firmware evidence.
   - `reflashRequest()` now requires matching current evidence.
   - Runtime readiness summaries are disabled on missing/mismatched evidence.
   - Control-profile reflash handler reads current Main-owned evidence before preparing approval.
   - Current evidence reader now also rejects firmware symlinks resolving outside the workspace.

5. Progress animation was not reduced-motion-safe.
   - Control-profile progress bar now uses `motion-safe:transition-[width]` and has a stable `control-profile-progress` test id.

## No hardware side effects

All Phase 6 validation commands used unit/integration tests, fake backends, spies, temp files, mocked IPC, and mock workflow runners. No command executed real flash, erase, reset, probe attach, GDB server, RTT server, serial payload write, or workspace-destructive hardware action.

## Fresh validation evidence

Focused RED/GREEN and affected tests:

- `pnpm exec vitest run tests/unit/shared/approval-contract.test.ts tests/unit/core/compensation/compensation-candidate-service.test.ts tests/unit/main/ipc/index.test.ts tests/unit/renderer/App.start-center.test.tsx tests/unit/renderer/App.test.tsx`
  - Result: 5 files / 56 tests passed.
- `pnpm exec vitest run tests/unit/main/ipc/control-profile-ipc.test.ts tests/unit/renderer/readiness tests/unit/shared/readiness-contract.test.ts tests/unit/mcp/control-workflow-runner-compensation.test.ts tests/unit/mcp/control-workflow-tools.test.ts`
  - Result: 11 files / 128 tests passed.
- `pnpm exec vitest run tests/unit/main/ipc/current-deployment-evidence.test.ts`
  - Result: 1 file / 1 test passed.
- Combined affected rerun:
  - Result: 17 files / 185 tests passed.
- Approval renderer DTO rerun:
  - Result: 3 files / 14 tests passed.

Full quality gates:

- `pnpm run test`
  - Result: 175 files / 1989 tests passed.
- `pnpm run test:coverage`
  - Result: 175 files / 1989 tests passed.
  - Coverage summary: Statements 82.52%, Branches 73.96%, Functions 85.27%, Lines 84.97%.
- `pnpm run lint`
  - Result: passed.
- `pnpm run build`
  - Result: passed.
  - Note: Vite reported the existing large renderer chunk warning.
- `pnpm run validate:licenses`
  - Result: passed; 19 runtime dependencies and 29 packages in 1 audited dev-tooling production closure have valid license entries.
- `pnpm audit --prod`
  - Result: no known vulnerabilities found.
- `pnpm exec openspec validate extend-first-success-jlink-rtt --strict`
  - Result: change is valid.
- `git diff --check -- src tests openspec docs package.json pnpm-lock.yaml`
  - Result: passed; output included LF-to-CRLF working-copy warnings only.

## GitNexus evidence

Index refresh:

- `node .gitnexus/run.cjs analyze`
  - Result: repository indexed successfully.
  - Index: 40,245 nodes / 73,980 edges / 595 clusters / 300 flows.
  - Note: Node DEP0190 warning only.

Upstream impact highlights:

- `App` — LOW; 1 direct caller, 0 affected processes.
- `StatusBar` — LOW; 1 direct caller, affected process `App`, Renderer module direct.
- `ApprovalSheet` — LOW; affected process `App`, Renderer module direct.
- `CompensationCandidateService` — LOW; 1 direct caller, 0 affected processes.
- `createRuntimeReadinessService` — LOW; 1 direct caller, Ipc module direct.
- `readCurrentControlProfileDeploymentEvidence` — LOW after index refresh; 2 direct callers, affected process `registerControlProfileIpc`, Ipc module direct.
- `projectApprovalRequest` was previously HIGH and was reported before edit; the Phase 6 fix narrowed the boundary by removing internal digest fields from renderer projection.

PDG/taint:

- PDG-mode impact was run for:
  - `readCurrentControlProfileDeploymentEvidence` whole-symbol and line 27 realpath boundary.
  - `reflashRequest` whole-symbol and line 161 evidence guard.
  - `projectApprovalRequest` line 835 approval artifact projection.
  - `App` line 214 J-Link candidate branch.
- PDG results are UNKNOWN-risk evidence, not safety proof.
- App line 214 reported a degraded/unresolved lambda projection caveat; this is recorded rather than treated as safe.
- Persisted taint edge checks:
  - `TAINTED` count: 0.
  - `TAINT_PATH` count: 0.
  - Caveat: 0 persisted taint edges/findings is not a proof of security.

`detect_changes`:

- `node .gitnexus/run.cjs detect-changes --repo link-mcp --scope compare --base-ref main`
  - Result: CRITICAL.
  - Changed: 56 files / 428 symbols.
  - Affected execution flows: 52.
  - Interpretation: this is the cumulative uncommitted Phase 0–6 worktree against `main`; it is not a Phase 6-only unexpected scope proof. Review the listed flows before any future commit.

## Known caveats and non-goals

- Phase 6 is not A+D completion. Pause/Take Over and Durable Audit remain future phases.
- No commits, pushes, PRs, real hardware operations, or destructive workspace cleanup were performed.
- Vite chunk-size warning remains informational.
- GitNexus DEP0190 warning remains informational.
- CRITICAL `detect_changes` reflects cumulative dirty worktree scope; it must not be used as a Phase 6-only blast-radius summary.
