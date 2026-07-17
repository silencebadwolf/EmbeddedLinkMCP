# Settle-read send_and_wait Implementation Plan

> **For agentic workers:** implement this plan task-by-task with TDD and run the
> listed verification commands after each task.

**Goal:** Replace marker-gated `send_and_wait` completion with a bounded settle-and-read observation.

**Architecture:** Keep `SessionManager.waitFor` as the transcript/state timing seam. Feed device events through the existing `EchoHandler` and `CompletionDetector`, but use a predicate that never completes early. At the settle boundary, return the collected bytes and marker metadata; only session closure, queue pressure, abort, or write errors remain control failures.

**Tech Stack:** TypeScript, Zod, Vitest, OpenSpec, GitNexus.

---

### Task 1: Lock the new core contract with failing tests

**Files:**
- Modify: `tests/unit/core/terminal-rules/send-and-wait.test.ts`
- Modify: `tests/unit/mcp/terminal-tools.test.ts`

- [x] Write a core test where `completionMarkers: ['NEVER']`, a device event
      arrives, and the result is `success=true`, `reason='settled'`, with the
      response bytes and `hasDeviceOutput=true`.
- [x] Write a core test where the settle timeout fires without a device event;
      assert `success=true`, `hasDeviceOutput=false`, and no
      `markAiUnresponsive` call.
- [x] Write an MCP regression where an unmatched response is returned as
      terminal evidence rather than a `TIMEOUT` error, and a second AI write is
      still accepted without a recovery latch.
- [x] Run `pnpm exec vitest run tests/unit/core/terminal-rules/send-and-wait.test.ts tests/unit/mcp/terminal-tools.test.ts` and record the expected RED failures caused by the old marker-gated contract.

### Task 2: Add settle timing and implement the minimal core behavior

**Files:**
- Modify: `src/shared/constants.ts`
- Modify: `src/core/terminal-rules/types.ts`
- Modify: `src/core/terminal-rules/rules.ts`
- Modify: `src/core/terminal-rules/send-and-wait.ts`

- [x] Add the default settle constant and `defaultSettleMs` rule field.
- [x] Add `settleMs` to args/results and retain deprecated `timeoutMs` alias.
- [x] Change the wait predicate to feed device bytes and always return false.
- [x] Treat the wait timeout as the normal settle outcome; return filtered bytes,
      `hasDeviceOutput`, and optional marker index without calling
      `markAiUnresponsive`.
- [x] Run the focused core test and confirm GREEN.

### Task 3: Expose the compatibility contract through MCP

**Files:**
- Modify: `src/mcp/surfaces/terminal/schemas.ts`
- Modify: `src/mcp/surfaces/terminal/tools.ts`
- Modify: `src/mcp/surfaces/agent-runbook/runbook.ts`
- Modify: `tests/unit/mcp/terminal-tools.test.ts`

- [x] Add `settleMs`, keep `timeoutMs` as a deprecated alias, and forward the
      precedence rule to core.
- [x] Update tool description and evidence serialization for `settled`, output,
      and `hasDeviceOutput`.
- [x] Remove the timeout-to-`DEVICE_UNRESPONSIVE` guidance for this path; tell
      callers to inspect output/status before deciding whether to send again.
- [x] Run the focused MCP/terminal tests and `pnpm exec tsc -b --pretty false`.

### Task 4: Full verification and scope review

**Files:**
- Verify all changed files; no unrelated edits.

- [x] Run `pnpm exec vitest run tests/unit/core/terminal-rules/send-and-wait.test.ts tests/unit/mcp/terminal-tools.test.ts`.
- [x] Run `pnpm run lint`, `pnpm run build`, `pnpm run test`, and
      `pnpm run validate:licenses`.
- [x] Run `openspec validate --all`.
- [x] Run GitNexus `detect_changes({scope:'unstaged'})` and confirm only the
      settle-read symbols/processes are affected; run targeted PDG/taint review
      or record if the local index lacks the PDG layer.
- [x] Review the final diff and report fresh evidence without committing or
      pushing.
