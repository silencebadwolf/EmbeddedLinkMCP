# Phase 5 — Human Approval evidence

> **历史证据说明（2026-07-15）**：本文件记录旧版 Human Approval 实现和验证结果。
> 产品负责人已选择 observe-only；运行时审批链已移除，当前行为以
> [`observe-only-ai-execution`](../../openspec/changes/observe-only-ai-execution/proposal.md) 为准。

Date: 2026-07-14

Scope: Phase 5 only (`openspec/changes/add-human-approval`). This is not A+D completion and does not authorize Phase 6.

## What shipped

- Main-only approval authority:
  - `PreparedOperation`, `ApprovalGrant`, `AuthorizationRecord`, `CallerPrincipalId`, effect fingerprints, nonces, and source refs remain in Main/core paths.
  - Renderer/preload receive only display-safe approval DTOs.
- Human approval state machine:
  - `confirm=true` remains caller acknowledgement only.
  - Human approval creates a short-lived one-time grant.
  - Consume requires the same principal, continuation kind, surface, mode, effect fingerprint, manifest digest, and runtime.
  - Replay, wrong consumer, expired grant, and changed effect do not execute backend work.
- MCP high-impact migration:
  - `flash_download`, `flash_write`, `flash_erase`, `cpu_reset`, `gdb_server_start`, `jlink_reboot`, `jlink_commander_script`, `run_control_workflow`, and `restart_mcp_runtime` route through the approval gate in interactive mode.
  - `run_control_workflow` approval binds profile/defaults, plan steps, firmware realpath/hash/size, and workflow execution mode.
  - Oversized high-impact Base64 with `confirm=true` fails before approval preparation.
- Direct Control Profile migration:
  - Initial RUN/START download requests only prepare/request approval.
  - Approved continuation uses the original channel with `{ kind: 'continue-approved', approvalId }`.
  - Renderer reload can hydrate approved-ready direct continuations from Main snapshot.
- Renderer UX:
  - Approval Sheet is assertive, non-stealing, non-modal, keyboard closable, focus-return capable, and queue-selectable.
  - Activity Center distinguishes approval-not-required, caller acknowledgement, client-acknowledged-not-authorized, approved-once-by-user, and future automation labels.
  - EN/ZH labels cover approval actions, risk/surface labels, plan steps including `load_profile`, and Activity authorization labels.

## Fresh validation evidence

Commands run from the repository root:

- `pnpm exec vitest run tests/unit/shared/approval-contract.test.ts tests/unit/core/approval tests/unit/main/ipc/approval-ipc.test.ts tests/unit/main/preload-approval.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/unit/main/ipc/control-profile-approval-gate.test.ts tests/unit/main/ipc/index.test.ts tests/unit/renderer/approval tests/unit/renderer/App.test.tsx tests/unit/renderer/activity tests/unit/fixtures/mock-preload-api.test.ts tests/unit/fixtures/mock-preload-api-approval.test.ts tests/integration/human-approval-mcp.test.ts tests/integration/high-impact-confirmation.test.ts`
  - Passed: 28 files / 215 tests.
- `pnpm run lint`
  - Passed with no ESLint warnings/errors.
- `pnpm run build`
  - Passed. Vite emitted the existing large chunk warning.
- `pnpm run test`
  - Passed: 172 files / 1954 tests.
- `pnpm run test:coverage`
  - Passed: 172 files / 1954 tests.
  - Coverage summary: statements 82.67%, branches 74.20%, functions 84.96%, lines 85.10%.
- `pnpm run validate:licenses`
  - Passed: 19 runtime dependencies and 29 packages in one audited dev-tooling production closure.
- `pnpm audit --prod`
  - Passed: no known vulnerabilities.
- `pnpm exec openspec validate add-human-approval --strict`
  - Passed.
- `git diff --check -- openspec/changes/add-human-approval docs/superpowers/plans/2026-07-14-add-human-approval.md docs/engineering/phase-5-human-approval-evidence.md src tests`
  - Passed after evidence/task updates; only Windows CRLF warnings were printed.
- Extra untracked-file whitespace check using `git diff --no-index --check` against a temporary empty file for:
  - `docs/engineering/phase-5-human-approval-evidence.md`
  - `openspec/changes/add-human-approval/tasks.md`
  - `docs/superpowers/plans/2026-07-14-add-human-approval.md`
  - Passed; only Windows CRLF warnings were printed.

## Review findings and dispositions

Two independent review passes were requested:

- `phase5_req_a11y_review`
- `phase5_security_review`

Valid findings fixed in this pass:

- Approved direct-operation grants disappeared from Main snapshots after Renderer reload.
  - Fixed by projecting approved/unconsumed direct continuations until consumed/expired/superseded.
- Approval `capabilities`/`snapshot` IPC bypassed trusted sender validation.
  - Fixed to fail closed like subscribe/resolve.
- Effect-change continuation superseded the old grant but did not create a new pending approval.
  - Fixed in MCP and direct Control Profile gates.
- Same-consumer supersede could revoke an old approved grant before a replacement request failed rate/capacity preflight.
  - Fixed with staged candidate discovery and preflight before supersede commit.
- Approval Sheet was non-stealing but still declared `aria-modal=true`.
  - Fixed by removing modal declaration and adding internal focus-return capture.
- `load_profile` plan step fell back to raw labels.
  - Fixed with EN/ZH action and step strings.
- Activity lacked an explicit approval-not-required label.
  - Fixed with visible and aria labels in EN/ZH.
- MCP continuation without `confirm=true` returned top-level `APPROVAL_REQUIRED`.
  - Fixed to preserve top-level `CONFIRMATION_REQUIRED`.
- High-impact Base64 could be prepared before a size cap when `confirm=true`.
  - Fixed with approval-gate size guard before preparation.

Known limit:

- There is no separate long-running prepare cancellation API in Phase 5. Prepared approval objects do not retain open file handles after bounded hashing, and release behavior is represented by terminal broker transitions plus no-backend-effect tests.

## No real hardware side effects

No real probe, flash, erase, reset, RTT, GDB server, or serial hardware operation was executed. Hardware-facing checks used fake backends, spies, and in-memory/mock MCP transports.

Evidence includes:

- confirm-only backend call count remains 0 for migrated approval-required MCP/direct paths.
- `approval:resolve` records a decision only and does not call effectful backend methods.
- prepare, denial, wrong consumer, oversized input, replay, expiry, and changed-effect paths keep backend/job counts at 0.
- successful continuation tests use fake backend methods only.

## GitNexus / PDG / taint

Fresh GitNexus evidence:

- `node .gitnexus/run.cjs analyze --pdg`
  - Passed.
  - Incremental analysis reported changed=30, added=2, deleted=0.
  - Indexed successfully in 57.1s: 39,121 nodes / 71,871 edges / 579 clusters / 300 flows.
  - Tool warning observed: Node `DEP0190` for the GitNexus runner child-process invocation. No product-code warning was reported by this command.
- `explain({ repo: "link-mcp" })`
  - Returned 0 persisted taint findings.
- Directed `explain` checks returned 0 persisted taint findings for:
  - `src/main/ipc/approval-ipc.ts`
  - `src/main/preload.ts`
  - `src/core/approval/approval-broker.ts`
  - `src/mcp/registry.ts`
  - `src/main/ipc/control-profile-approval-gate.ts`
  - `src/mcp/approval-gate.ts`
- Directed PDG checks:
  - `pdg_query({ mode: "controls", target: "src/main/ipc/approval-ipc.ts" })`
    - Returned 41 control-dependence results, including guards for malformed request payloads, untrusted sender ids, stale/invalid subscribe state, destroyed senders, and display-safe event parsing failures.
  - `pdg_query({ mode: "flows", target: "src/main/ipc/approval-ipc.ts", variable: "sender" })`
    - Returned 5 reaching-definition results tying `sender` to `isTrustedSender(sender.id)`, subscriber registration/removal, destroyed checks, and event send cleanup.
  - `pdg_query({ mode: "controls", target: "src/core/approval/approval-broker.ts" })`
    - Returned 116 control-dependence results, including guards for pending dedupe, pending/rate/capacity rejection, authorization record append/schema failure, stale revision, not-pending requests, expired grants, wrong consumer, effect changed, consumed replay, and staged supersede.
  - `pdg_query({ mode: "flows", target: "src/core/approval/approval-broker.ts", variable: "grant" })`
    - Returned 4 reaching-definition results tying issued grants to entry storage/return and to consumer/effect matching.
  - `pdg_query({ mode: "flows", target: "src/core/approval/approval-broker.ts", variable: "approvalId" })`
    - Returned 8 reaching-definition results tying approval ids to request creation, pending indexes/queue, expiry records, and authorization records.
  - `pdg_query({ mode: "flows", target: "src/core/approval/approval-broker.ts", variable: "principalId" })`
    - Returned 2 reaching-definition results tying principal ids to rate-limit windows.
  - `pdg_query({ mode: "controls", target: "src/mcp/approval-gate.ts" })`
    - Returned 76 control-dependence results, including guards for missing `confirm=true`, oversized Base64, unknown approval id, continuation mismatch, effect change, headless denial, broker rejection, and consume failure.
  - `pdg_query({ mode: "flows", target: "src/mcp/approval-gate.ts", variable: "approvalId" })`
    - Returned 9 reaching-definition results tying MCP continuation approval ids to lookup, rejection details, and broker `consumeGrant`.
  - `pdg_query({ mode: "flows", target: "src/mcp/approval-gate.ts", variable: "preparedOperation" })`
    - Returned 3 reaching-definition results tying prepared operations to broker request creation and prepared-operation cache insertion.
  - `pdg_query({ mode: "controls", target: "src/main/ipc/control-profile-approval-gate.ts" })`
    - Returned 31 control-dependence results, including guards for missing firmware path, unknown approval id, continuation mismatch, effect change, headless denial, broker rejection, and consume failure.
  - `pdg_query({ mode: "flows", target: "src/main/ipc/control-profile-approval-gate.ts", variable: "preparedOperation" })`
    - Returned 4 reaching-definition results tying direct prepared operations to broker request creation, display-safe argument summary, expiry check, and prepared-operation cache insertion.
  - `pdg_query({ mode: "flows", target: "src/main/ipc/control-profile-approval-gate.ts", variable: "approvalId" })`
    - Returned 0 results; this is consistent with GitNexus' current property/field flow limitation because the direct gate carries the id as `input.approvalId`.
  - `pdg_query({ mode: "flows", target: "toApprovalRequiredFailure", variable: "decision" })`
    - Returned 2 reaching-definition results proving the legacy `CONFIRMATION_REQUIRED` branch remains distinct from `APPROVAL_REQUIRED` in MCP result mapping.
- `detect_changes({ repo: "link-mcp", scope: "compare", base_ref: "main", worktree: "<repo-root>" })`
  - Completed with CRITICAL aggregate risk.
  - Summary: 369 changed symbols / 55 changed files / 50 affected processes.
  - The affected process set spans the expected cumulative Phase 0-5 work, including control-profile IPC, approval projection/snapshot/resolve, renderer App/Activity/Approval UI, readiness/start center, first-success serial flows, runtime/debug MCP handlers, and license/CI characterization scripts.
  - This CRITICAL result is expected for the uncommitted cumulative Phase 0-5 worktree and is not treated as proof of safety; it is a scope-warning requiring the fresh tests/build/lint/license/audit evidence above.

GitNexus taint caveat retained: 0 findings is not a security proof. The persisted taint layer currently does not model closure/callback, property/field, implicit/control-dependence flows, or all sanitizer semantics, so Phase 5 also relies on the targeted approval, IPC, preload, broker, renderer, and MCP tests listed above.
