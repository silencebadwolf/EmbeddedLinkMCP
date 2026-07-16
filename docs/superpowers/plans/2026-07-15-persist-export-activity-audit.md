# Phase 8 Durable Audit — implementation plan

## Scope and guardrails

Deliver only the Phase 8 durable activity slice. The in-memory `OperationLedger` remains the
runtime projection and authority-adjacent observations remain Main-owned. The new store receives
only `ActivityEventView` after `AuditRedactor`; it never receives drafts, raw arguments,
transcript bytes, credentials, internal approval objects, prepared effects, leases, or
compensation candidates. No database, cloud, telemetry, installer, rollback promise, or real
hardware side effect is allowed.

## Step 1 — contract and characterization

1. Add `src/shared/audit-contract.ts` with strict schemas for the JSONL envelope, status,
   export/clear requests/results, and bounded diagnostics.
2. Add failing tests covering protected-value absence, schema strictness, path privacy, and
   renderer-safe DTOs.
3. Run the focused contract/redactor tests and keep the failure output as TDD evidence.

## Step 2 — core store

1. Add `src/core/activity/audit-store.ts`; use `node:fs/promises`, injectable file operations,
   `now`, and a serial promise queue.
2. Implement initialization/recovery, trailing-line handling, retention, pre-write rotation,
   disabled mode, bounded record loading, POSIX mode 0600, status, `flush`, `clear`, and Main-
   mediated export.
3. Add focused tests for each behavior, including a 10,000-event benchmark with an explicit
   threshold recorded in the test output rather than a global CI timeout.

## Step 3 — Main and IPC boundary

1. Before editing existing symbols, run GitNexus upstream impact on `OperationLedger.subscribe`,
   `registerActivityIpc`, `registerIpcHandlers`, `MainProcessContext`, `IPC_CHANNELS`, `PreloadAPI`,
   `ActivityNamespace`, `preload activity`, `ActivityCenterDrawer`, `App`, and translation tables.
2. Add the store to Main context and subscribe it as a best-effort listener; flush on dispose.
3. Add `activity:status/export/clear` handlers with trusted-sender validation, strict payload
   parsing, and safe result mapping. Renderer never supplies a filesystem path.
4. Extend preload and mock bridge schemas; add malformed-payload and untrusted-sender tests.

## Step 4 — productization

1. Add a bounded audit status panel and explicit export/delete controls to Activity Center.
2. Keep delete behind a confirmation affordance; report success/failure with visible text,
   keyboard semantics, screen-reader labels, and reduced-motion-safe behavior.
3. Add EN/ZH copy and renderer tests for small-window, keyboard, and no-color-only status.

## Step 5 — closeout

1. Request independent code/security/accessibility review; for each valid finding write a failing
   regression test before the minimal fix.
2. Run `pnpm exec openspec validate add-durable-audit --strict` and `--all --strict`.
3. Run focused Phase 8 tests, then full test/coverage, lint, build, licenses, production audit,
   `git diff --check`, verification-before-completion, directed PDG/taint queries, and
   `detect_changes({scope:'compare', base_ref:'main'})`.
4. Record fresh evidence in `openspec/changes/add-durable-audit/tasks.md`; report Phase 8 only.
