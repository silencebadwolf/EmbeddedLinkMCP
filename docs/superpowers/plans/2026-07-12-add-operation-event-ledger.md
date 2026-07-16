# LinkTerm Operation Event Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-governance:subagent-driven-development` (recommended) or `agent-governance:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Phase 1's bounded, in-memory, display-safe Operation/CallAttempt ledger across supported Main-owned MCP paths and workflow jobs without changing existing business, confirmation, transport, hardware, or authorization behavior.

**Architecture:** Electron Main creates one health monitor, ledger, and recorder and shares them with the long-lived direct MCP server, every short-lived HTTP request server, the shared `ControlWorkflowJobManager`, and a narrow activity IPC bridge. Internal retained events and reducers remain under `src/core/activity/`; only strict allowlisted view schemas cross preload. Registry and JobManager instrumentation are optional, synchronous/no-throw observation seams, so observation failure cannot change a handler result, backend count, job state, or current acknowledgement semantics.

**Tech Stack:** Electron 42, TypeScript 6, Zod 4, MCP SDK 1.29, Node `AsyncLocalStorage`/`util.types.isProxy`, Vitest 4.1.8, V8 coverage, pnpm 9.15, OpenSpec, GitNexus PDG/taint.

---

## Scope and execution rules

- This plan implements only `openspec/changes/add-operation-event-ledger`. It does not add the Activity Center UI/store, Readiness/Start Center, First Signal, approval continuation, grants, Pause/Take Over, JSONL persistence, export, retention, telemetry, cloud services, databases, or rollback promises.
- All serial, J-Link, flash, erase, reset, GDB, RTT, terminal-write, and other effectful dependencies stay fake, mocked, or uncalled. Do not run `pnpm start`, `doctor:jlink`, or any real hardware command.
- Preserve the current MCP result envelopes, current `confirm` acknowledgement gates, `SessionManager`, `WriteQueue`, transports, `IJLinkBackend`, managers, and Main trust boundary. Operation ids and call ids remain out-of-band.
- The supported Phase 1 production surface is Electron Main's direct server plus its localhost HTTP owner and stdio proxy. `src/mcp/stdio-entry.ts` remains an explicitly unsupported legacy/non-default entry and is not instrumented.
- Existing dirty-worktree content belongs to the user. Do not reset, clean, discard, or broadly format it.
- The user has not authorized commit, push, PR creation, OpenSpec archive, or hardware side effects. Each task ends with a diff/test checkpoint, not a commit.
- Before editing any existing function, class, method, interface, or shared object, run fresh GitNexus upstream impact for that exact symbol. Report every HIGH/CRITICAL result before the edit. New files do not waive impact analysis for existing integration symbols.

## Frozen contracts

- `schemaVersion` is `1.0.0`; `(runtimeId, sequence)` is the only ordering key.
- Internal retained variants are exactly `operation-transition`, `call-transition`, and `workflow-milestone`.
- The Operation reducer and CallAttempt reducer are disjoint. A milestone may update progress on an existing workflow Operation but cannot carry or change a phase.
- Default limits are 5,000 retained events, 1,000 tracked Operations, 2,000 tracked CallAttempts, 16 KiB per projected event, and 16 MiB deterministically accounted total activity state.
- `droppedEventCount` counts candidate events that never entered storage. `evictedEventCount` counts previously retained events removed by committed prefix eviction. Neither is a cursor.
- `incompleteLifecycleCount` is a current gauge: wrapper entry increments it; the first finish-once terminal decision decrements it exactly once; retention and eviction do not affect it.
- A terminal is queryable exactly once only while its accepted terminal event is retained. Finish-once terminal decision remains guaranteed independently of retention.
- A Main-owned MCP call uses actor `agent`/channel `local-mcp`. An MCP child job uses surface `workflow`, action `control-workflow.job`, risk `destructive-or-unknown`, policy `human-once`. A direct START_DOWNLOAD job uses actor `human`, surface `control-profile`, action `control-profile.download-job`, the same risk/policy. Both use `authorizationSource: none`.
- `confirm: true` may produce `clientAcknowledged: true`; it never produces or implies human approval.

## File structure

### New production files

- `src/shared/activity-contract.ts` — strict display-safe Zod contracts, inferred readonly types, and runtime parsers used by Main/preload.
- `src/core/activity/activity-event.ts` — internal draft/retained union and explicit internal-to-view mapper.
- `src/core/activity/operation-state.ts` — pure Operation/CallAttempt reducers, adjacency tables, milestone reduction, and runtime-end classifier.
- `src/core/activity/activity-health.ts` — non-recursive bounded health counters and lifecycle gauge.
- `src/core/activity/safe-observation-value.ts` — Proxy/accessor-safe own-data-path reader shared by policy and redaction.
- `src/core/activity/risk-policy.ts` — typed 63-tool observation policy and conservative resolution.
- `src/core/activity/audit-redactor.ts` — allowlist-first bounded projection with Proxy/accessor rejection.
- `src/core/activity/operation-ledger.ts` — atomic bounded ledger, cursor validation, snapshots, and subscribers.
- `src/core/activity/operation-recorder.ts` — MCP recording handles, finish-once logic, trusted parent context, and workflow-job projection.
- `src/core/activity/index.ts` — narrow Main/MCP exports only.
- `src/main/ipc/activity-ipc.ts` — strict subscribe/snapshot/unsubscribe/event bridge and webContents cleanup.

### Existing production files to modify narrowly

- `src/mcp/registry.ts` — optional server-scoped recorder provider and full callback-boundary instrumentation.
- `src/mcp/server.ts` — attach the shared recorder provider once per `McpServer`.
- `src/mcp/surfaces/control-workflow/job-manager.ts` — detached immutable observation envelope and post-commit observer funnel.
- `src/mcp/surfaces/control-workflow/tools.ts` — pass trusted `agent` metadata at the one background create call.
- `src/main/ipc/control-profile-ipc.ts` — pass trusted `human` metadata at the one START_DOWNLOAD create call.
- `src/main/ipc/index.ts` — create and share one ledger/recorder, register activity IPC, expose only the ledger in `MainProcessContext`.
- `src/shared/ipc-protocol.ts` — add four activity channels.
- `src/shared/preload-api.ts` — type-only Activity namespace; no runtime Zod import.
- `src/main/preload.ts` — activity-specific response/event runtime parsing.
- `tests/fixtures/mock-preload-api.ts` — activity namespace spies/emitter for renderer tests; no Activity Center state.
- `README.md` — document supported Main/HTTP/stdio-proxy topology and legacy entry exclusion.

### New tests

- `tests/unit/shared/activity-contract.test.ts`
- `tests/unit/core/activity/activity-event.test.ts`
- `tests/unit/core/activity/operation-state.test.ts`
- `tests/unit/core/activity/activity-health.test.ts`
- `tests/unit/core/activity/risk-policy.test.ts`
- `tests/unit/core/activity/audit-redactor.test.ts`
- `tests/unit/core/activity/operation-ledger.test.ts`
- `tests/unit/core/activity/operation-recorder.test.ts`
- `tests/unit/main/ipc/activity-ipc.test.ts`
- `tests/unit/main/preload-activity.test.ts`
- `tests/integration/operation-ledger-mcp.test.ts`

## Task 0: Fresh graph gates and behavior baseline

**Files:**

- Read: `.gitnexusrc`
- Read: `docs/security/gitnexus-governance.md`
- Read: all existing files listed above
- No file edits

- [x] **Step 1: Confirm index and worktree facts**

Run:

```powershell
git rev-parse HEAD
git status --short
Get-Content -Raw .gitnexusrc
node .gitnexus/run.cjs status
```

Expected: PDG remains enabled, the worktree includes the preserved Phase 0/A+D changes, and no command mutates the repository. If the index commit is stale, run `node .gitnexus/run.cjs analyze --pdg` before relying on graph results.

- [x] **Step 2: Run upstream impact for every planned existing symbol**

Resolve each symbol with GitNexus `context` first, then run upstream `impact` with the unqualified indexed name plus `file_path` and `kind`. Do not use TypeScript-style qualified names such as `ControlWorkflowJobManager.create`, because the current index does not resolve them. Use these executable targets:

```text
{ target: "registerTool", file_path: "src/mcp/registry.ts", kind: "Function" }
{ target: "setRuntimeDiagnosticsProvider", file_path: "src/mcp/registry.ts", kind: "Function" }
{ target: "createMcpServer", file_path: "src/mcp/server.ts", kind: "Function" }
{ target: "CreateMcpServerOptions", file_path: "src/mcp/server.ts", kind: "Interface" }
{ target: "ControlWorkflowJobManager", file_path: "src/mcp/surfaces/control-workflow/job-manager.ts", kind: "Class" }
{ target: "ControlWorkflowJobManagerOptions", file_path: "src/mcp/surfaces/control-workflow/job-manager.ts", kind: "Interface" }
{ target: "CreateControlWorkflowJobInput", file_path: "src/mcp/surfaces/control-workflow/job-manager.ts", kind: "Interface" }
{ target: "ControlWorkflowJobRecord", file_path: "src/mcp/surfaces/control-workflow/job-manager.ts", kind: "Interface" }
{ target: "constructor", file_path: "src/mcp/surfaces/control-workflow/job-manager.ts", kind: "Constructor" }
{ target: "create", file_path: "src/mcp/surfaces/control-workflow/job-manager.ts", kind: "Method" }
{ target: "start", file_path: "src/mcp/surfaces/control-workflow/job-manager.ts", kind: "Method" }
{ target: "update", file_path: "src/mcp/surfaces/control-workflow/job-manager.ts", kind: "Method" }
{ target: "cancel", file_path: "src/mcp/surfaces/control-workflow/job-manager.ts", kind: "Method" }
{ target: "registerControlWorkflowTools", file_path: "src/mcp/surfaces/control-workflow/tools.ts", kind: "Function" }
{ target: "registerControlProfileIpc", file_path: "src/main/ipc/control-profile-ipc.ts", kind: "Function" }
{ target: "registerIpcHandlers", file_path: "src/main/ipc/index.ts", kind: "Function" }
{ target: "MainProcessContext", file_path: "src/main/ipc/index.ts", kind: "Interface" }
{ target: "PreloadAPI", file_path: "src/shared/preload-api.ts", kind: "Interface" }
```

`update` currently has multiple indexed candidates. Resolve it first with:

```text
context({
  name: "update",
  file_path: "src/mcp/surfaces/control-workflow/job-manager.ts",
  kind: "Method",
  repo: "link-mcp"
})
```

Then pass the returned exact UID, for example `Method:src/mcp/surfaces/control-workflow/job-manager.ts:ControlWorkflowJobManager.update#2`, as `target_uid` while retaining `target: "update"` in the upstream impact call. Apply the same context-to-UID procedure whenever any target remains ambiguous.

Resolve these index-sensitive symbols by `context({ name, file_path, repo: "link-mcp" })` and run impact with their returned UID rather than guessing a qualified name or kind. Every UID-based impact call must still supply the schema-required `target: resolved.name` together with `target_uid`:

```text
markRunning or #markRunning in src/mcp/surfaces/control-workflow/job-manager.ts
markTerminal or #markTerminal in src/mcp/surfaces/control-workflow/job-manager.ts
markCancelled or #markCancelled in src/mcp/surfaces/control-workflow/job-manager.ts
handler for the background run_control_workflow callback in src/mcp/surfaces/control-workflow/tools.ts
dispose in src/main/ipc/index.ts
IPC_CHANNELS in src/shared/ipc-protocol.ts
api in src/main/preload.ts
```

The current GitNexus index excludes `tests/fixtures/mock-preload-api.ts`; neither `MockPreloadAPI`, `createMockPreloadAPI`, nor the fixture file resolves. Reindex first. If all three still return not-found, record both fixture symbols as `UNKNOWN`; GitNexus cannot provide symbol/file impact for this excluded fixture. Use `rg` to enumerate every import and call consumer, include the HIGH/CRITICAL-aware `PreloadAPI` impact above, and run the fixture plus relevant preload/renderer tests as explicit substitute evidence. Do not interpret not-found, exclusion, or zero results as low risk.

Every impact call uses `direction: "upstream"` and `repo: "link-mcp"`. Also run impact for any additional existing symbol selected during implementation before its first edit. Record direct callers, affected processes, affected modules, and risk. The currently known shared seams are HIGH for `registerTool`, `ControlWorkflowJobManager`, and `PreloadAPI`; report fresh HIGH/CRITICAL output to the user and wait for that warning to be visible before editing.

- [x] **Step 3: Run the Phase 0 characterization baseline**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry.test.ts tests/unit/mcp/registry-sdk-boundary.test.ts tests/unit/main/ipc/session-create.test.ts tests/unit/mcp/terminal-tools.test.ts tests/unit/core/session-manager.test.ts tests/unit/mcp/control-workflow-job-manager.test.ts tests/integration/high-impact-confirmation.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/mcp/runtime-control-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/unit/mcp/tool-risk-inventory.test.ts
```

Expected: all selected files pass before Phase 1 product edits. Save file/test counts as the parity baseline.

- [x] **Step 4: Add the missing recorder-disabled runtime diagnostics throw characterization first**

Extend `tests/unit/mcp/registry.test.ts` with this exact behavior before any registry instrumentation:

```ts
it('preserves a runtime diagnostics provider throw before handler admission', async () => {
  const { server, tools } = fakeServer();
  const failure = new Error('runtime diagnostics unavailable');
  const handler = vi.fn();
  registerTool(server, {
    name: 'runtime_throw',
    description: 'runtime throw characterization',
    sensitivity: 'state-affecting',
    inputSchema: schema,
    runtimeDiagnostics: () => {
      throw failure;
    },
    handler: () => {
      handler();
      return { success: true, evidence: { kind: 'app_status', data: {}, cursor: 0 } };
    },
  });

  await expect(tools[0]!.callback({})).rejects.toBe(failure);
  expect(handler).not.toHaveBeenCalled();
});
```

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry.test.ts -t "runtime diagnostics provider throw"
```

Expected: PASS against existing behavior. This is characterization, not a product behavior change.

## Task 1: Strict display contracts and explicit event projection

**Files:**

- Create: `src/shared/activity-contract.ts`
- Create: `src/core/activity/activity-event.ts`
- Create: `src/core/activity/index.ts`
- Create: `tests/unit/shared/activity-contract.test.ts`
- Create: `tests/unit/core/activity/activity-event.test.ts`

- [x] **Step 1: Write failing strict-contract tests**

Build a reusable valid event fixture with all mandatory fields:

```ts
const base = {
  schemaVersion: '1.0.0' as const,
  runtimeId: 'runtime_1',
  sequence: 1,
  eventId: 'event_1',
  timestamp: '2026-07-12T00:00:00.000Z',
  operationId: 'operation_1',
  actor: { kind: 'agent' as const, channel: 'local-mcp' as const },
  surface: 'runtime' as const,
  action: 'get_app_status',
  risk: 'read-only' as const,
  approvalPolicy: 'none' as const,
  authorizationSource: 'none' as const,
  targets: [{ kind: 'runtime' as const, id: 'runtime_1', label: 'current-runtime' }],
};
```

Tests must assert:

```ts
expect(
  ActivityEventViewSchema.parse({
    ...base,
    kind: 'operation-transition',
    operationPhase: 'requested',
  }),
).toBeDefined();

expect(
  ActivityEventViewSchema.safeParse({
    ...base,
    kind: 'call-transition',
    callId: 'call_1',
    callPhase: 'received',
    operationPhase: 'running',
  }).success,
).toBe(false);

expect(
  ActivityEventViewSchema.safeParse({
    ...base,
    kind: 'workflow-milestone',
    operationPhase: 'running',
    progress: {
      current: 1,
      total: 2,
      percent: 50,
      messageCode: 'workflow.progress',
      evidenceRefs: [],
    },
  }).success,
).toBe(false);
```

Cover all three variants, all mandatory common metadata, non-empty bounded targets, active Operation/CallAttempt views, empty/current/reset snapshots, invalid/future cursor shapes, unknown nested keys, excessive depth/length, unsupported values, and immutable parsed output. Reject Windows absolute/drive-relative paths, POSIX absolute paths, UNC paths, path separators, `.`/`..`, and control characters in target labels and basename summary values. Reject arbitrary failure-envelope text, including seeded credential/path fixtures; only the three stable activity failure messages below are accepted. Assert `Object.isFrozen` for the event, actor, targets array, each target, argument summary/items, progress, and evidence-ref arrays, then prove nested assignment/push attempts cannot alter serialized output.

- [x] **Step 2: Run the contract tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/shared/activity-contract.test.ts tests/unit/core/activity/activity-event.test.ts
```

Expected: FAIL because `@/shared/activity-contract.js` and `@/core/activity/activity-event.js` do not exist.

- [x] **Step 3: Implement the strict shared schema surface**

`src/shared/activity-contract.ts` must export these exact schema/type names:

```ts
export const ACTIVITY_SCHEMA_VERSION = '1.0.0' as const;
export const OperationRiskSchema = z.enum([
  'read-only',
  'state-affecting',
  'disruptive',
  'destructive-or-unknown',
]);
export const ApprovalPolicySchema = z.enum(['none', 'notify', 'human-once']);
export const OperationPhaseSchema = z.enum([
  'requested',
  'awaiting-approval',
  'blocked',
  'queued',
  'running',
  'cancel-requested',
  'succeeded',
  'failed',
  'rejected',
  'denied',
  'expired',
  'superseded',
  'cancelled',
  'interrupted',
]);
export const CallAttemptPhaseSchema = z.enum([
  'received',
  'approval-required',
  'rejected',
  'started',
  'succeeded',
  'failed',
]);
export const ActivityFailureStageSchema = z.enum([
  'provider',
  'policy',
  'redaction',
  'schema',
  'reducer',
  'capacity',
  'response-construction',
  'response-serialization',
  'runtime-precondition',
  'listener',
  'ipc',
]);
export const ActivitySurfaceSchema = z.enum([
  'runtime',
  'control-profile',
  'workflow',
  'debug',
  'terminal',
  'ui',
  'workspace',
]);
export const ActivityIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const OperationActorSchema = z
  .object({
    kind: z.enum(['agent', 'human', 'system']),
    channel: z.enum(['local-mcp', 'desktop', 'main']),
  })
  .strict()
  .readonly();
export const OperationTargetRefSchema = z
  .object({
    kind: z.enum(['runtime', 'session', 'workspace', 'probe', 'file', 'ui', 'job']),
    id: ActivityIdSchema,
    label: DisplaySafeLabelSchema.optional(),
  })
  .strict()
  .readonly();
export const EvidenceRefSchema = z
  .object({
    kind: z.enum(['transcript-cursor', 'job-step', 'artifact-digest']),
    id: ActivityIdSchema,
    cursorStart: z.number().int().nonnegative().safe().optional(),
    cursorEnd: z.number().int().nonnegative().safe().optional(),
  })
  .strict()
  .readonly();
```

Continue with these fixed bounds and closed shapes; do not choose different constants during implementation:

```ts
export const ACTIVITY_MAX_ACTION_LENGTH = 128;
export const ACTIVITY_MAX_LABEL_LENGTH = 128;
export const ACTIVITY_MAX_TARGETS = 8;
export const ACTIVITY_MAX_SUMMARY_ITEMS = 16;
export const ACTIVITY_MAX_SUMMARY_KEY_LENGTH = 64;
export const ACTIVITY_MAX_EVIDENCE_REFS = 8;
export const ACTIVITY_MAX_SNAPSHOT_EVENTS = 5_000;
export const ACTIVITY_MAX_SNAPSHOT_OPERATIONS = 1_000;
export const ACTIVITY_MAX_SNAPSHOT_CALLS = 2_000;

const SafeCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const SafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const DisplaySafeLabelSchema = z
  .string()
  .min(1)
  .max(ACTIVITY_MAX_LABEL_LENGTH)
  .regex(/^(?![A-Za-z]:)(?!\.{1,2}$)[^\u0000-\u001f\u007f/\\]+$/u);
const DigestSchema = z
  .object({
    algorithm: z.literal('sha256'),
    basis: z.enum(['utf8', 'bytes']),
    hex: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict()
  .readonly();

const ActivityArgumentItemSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('identifier'),
      key: SafeCodeSchema.max(ACTIVITY_MAX_SUMMARY_KEY_LENGTH),
      value: SafeCodeSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal('basename'),
      key: SafeCodeSchema.max(ACTIVITY_MAX_SUMMARY_KEY_LENGTH),
      value: DisplaySafeLabelSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal('number'),
      key: SafeCodeSchema.max(ACTIVITY_MAX_SUMMARY_KEY_LENGTH),
      value: z.number().finite(),
    })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal('boolean'),
      key: SafeCodeSchema.max(ACTIVITY_MAX_SUMMARY_KEY_LENGTH),
      value: z.boolean(),
    })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal('content-metadata'),
      key: SafeCodeSchema.max(ACTIVITY_MAX_SUMMARY_KEY_LENGTH),
      contentType: z.enum(['script', 'binary', 'firmware', 'screenshot', 'terminal', 'memory']),
      byteLength: SafeIntegerSchema,
      lineCount: SafeIntegerSchema.optional(),
      digest: DigestSchema.optional(),
    })
    .strict()
    .readonly(),
  z
    .object({
      kind: z.literal('omitted'),
      key: SafeCodeSchema.max(ACTIVITY_MAX_SUMMARY_KEY_LENGTH),
      category: z.enum(['protected', 'unsupported', 'oversized']),
    })
    .strict()
    .readonly(),
]);

export const ActivityArgumentSummarySchema = z
  .object({
    fieldCount: SafeIntegerSchema,
    items: z.array(ActivityArgumentItemSchema).max(ACTIVITY_MAX_SUMMARY_ITEMS).readonly(),
  })
  .strict()
  .readonly();

export const ActivitySafeErrorSchema = z
  .object({
    code: SafeCodeSchema.max(64),
    messageCode: SafeCodeSchema,
    stage: ActivityFailureStageSchema,
  })
  .strict()
  .readonly();

export const OperationProgressSchema = z
  .object({
    current: SafeIntegerSchema,
    total: SafeIntegerSchema.refine((value) => value > 0),
    percent: z.number().finite().min(0).max(100),
    stepId: SafeCodeSchema.max(64).optional(),
    messageCode: SafeCodeSchema.optional(),
    evidenceRefs: z.array(EvidenceRefSchema).max(ACTIVITY_MAX_EVIDENCE_REFS).readonly(),
  })
  .strict()
  .readonly();

export const ActivityCursorSchema = z
  .object({ runtimeId: ActivityIdSchema, sequence: SafeIntegerSchema })
  .strict()
  .readonly();

const ActivityCommonShape = {
  schemaVersion: z.literal(ACTIVITY_SCHEMA_VERSION),
  runtimeId: ActivityIdSchema,
  sequence: SafeIntegerSchema,
  eventId: ActivityIdSchema,
  timestamp: z.string().datetime({ offset: true }),
  operationId: ActivityIdSchema,
  parentOperationId: ActivityIdSchema.optional(),
  actor: OperationActorSchema,
  surface: ActivitySurfaceSchema,
  action: SafeCodeSchema.max(ACTIVITY_MAX_ACTION_LENGTH),
  risk: OperationRiskSchema,
  approvalPolicy: ApprovalPolicySchema,
  authorizationSource: z.literal('none'),
  clientAcknowledged: z.boolean().optional(),
  targets: z.array(OperationTargetRefSchema).min(1).max(ACTIVITY_MAX_TARGETS).readonly(),
  argumentSummary: ActivityArgumentSummarySchema.optional(),
  error: ActivitySafeErrorSchema.optional(),
} as const;

export const ActivityEventViewSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...ActivityCommonShape,
      kind: z.literal('operation-transition'),
      operationPhase: OperationPhaseSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      ...ActivityCommonShape,
      kind: z.literal('call-transition'),
      callId: ActivityIdSchema,
      callPhase: CallAttemptPhaseSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      ...ActivityCommonShape,
      kind: z.literal('workflow-milestone'),
      progress: OperationProgressSchema,
    })
    .strict()
    .readonly(),
]);

export const OperationViewSchema = z
  .object({
    ...ActivityCommonShape,
    operationPhase: OperationPhaseSchema,
    updatedSequence: SafeIntegerSchema,
    progress: OperationProgressSchema.optional(),
  })
  .strict()
  .readonly();
export const CallAttemptViewSchema = z
  .object({
    ...ActivityCommonShape,
    callId: ActivityIdSchema,
    callPhase: CallAttemptPhaseSchema,
    updatedSequence: SafeIntegerSchema,
  })
  .strict()
  .readonly();

export const ActivityHealthSchema = z
  .object({
    captureFailureCount: SafeIntegerSchema,
    droppedEventCount: SafeIntegerSchema,
    evictedEventCount: SafeIntegerSchema,
    listenerFailureCount: SafeIntegerSchema,
    policyFailureCount: SafeIntegerSchema,
    incompleteLifecycleCount: SafeIntegerSchema,
    lastFailure: z
      .object({
        stage: ActivityFailureStageSchema,
        code: SafeCodeSchema.max(64),
        timestamp: z.string().datetime({ offset: true }),
      })
      .strict()
      .readonly()
      .optional(),
  })
  .strict()
  .readonly();

export const ActivitySnapshotViewSchema = z
  .object({
    schemaVersion: z.literal(ACTIVITY_SCHEMA_VERSION),
    cursor: ActivityCursorSchema,
    oldestAvailable: ActivityCursorSchema.optional(),
    truncated: z.boolean(),
    resetRequired: z.boolean(),
    events: z.array(ActivityEventViewSchema).max(ACTIVITY_MAX_SNAPSHOT_EVENTS).readonly(),
    operations: z.array(OperationViewSchema).max(ACTIVITY_MAX_SNAPSHOT_OPERATIONS).readonly(),
    calls: z.array(CallAttemptViewSchema).max(ACTIVITY_MAX_SNAPSHOT_CALLS).readonly(),
    health: ActivityHealthSchema,
  })
  .strict()
  .readonly();

export const ActivityCursorRequestSchema = z
  .object({ cursor: ActivityCursorSchema.optional() })
  .strict()
  .readonly();
export const ActivityUnsubscribeRequestSchema = z.object({}).strict().readonly();
const ActivityFailureResultSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: SafeCodeSchema.max(64),
        message: z.enum([
          'Invalid activity request',
          'Invalid activity cursor',
          'Invalid activity payload',
        ]),
      })
      .strict(),
  })
  .strict();
export const ActivitySnapshotResultSchema = z.union([
  z.object({ success: z.literal(true), data: ActivitySnapshotViewSchema }).strict(),
  ActivityFailureResultSchema,
]);
export const ActivityUnsubscribeResultSchema = z.union([
  z
    .object({
      success: z.literal(true),
      data: z.object({ unsubscribed: z.literal(true) }).strict(),
    })
    .strict(),
  ActivityFailureResultSchema,
]);
```

Export readonly inferred types using the same base names without `Schema`. Tests must confirm the bounds above, including unknown-key rejection at every nested level.

- [x] **Step 4: Implement the internal union and no-spread mapper**

`src/core/activity/activity-event.ts` must define the internal-only fields separately and export:

```ts
export type ActivityEventDraft =
  | OperationTransitionDraft
  | CallTransitionDraft
  | WorkflowMilestoneDraft;
export const ActivityEventDraftSchema: z.ZodType<ActivityEventDraft>;

export type RetainedActivityEvent =
  | RetainedOperationTransition
  | RetainedCallTransition
  | RetainedWorkflowMilestone;
export const RetainedActivityEventSchema: z.ZodType<RetainedActivityEvent>;

export function toActivityEventView(event: RetainedActivityEvent): ActivityEventView;
export function projectedEventByteLength(event: RetainedActivityEvent): number;
```

The mapper must construct common and variant fields explicitly. It must not use `{ ...event }`, and internal `policyVersion`, argument digests, raw failure classification, accounting fields, and health references must not be members of the returned object. Parse the constructed object through `ActivityEventViewSchema`, freeze/detach it, and use `Buffer.byteLength(JSON.stringify(view), 'utf8')` for the projected byte count.

- [x] **Step 5: Run strict-contract tests and confirm GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/shared/activity-contract.test.ts tests/unit/core/activity/activity-event.test.ts
```

Expected: both files pass; mutation and undeclared-key cases are rejected; serialized views contain no internal fixture values.

## Task 2: Separate reducers and future-state fixtures

**Files:**

- Create: `src/core/activity/operation-state.ts`
- Create: `tests/unit/core/activity/operation-state.test.ts`

- [x] **Step 1: Write table-driven reducer tests**

Use these exact adjacency tables as the test truth:

```ts
const operationEdges = {
  requested: ['awaiting-approval', 'blocked', 'queued', 'running', 'rejected'],
  'awaiting-approval': ['blocked', 'queued', 'running', 'denied', 'expired', 'superseded'],
  blocked: ['queued', 'running', 'expired', 'superseded'],
  queued: ['running', 'cancel-requested', 'succeeded', 'failed', 'cancelled', 'interrupted'],
  running: ['cancel-requested', 'succeeded', 'failed', 'cancelled', 'interrupted'],
  'cancel-requested': ['succeeded', 'failed', 'cancelled', 'interrupted'],
} as const;

const callEdges = {
  received: ['approval-required', 'rejected', 'started'],
  started: ['succeeded', 'failed'],
} as const;
```

Generate allowed/denied Cartesian assertions, then cover first accepted `call-transition` binding, changed association rejection, duplicate event id, second terminal rejection, Operation/Call reducer isolation, milestone progress without phase, reverse timestamps with forward sequence, and terminal immutability. Prove later schema-valid Operation/Call transitions cannot overwrite first-bound `schemaVersion`, runtime/operation/call identity, parent identity, actor, surface, action, risk, approval policy, authorization source, caller acknowledgement, targets, or argument summary; only phase, latest event sequence/id/timestamp, `updatedSequence`, and the current safe error come from an ordinary later transition, while Operation progress survives until a milestone replaces it. Include an escalation fixture in which a later transition attempts to relabel an ordinary Operation as `workflow/control-workflow.job` and prove a following milestone is still rejected. Assert a milestone is accepted only for `workflow/control-workflow.job` or `control-profile/control-profile.download-job`, rejects ordinary `run_control_workflow` and every terminal Operation with stable codes, and cannot change action/surface. Lock runtime-end mapping state by state: `requested -> rejected/runtime-ended-before-admission`; `awaiting-approval` and `blocked -> expired/runtime-restart`; `queued`, `running`, and `cancel-requested -> interrupted/runtime-restart`; existing terminal Operations produce no recovery transition.

Add one synthetic fixture that proves:

```text
Call A: received -> approval-required; Operation: requested -> awaiting-approval
Call B: received -> approval-required; same Operation remains awaiting-approval
Call C: received -> started -> succeeded; Operation: queued -> running -> succeeded
Concurrent approved retry: the synthetic fixture, not an assertion-local branch, owns a server-issued opaque Operation reference and one-shot retry-selection state; submitting two contenders through that fixture API produces at most one execution decision and rejects losing attempts without changing the winner
Resolution without retry: no queued/running/execution terminal; assert each forbidden phase is absent rather than negating one aggregate matcher
Paused approval: blocked until synthetic resume/revalidation
TTL: expired without started call
New semantic intent: old Operation superseded
confirm false then true in current production shape: two server-generated Operations
```

- [x] **Step 2: Run reducer tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/core/activity/operation-state.test.ts
```

Expected: FAIL because reducer exports do not exist.

- [x] **Step 3: Implement pure reducer APIs**

Export this public core shape:

```ts
export interface ActivityReductionState {
  readonly operations: ReadonlyMap<string, OperationStateRecord>;
  readonly calls: ReadonlyMap<string, CallAttemptStateRecord>;
  /** Event ids in the current retained window only; prefix eviction removes them atomically. */
  readonly acceptedEventIds: ReadonlySet<string>;
}

export type ReductionFailureCode =
  | 'duplicate-event-id'
  | 'unknown-operation'
  | 'call-operation-mismatch'
  | 'illegal-operation-transition'
  | 'illegal-call-transition'
  | 'terminal-operation'
  | 'terminal-call'
  | 'milestone-non-workflow'
  | 'milestone-phase-change';

export type ReductionResult =
  | { readonly ok: true; readonly state: ActivityReductionState }
  | { readonly ok: false; readonly code: ReductionFailureCode };

export function createEmptyReductionState(): ActivityReductionState;
export function reduceActivityEvent(
  state: ActivityReductionState,
  event: RetainedActivityEvent,
): { ok: true; state: ActivityReductionState } | { ok: false; code: ReductionFailureCode };
export function classifyOperationsAtRuntimeEnd(
  state: ActivityReductionState,
): ReadonlyArray<
  | { operationId: string; phase: 'rejected'; reason: 'runtime-ended-before-admission' }
  | { operationId: string; phase: 'expired'; reason: 'runtime-restart' }
  | { operationId: string; phase: 'interrupted'; reason: 'runtime-restart' }
>;
```

Implement reduction with this closed dispatch; helper failures return the listed `ReductionFailureCode` and never mutate the input state:

```ts
const OPERATION_TERMINALS = new Set<OperationPhase>([
  'succeeded',
  'failed',
  'rejected',
  'denied',
  'expired',
  'superseded',
  'cancelled',
  'interrupted',
]);
const CALL_TERMINALS = new Set<CallAttemptPhase>([
  'approval-required',
  'rejected',
  'succeeded',
  'failed',
]);
const WORKFLOW_OPERATION_KEYS = new Set([
  'workflow:control-workflow.job',
  'control-profile:control-profile.download-job',
]);

export function reduceActivityEvent(
  state: ActivityReductionState,
  event: RetainedActivityEvent,
): ReductionResult {
  if (state.acceptedEventIds.has(event.eventId)) {
    return { ok: false, code: 'duplicate-event-id' };
  }

  const operations = new Map(state.operations);
  const calls = new Map(state.calls);
  if (event.kind === 'operation-transition') {
    const current = operations.get(event.operationId);
    if (current === undefined) {
      if (event.operationPhase !== 'requested') {
        return { ok: false, code: 'unknown-operation' };
      }
      operations.set(event.operationId, operationRecordFrom(event));
    } else {
      if (OPERATION_TERMINALS.has(current.phase)) {
        return { ok: false, code: 'terminal-operation' };
      }
      if (!OPERATION_EDGES[current.phase]?.includes(event.operationPhase)) {
        return { ok: false, code: 'illegal-operation-transition' };
      }
      operations.set(event.operationId, transitionOperationRecord(current, event));
    }
  } else if (event.kind === 'call-transition') {
    if (!operations.has(event.operationId)) {
      return { ok: false, code: 'unknown-operation' };
    }
    const current = calls.get(event.callId);
    if (current === undefined) {
      if (event.callPhase !== 'received') {
        return { ok: false, code: 'illegal-call-transition' };
      }
      calls.set(event.callId, callRecordFrom(event));
    } else {
      if (current.operationId !== event.operationId) {
        return { ok: false, code: 'call-operation-mismatch' };
      }
      if (CALL_TERMINALS.has(current.phase)) {
        return { ok: false, code: 'terminal-call' };
      }
      if (!CALL_EDGES[current.phase]?.includes(event.callPhase)) {
        return { ok: false, code: 'illegal-call-transition' };
      }
      calls.set(event.callId, transitionCallRecord(current, event));
    }
  } else {
    const current = operations.get(event.operationId);
    if (current === undefined) return { ok: false, code: 'unknown-operation' };
    if (OPERATION_TERMINALS.has(current.phase)) {
      return { ok: false, code: 'terminal-operation' };
    }
    if (
      !WORKFLOW_OPERATION_KEYS.has(`${current.surface}:${current.action}`) ||
      event.surface !== current.surface ||
      event.action !== current.action
    ) {
      return { ok: false, code: 'milestone-non-workflow' };
    }
    operations.set(event.operationId, {
      ...current,
      progress: event.progress,
      updatedSequence: event.sequence,
    });
  }

  return {
    ok: true,
    state: {
      operations,
      calls,
      acceptedEventIds: new Set(state.acceptedEventIds).add(event.eventId),
    },
  };
}
```

Clone only the map/set touched by a candidate event. For an existing Operation or CallAttempt, preserve its first-bound identity/descriptor fields and construct the next record from that trusted descriptor plus the later event's phase, sequence, event id, timestamp, `updatedSequence`, and optional safe error; do not rebuild the record from all later-event common fields. Preserve Operation progress across ordinary transitions so only a validated workflow milestone can replace it. `acceptedEventIds` covers the retained window, is included in total-state accounting, and releases ids in the same atomic commit that evicts their event prefix; it never grows independently of retained history. A `workflow-milestone` requires an existing workflow Operation and may replace only bounded progress/evidence refs. Sequence is checked by the ledger; reducers never compare timestamps.

- [x] **Step 4: Run reducer tests and confirm GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/core/activity/operation-state.test.ts
```

Expected: PASS for every legal/illegal transition and synthetic future-state fixture. No production approval continuation exists.

## Task 3: Exact 63-tool observation policy

**Files:**

- Create: `src/core/activity/risk-policy.ts`
- Create: `src/core/activity/safe-observation-value.ts`
- Create: `tests/unit/core/activity/risk-policy.test.ts`
- Modify: `tests/unit/mcp/tool-risk-inventory.test.ts`

- [ ] **Step 1: Write the runtime policy lockstep test in the existing scanner test**

At the end of `tests/unit/mcp/tool-risk-inventory.test.ts`, import `RUNTIME_TOOL_POLICIES` and compare the already scanned `registrations`, reviewed JSON, and runtime array:

```ts
it('keeps the runtime observation policy in exact 63-tool lockstep', () => {
  const inventory = inventorySchema.parse(JSON.parse(readFileSync(INVENTORY, 'utf8')));
  const runtime = [...RUNTIME_TOOL_POLICIES].sort((a, b) => a.action.localeCompare(b.action));
  expect(runtime).toHaveLength(63);
  expect(duplicates(runtime.map((entry) => entry.action))).toEqual([]);
  expect(runtime.map((entry) => entry.action)).toEqual(inventory.tools.map((entry) => entry.name));

  const sourceByName = new Map(registrations.map((entry) => [entry.name, entry]));
  for (const entry of runtime) {
    const reviewed = inventory.tools.find((item) => item.name === entry.action)!;
    expect(entry.sensitivity, entry.action).toBe(sourceByName.get(entry.action)?.sensitivity);
    expect(entry.risk, entry.action).toBe(reviewed.risk);
    expect(entry.sourceSurface, entry.action).toBe(reviewed.surface);
    expect(entry.acknowledgement.kind, entry.action).toBe(reviewed.acknowledgementPolicy);
  }
});
```

In `risk-policy.test.ts`, assert the 25/20/12/6 risk totals, the explicit source-to-activity surface mapping, risk-to-display policy mapping, the eight fixed acknowledgement tools plus one conditional workflow rule, dry-run/non-dry-run behavior, unknown-name metadata-only fallback, and sensitivity drift. Pass top-level, nested, and final declared-leaf Proxies plus accessor fixtures through `readOwnDataPath` and `resolveToolObservationPolicy`; assert every getter/Proxy trap counter remains exactly zero and every Proxy leaf resolves to `undefined`. Target construction/fallback is tested only after the redactor exists in Task 4.

- [ ] **Step 2: Run policy tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/tool-risk-inventory.test.ts tests/unit/core/activity/risk-policy.test.ts
```

Expected: FAIL because the runtime policy module and 63 entries do not exist.

- [ ] **Step 3: Implement the typed policy projection**

Define:

```ts
export type SourceToolSurface =
  | 'agent-runbook'
  | 'control-profile'
  | 'control-workflow'
  | 'debug'
  | 'jlink-device-catalog'
  | 'rtt-log-session'
  | 'runtime-control'
  | 'terminal'
  | 'ui'
  | 'workspace'
  | 'unknown';

export type RedactionProfile =
  | 'metadata-only'
  | 'runtime'
  | 'session'
  | 'workspace'
  | 'probe'
  | 'file'
  | 'job'
  | 'ui'
  | 'debug-payload';

export interface ToolObservationPolicy {
  readonly action: string;
  readonly sourceSurface: SourceToolSurface;
  readonly surface: ActivitySurface;
  readonly sensitivity: ToolSensitivity;
  readonly risk: OperationRisk;
  readonly approvalPolicy: ApprovalPolicy;
  readonly acknowledgement:
    | { readonly kind: 'none' }
    | { readonly kind: 'client-acknowledgement-required' }
    | { readonly kind: 'conditional-client-acknowledgement' };
  readonly redactionProfile: RedactionProfile;
}

export interface ResolvedToolObservationPolicy extends ToolObservationPolicy {
  readonly missingCurrentAcknowledgement: boolean;
  readonly hasDiagnostic: boolean;
}

export interface ResolveToolObservationPolicyInput {
  readonly action: string;
  readonly declaredSensitivity: ToolSensitivity;
  readonly rawArgs: unknown;
}

export const RUNTIME_TOOL_POLICIES: readonly ToolObservationPolicy[];
export function resolveToolObservationPolicy(
  input: ResolveToolObservationPolicyInput,
): ResolvedToolObservationPolicy;
```

The production table is this exact sorted tuple projection; mapping it to `ToolObservationPolicy` removes rationale text and derives only activity surface/approval policy:

```ts
type PolicyRow = readonly [
  action: string,
  sourceSurface: SourceToolSurface,
  sensitivity: ToolSensitivity,
  risk: OperationRisk,
  acknowledgement:
    | 'none'
    | 'client-acknowledgement-required'
    | 'conditional-client-acknowledgement',
  redactionProfile: RedactionProfile,
];

const POLICY_ROWS = [
  [
    'activate_control_profile',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  [
    'apply_control_profile_answer',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['breakpoint_clear', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  ['breakpoint_list', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['breakpoint_set', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  [
    'cancel_control_workflow_job',
    'control-workflow',
    'state-affecting',
    'disruptive',
    'none',
    'job',
  ],
  [
    'cleanup_control_workflow_jobs',
    'control-workflow',
    'state-affecting',
    'state-affecting',
    'none',
    'job',
  ],
  ['close_session', 'terminal', 'state-affecting', 'state-affecting', 'none', 'session'],
  [
    'connect_control_profile_chip',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['cpu_halt', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  [
    'cpu_reset',
    'debug',
    'state-affecting',
    'disruptive',
    'client-acknowledgement-required',
    'debug-payload',
  ],
  ['cpu_run', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  ['cpu_step', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  ['crash_diagnose', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['diagnose_rtt_log_session', 'rtt-log-session', 'read-only', 'read-only', 'none', 'session'],
  [
    'disconnect_control_profile_chip',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['discover_serial_ports', 'terminal', 'read-only', 'read-only', 'none', 'session'],
  [
    'flash_download',
    'debug',
    'state-affecting',
    'destructive-or-unknown',
    'client-acknowledgement-required',
    'debug-payload',
  ],
  [
    'flash_erase',
    'debug',
    'state-affecting',
    'destructive-or-unknown',
    'client-acknowledgement-required',
    'debug-payload',
  ],
  ['flash_verify', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  [
    'flash_write',
    'debug',
    'state-affecting',
    'destructive-or-unknown',
    'client-acknowledgement-required',
    'debug-payload',
  ],
  [
    'gdb_server_start',
    'debug',
    'state-affecting',
    'disruptive',
    'client-acknowledgement-required',
    'debug-payload',
  ],
  ['gdb_server_stop', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  ['get_agent_runbook', 'agent-runbook', 'read-only', 'read-only', 'none', 'runtime'],
  ['get_app_status', 'agent-runbook', 'read-only', 'read-only', 'none', 'runtime'],
  ['get_control_profile', 'control-profile', 'read-only', 'read-only', 'none', 'workspace'],
  ['get_control_workflow_job_status', 'control-workflow', 'read-only', 'read-only', 'none', 'job'],
  ['get_session_status', 'terminal', 'read-only', 'read-only', 'none', 'session'],
  ['get_workspace_config', 'workspace', 'read-only', 'read-only', 'none', 'workspace'],
  [
    'init_control_profile',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['init_workspace', 'workspace', 'state-affecting', 'state-affecting', 'none', 'workspace'],
  ['inspect_control_profile', 'control-profile', 'read-only', 'read-only', 'none', 'workspace'],
  [
    'jlink_commander_script',
    'debug',
    'state-affecting',
    'destructive-or-unknown',
    'client-acknowledgement-required',
    'debug-payload',
  ],
  ['jlink_device_catalog_get', 'jlink-device-catalog', 'read-only', 'read-only', 'none', 'probe'],
  [
    'jlink_device_catalog_search',
    'jlink-device-catalog',
    'read-only',
    'read-only',
    'none',
    'probe',
  ],
  [
    'jlink_reboot',
    'debug',
    'state-affecting',
    'disruptive',
    'client-acknowledgement-required',
    'debug-payload',
  ],
  ['list_sessions', 'terminal', 'read-only', 'read-only', 'none', 'session'],
  ['memory_read', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['memory_write', 'debug', 'state-affecting', 'destructive-or-unknown', 'none', 'debug-payload'],
  [
    'open_rtt_log_session',
    'rtt-log-session',
    'state-affecting',
    'state-affecting',
    'none',
    'session',
  ],
  ['open_session', 'terminal', 'state-affecting', 'state-affecting', 'none', 'session'],
  [
    'prepare_control_profile_questions',
    'control-profile',
    'read-only',
    'read-only',
    'none',
    'workspace',
  ],
  ['probe_connect', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['probe_detect', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['probe_disconnect', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['probe_status', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['read_control_workflow_job', 'control-workflow', 'read-only', 'read-only', 'none', 'job'],
  ['read_from_session', 'terminal', 'read-only', 'read-only', 'none', 'session'],
  ['register_list', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['register_read', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['register_write', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  [
    'restart_mcp_runtime',
    'runtime-control',
    'state-affecting',
    'disruptive',
    'client-acknowledgement-required',
    'runtime',
  ],
  ['rtt_clear', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['rtt_connect', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['rtt_read', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['rtt_search', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  [
    'run_control_workflow',
    'control-workflow',
    'state-affecting',
    'destructive-or-unknown',
    'conditional-client-acknowledgement',
    'workspace',
  ],
  ['send_and_wait', 'terminal', 'state-affecting', 'state-affecting', 'none', 'session'],
  ['snapshot_capture', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['ui_configure', 'ui', 'state-affecting', 'state-affecting', 'none', 'ui'],
  ['ui_screenshot', 'ui', 'read-only', 'read-only', 'none', 'ui'],
  [
    'update_workspace_config',
    'workspace',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['write_to_session', 'terminal', 'state-affecting', 'state-affecting', 'none', 'session'],
] as const satisfies readonly PolicyRow[];
```

`src/core/activity/safe-observation-value.ts` exports one reader shared by policy and redactor:

```ts
export function readOwnDataPath(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || types.isProxy(current)) return undefined;
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor === undefined || !('value' in descriptor)) return undefined;
    current = descriptor.value;
  }
  return types.isProxy(current) ? undefined : current;
}
```

Use `POLICY_ROWS` exactly as listed above. Map source surfaces and derived policies as follows:

```ts
const ACTIVITY_SURFACE_BY_SOURCE = {
  'agent-runbook': 'runtime',
  'control-profile': 'control-profile',
  'control-workflow': 'workflow',
  debug: 'debug',
  'jlink-device-catalog': 'debug',
  'rtt-log-session': 'debug',
  'runtime-control': 'runtime',
  terminal: 'terminal',
  ui: 'ui',
  workspace: 'workspace',
  unknown: 'runtime',
} as const;

const approvalPolicyForRisk = (risk: OperationRisk): ApprovalPolicy => {
  if (risk === 'read-only') return 'none';
  if (risk === 'state-affecting') return 'notify';
  return 'human-once';
};

export const RUNTIME_TOOL_POLICIES = Object.freeze(
  POLICY_ROWS.map(([action, sourceSurface, sensitivity, risk, acknowledgement, redactionProfile]) =>
    Object.freeze({
      action,
      sourceSurface,
      surface: ACTIVITY_SURFACE_BY_SOURCE[sourceSurface],
      sensitivity,
      risk,
      approvalPolicy: approvalPolicyForRisk(risk),
      acknowledgement: Object.freeze({ kind: acknowledgement }),
      redactionProfile,
    }),
  ),
) satisfies readonly ToolObservationPolicy[];

const POLICY_BY_ACTION = new Map(
  RUNTIME_TOOL_POLICIES.map((policy) => [policy.action, policy] as const),
);

export function resolveToolObservationPolicy(
  input: ResolveToolObservationPolicyInput,
): ResolvedToolObservationPolicy {
  const reviewed = POLICY_BY_ACTION.get(input.action);
  if (reviewed === undefined || reviewed.sensitivity !== input.declaredSensitivity) {
    return Object.freeze({
      action: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.action)
        ? input.action
        : 'unknown-tool',
      sourceSurface: reviewed?.sourceSurface ?? 'unknown',
      surface: reviewed?.surface ?? 'runtime',
      sensitivity: input.declaredSensitivity,
      risk: 'destructive-or-unknown',
      approvalPolicy: 'human-once',
      acknowledgement: Object.freeze({ kind: 'none' as const }),
      redactionProfile: 'metadata-only',
      missingCurrentAcknowledgement: false,
      hasDiagnostic: true,
    });
  }

  const confirm = readOwnDataPath(input.rawArgs, ['confirm']) === true;
  const dryRun = readOwnDataPath(input.rawArgs, ['dryRun']) === true;
  const mode = readOwnDataPath(input.rawArgs, ['mode']);
  const haltOnFailure = readOwnDataPath(input.rawArgs, ['debug', 'haltOnFailure']) === true;
  const conditionalHighImpact =
    !dryRun &&
    (mode === 'debug-diagnose' ||
      mode === 'flash-observe' ||
      mode === 'flash-observe-diagnose' ||
      haltOnFailure);
  const missingCurrentAcknowledgement =
    (reviewed.acknowledgement.kind === 'client-acknowledgement-required' && !confirm) ||
    (reviewed.acknowledgement.kind === 'conditional-client-acknowledgement' &&
      conditionalHighImpact &&
      !confirm);
  return Object.freeze({
    ...reviewed,
    missingCurrentAcknowledgement,
    hasDiagnostic: false,
  });
}
```

Map `read-only -> none`, `state-affecting -> notify`, and `disruptive/destructive-or-unknown -> human-once`. Unknown names or sensitivity mismatches resolve to `destructive-or-unknown`, `human-once`, `metadata-only`, and a policy diagnostic; they do not block execution. Evaluate `run_control_workflow` only through `readOwnDataPath`: missing acknowledgement is predicted only when `dryRun !== true` and mode is `debug-diagnose`, `flash-observe`, or `flash-observe-diagnose`, or `debug.haltOnFailure === true`.

- [ ] **Step 4: Run policy tests and confirm GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/tool-risk-inventory.test.ts tests/unit/core/activity/risk-policy.test.ts
```

Expected: both files pass; all three 63-name sets match exactly; unknown and drift cases remain observation-only.

## Task 4: Allowlist-first bounded redaction

**Files:**

- Create: `src/core/activity/audit-redactor.ts`
- Create: `tests/unit/core/activity/audit-redactor.test.ts`

- [ ] **Step 1: Write seeded secrecy and trap-count tests**

Use explicit seeds for credentials, tokens, nonces, Windows/WSL/POSIX paths, Commander scripts, Buffer/Uint8Array/base64, firmware, screenshots, terminal bodies, memory values, evidence data/meta, error text/details/stacks, cycles, and oversized strings. Serialize every result and assert the original, base64, hex, and SHA-256 of every credential/token/nonce seed do not occur. For each path, separately assert drive, home/user, host/share, and parent-directory components are absent even when the sanitized basename is allowed. Assert target rules follow listed precedence, deduplicate, cap at 8, and use runtime fallback. Assert script metadata has SHA-256 with basis `utf8`, while `dataBase64` and memory `data` expose size/type with no digest. For reviewed fixed/conditional acknowledgement policies, test missing/false/true `confirm`; only true yields `clientAcknowledged: true`, and Proxy/accessor confirm fixtures keep trap/getter counts at zero.

The accessor/Proxy test must use counters exactly like this:

```ts
let getterCalls = 0;
const withGetter = {};
Object.defineProperty(withGetter, 'sessionId', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return 'secret-session';
  },
});

const traps = { ownKeys: 0, get: 0, descriptor: 0, prototype: 0 };
const proxied = new Proxy(
  { sessionId: 'secret-session' },
  {
    ownKeys(target) {
      traps.ownKeys += 1;
      return Reflect.ownKeys(target);
    },
    get(target, key, receiver) {
      traps.get += 1;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      traps.descriptor += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      traps.prototype += 1;
      return Reflect.getPrototypeOf(target);
    },
  },
);

redactToolObservation(policy, withGetter);
redactToolObservation(policy, proxied);
expect(getterCalls).toBe(0);
expect(traps).toEqual({ ownKeys: 0, get: 0, descriptor: 0, prototype: 0 });
```

- [ ] **Step 2: Run redactor tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/core/activity/audit-redactor.test.ts
```

Expected: FAIL because the redactor does not exist.

- [ ] **Step 3: Implement safe descriptor-only projection**

Export:

```ts
export interface RedactedToolObservation {
  readonly targets: readonly OperationTargetRef[];
  readonly argumentSummary?: ActivityArgumentSummary;
  readonly clientAcknowledged?: boolean;
}

export function redactToolObservation(
  policy: ResolvedToolObservationPolicy,
  rawArgs: unknown,
): RedactedToolObservation;

export function redactResultClassification(input: {
  success: boolean;
  errorCode?: string;
  failureStage?: ActivityFailureStage;
}): ActivitySafeError | undefined;
```

Freeze the declared read paths by profile; fields absent from this table are never inspected:

```ts
type TargetKind = 'runtime' | 'session' | 'workspace' | 'probe' | 'file' | 'ui' | 'job';
type SummaryRule =
  | {
      readonly path: readonly string[];
      readonly kind: 'identifier';
      readonly targetKind?: TargetKind;
    }
  | {
      readonly path: readonly string[];
      readonly kind: 'basename';
      readonly targetKind?: 'workspace' | 'file';
    }
  | { readonly path: readonly string[]; readonly kind: 'number' | 'boolean' }
  | {
      readonly path: readonly string[];
      readonly kind: 'content-metadata';
      readonly contentType: 'script' | 'binary' | 'firmware' | 'screenshot' | 'terminal' | 'memory';
      readonly basis: 'utf8' | 'bytes';
      readonly digest: 'sha256' | 'none';
    };

const PROFILE_RULES: Readonly<Record<RedactionProfile, readonly SummaryRule[]>> = Object.freeze({
  'metadata-only': Object.freeze([]),
  runtime: Object.freeze([{ path: ['runtimeId'], kind: 'identifier', targetKind: 'runtime' }]),
  session: Object.freeze([
    { path: ['sessionId'], kind: 'identifier', targetKind: 'session' },
    { path: ['jobId'], kind: 'identifier', targetKind: 'job' },
    { path: ['port'], kind: 'identifier' },
    { path: ['baudRate'], kind: 'number' },
  ]),
  workspace: Object.freeze([
    { path: ['root'], kind: 'basename', targetKind: 'workspace' },
    { path: ['jobId'], kind: 'identifier', targetKind: 'job' },
    { path: ['mode'], kind: 'identifier' },
    { path: ['dryRun'], kind: 'boolean' },
  ]),
  probe: Object.freeze([
    { path: ['probeId'], kind: 'identifier', targetKind: 'probe' },
    { path: ['device'], kind: 'identifier' },
    { path: ['name'], kind: 'identifier' },
  ]),
  file: Object.freeze([
    { path: ['path'], kind: 'basename', targetKind: 'file' },
    { path: ['filePath'], kind: 'basename', targetKind: 'file' },
  ]),
  job: Object.freeze([{ path: ['jobId'], kind: 'identifier', targetKind: 'job' }]),
  ui: Object.freeze([
    { path: ['action'], kind: 'identifier', targetKind: 'ui' },
    { path: ['type'], kind: 'identifier' },
  ]),
  'debug-payload': Object.freeze([
    { path: ['probeId'], kind: 'identifier', targetKind: 'probe' },
    { path: ['sessionId'], kind: 'identifier', targetKind: 'session' },
    { path: ['device'], kind: 'identifier' },
    { path: ['address'], kind: 'identifier' },
    { path: ['length'], kind: 'number' },
    { path: ['path'], kind: 'basename', targetKind: 'file' },
    { path: ['filePath'], kind: 'basename', targetKind: 'file' },
    {
      path: ['script'],
      kind: 'content-metadata',
      contentType: 'script',
      basis: 'utf8',
      digest: 'sha256',
    },
    {
      path: ['dataBase64'],
      kind: 'content-metadata',
      contentType: 'binary',
      basis: 'bytes',
      digest: 'none',
    },
    {
      path: ['data'],
      kind: 'content-metadata',
      contentType: 'memory',
      basis: 'bytes',
      digest: 'none',
    },
  ]),
});
```

Use `readOwnDataPath` for every declared path so policy and redactor share the same Proxy/accessor gate; never enumerate raw objects. Process rules in listed order, emit/deduplicate target-bearing rules up to `ACTIVITY_MAX_TARGETS`, and fall back to `{ kind: 'runtime', id: 'current-runtime' }` when none validates. Identifier targets require `ActivityIdSchema`; basename targets use a cross-platform sanitized basename as label and the fixed opaque id `<kind>-current`, never a path hash. Apply exactly the rule's `contentType`, `basis`, and `digest`; only the `script` rule above permits SHA-256. Separately read `confirm` only when `policy.acknowledgement.kind !== 'none'`; set `clientAcknowledged: true` only when `readOwnDataPath(rawArgs, ['confirm']) === true`, never add confirm to argument summaries, and never treat it as authorization. Build new bounded target/summary objects, parse them with shared schemas, deep-freeze the parsed result, and omit every undeclared/protected value without a digest.

- [ ] **Step 4: Run redactor and policy tests and confirm GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/core/activity/audit-redactor.test.ts tests/unit/core/activity/risk-policy.test.ts tests/unit/mcp/tool-risk-inventory.test.ts
```

Expected: three files pass; getter/trap counts are exactly zero and all seeded protected values remain absent.

## Task 5: Health monitor and atomic bounded ledger

**Files:**

- Create: `src/core/activity/activity-health.ts`
- Create: `src/core/activity/operation-ledger.ts`
- Create: `tests/unit/core/activity/activity-health.test.ts`
- Create: `tests/unit/core/activity/operation-ledger.test.ts`

- [ ] **Step 1: Write health and small-capacity ledger tests**

Use deterministic `runtimeId`, event id, and clock factories. Cover empty sequence 0, ordered read-after-N, atomic paired batches, the five default limits, injected tiny event/Operation/Call/byte limits, minimum prefix eviction, active-view pinning, terminal record release only after its last event leaves, whole-batch drop, terminal retained-window semantics, runtime mismatch/reset, oldest-minus-one boundary, invalid/fractional/negative/non-finite/unsafe/future cursors, sequence exhaustion, listener throw/unsubscribe/unsubscribe-during-notify, and re-entrant append rejection.

Assert distinct counters:

```ts
expect(snapshot.health).toMatchObject({
  captureFailureCount: 0,
  droppedEventCount: 0,
  evictedEventCount: 0,
  listenerFailureCount: 0,
  policyFailureCount: 0,
  incompleteLifecycleCount: 0,
});
```

In a tiny-capacity test, assert prefix removal increments only `evictedEventCount`; in an unfit begin-batch test, assert the full candidate size increments only `droppedEventCount` and consumes no sequence.

- [ ] **Step 2: Run health/ledger tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/core/activity/activity-health.test.ts tests/unit/core/activity/operation-ledger.test.ts
```

Expected: FAIL because the monitor and ledger do not exist.

- [ ] **Step 3: Implement the non-recursive health monitor**

Use closed safe enums and expose no arbitrary message:

```ts
export type ActivityHealthStage = ActivityFailureStage;

export type ActivityHealthCode =
  | 'capture-failed'
  | 'policy-drift'
  | 'invalid-event'
  | 'capacity-exceeded'
  | 'delivery-failed'
  | 'listener-threw'
  | 'reentrant-append'
  | 'invalid-cursor';

export class ActivityHealthMonitor {
  enterLifecycle(): () => void;
  recordCaptureFailure(stage: ActivityHealthStage, code: ActivityHealthCode, dropped: number): void;
  recordEviction(count: number): void;
  recordListenerFailure(): void;
  recordPolicyFailure(): void;
  resetForRuntime(): void;
  snapshot(): ActivityHealth;
}
```

`enterLifecycle` increments the gauge and returns an idempotent terminal-decision function that decrements it exactly once. Counter mutation never appends an event, never invokes a subscriber, and retains only bounded last stage/code/timestamp data.

The monitor maintains an internal runtime generation. `resetForRuntime()` increments that generation and zeros every counter/gauge; a completion closure from an older generation becomes an idempotent no-op so it cannot drive the new runtime gauge below zero.

- [ ] **Step 4: Implement the ledger public API and atomic preflight**

Export:

```ts
export interface OperationLedgerOptions {
  readonly health: ActivityHealthMonitor;
  readonly createRuntimeId?: () => string;
  readonly createEventId?: () => string;
  readonly now?: () => string;
  readonly maxEvents?: number;
  readonly maxOperations?: number;
  readonly maxCallAttempts?: number;
  readonly maxProjectedEventBytes?: number;
  readonly maxTotalStateBytes?: number;
  /** Test seam; production default is Number.MAX_SAFE_INTEGER. */
  readonly maxSequence?: number;
}

export type ValidatedActivityCursor =
  | { readonly kind: 'none' }
  | { readonly kind: 'same-runtime'; readonly sequence: number }
  | { readonly kind: 'reset-required' };

export class OperationLedger {
  appendBatch(
    drafts: readonly ActivityEventDraft[],
  ):
    | { readonly accepted: true; readonly events: readonly ActivityEventView[] }
    | { readonly accepted: false; readonly code: string };
  validateCursor(cursor?: ActivityCursor): ValidatedActivityCursor;
  snapshot(cursor?: ActivityCursor): ActivitySnapshotView;
  snapshotFromValidatedCursor(cursor: ValidatedActivityCursor): ActivitySnapshotView;
  subscribe(listener: (event: ActivityEventView) => void): () => void;
}
```

Use deterministic accounting constants `EVENT_INDEX_OVERHEAD_BYTES = 64`, `OPERATION_RECORD_OVERHEAD_BYTES = 256`, and `CALL_RECORD_OVERHEAD_BYTES = 192`. Total activity state is internal retained JSON bytes plus projected event/view JSON bytes plus the retained event-id index and fixed per-record overheads. Validate `maxSequence` as a positive safe integer and default it to `Number.MAX_SAFE_INTEGER`; tests inject `maxSequence: 4` to exercise rotation without private-state mutation. For each batch: assign tentative contiguous sequences; validate every internal event; clone reducer/maps; reduce all candidates; project and size every view; plan the minimum prefix eviction; preflight event/Operation/Call/total-state limits including active views and fixed reducer overhead; then commit eviction, entire batch, reducers, views, byte accounting, and next sequence together. On any failure, commit nothing, consume no sequence, and increment safe health once plus the exact never-retained candidate count. Notify a snapshot of listeners only after commit, in sequence order, with an append guard. On numeric sequence rotation, clear retained/reducer/view/event-id-index state, create a new runtime id, and call `health.resetForRuntime()` before accepting the new runtime's first event.

- [ ] **Step 5: Run reducer/health/ledger tests and confirm GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/core/activity/operation-state.test.ts tests/unit/core/activity/activity-health.test.ts tests/unit/core/activity/operation-ledger.test.ts
```

Expected: all three files pass, including zero-counter normal tests and separate nonzero small-capacity pressure tests.

## Task 6: MCP call recording handles

**Files:**

- Create: `src/core/activity/operation-recorder.ts`
- Create: `tests/unit/core/activity/operation-recorder.test.ts`
- Modify: `src/core/activity/index.ts`

- [ ] **Step 1: Write recorder lifecycle tests**

Cover server-generated unique operation/call ids, same untrusted correlation producing different ids, atomic requested+received, normal started/running, success/failure/rejection, success-plus-delivery-failure, rejected-plus-delivery-failure priority, finish-once after terminal append failure, provider/redactor/ledger failure no-op behavior, lifecycle gauge decrement, and async context preservation around the supplied callback. Inject a start-batch append failure, then call a terminal method and assert there is only one capture failure/drop decision: the handle consumes finish-once/gauge without attempting a second ledger append. Assert `recordPolicyDrift()` increments policy health at most once. Pass top-level and nested Proxy/accessor raw args through `beginMcpCall` and assert every trap/getter count remains zero across policy plus redaction. Workflow-job observation is added only after its source contract exists in Task 8.

Lock ordinary MCP producer metadata with two exact fixtures:

```ts
expect(readOnlyRequested).toMatchObject({
  actor: { kind: 'agent', channel: 'local-mcp' },
  action: 'get_app_status',
  surface: 'runtime',
  risk: 'read-only',
  approvalPolicy: 'none',
  authorizationSource: 'none',
  targets: [{ kind: 'runtime' }],
});
expect(acknowledgedRequested).toMatchObject({
  actor: { kind: 'agent', channel: 'local-mcp' },
  action: 'cpu_reset',
  surface: 'debug',
  risk: 'disruptive',
  approvalPolicy: 'human-once',
  clientAcknowledged: true,
  authorizationSource: 'none',
});
```

- [ ] **Step 2: Run recorder tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/core/activity/operation-recorder.test.ts
```

Expected: FAIL because the recorder APIs do not exist.

- [ ] **Step 3: Implement the recorder contracts**

Export:

```ts
export interface BeginMcpCallInput {
  readonly action: string;
  readonly declaredSensitivity: ToolSensitivity;
  readonly rawArgs: unknown;
}

export interface McpCallRecordingHandle {
  readonly operationId: string;
  readonly callId: string;
  readonly admission: 'start-before-handler' | 'defer-for-current-acknowledgement';
  start(): void;
  recordPolicyDrift(): void;
  reject(stage: ActivityHealthStage, code?: string): void;
  finishFailure(code?: string): void;
  finishSuccess(): void;
  finishSuccessWithDeliveryFailure(stage: 'response-construction' | 'response-serialization'): void;
  recordDeliveryFailure(stage: 'response-construction' | 'response-serialization'): void;
  runWithContext<T>(work: () => Promise<T> | T): Promise<T>;
}

export type OperationRecorderProvider = (input: BeginMcpCallInput) => McpCallRecordingHandle;

export class OperationRecorder {
  constructor(options: { ledger: OperationLedger; health: ActivityHealthMonitor });
  beginMcpCall(input: BeginMcpCallInput): McpCallRecordingHandle;
}
```

`beginMcpCall` follows this exact control flow:

```ts
beginMcpCall(input: BeginMcpCallInput): McpCallRecordingHandle {
  const terminalDecision = this.health.enterLifecycle();
  const operationId = `operation-${randomUUID()}`;
  const callId = `call-${randomUUID()}`;
  try {
    const policy = resolveToolObservationPolicy(input);
    if (policy.hasDiagnostic) this.health.recordPolicyFailure();
    const redacted = redactToolObservation(policy, input.rawArgs);
    const common = Object.freeze({
      operationId,
      actor: { kind: 'agent', channel: 'local-mcp' } as const,
      surface: policy.surface,
      action: policy.action,
      risk: policy.risk,
      approvalPolicy: policy.approvalPolicy,
      authorizationSource: 'none' as const,
      targets: redacted.targets,
      argumentSummary: redacted.argumentSummary,
      clientAcknowledged: redacted.clientAcknowledged,
    });
    const begin = this.ledger.appendBatch([
      { ...common, kind: 'operation-transition', operationPhase: 'requested' },
      { ...common, kind: 'call-transition', callId, callPhase: 'received' },
    ]);
    if (!begin.accepted) {
      return createNoopRecordingHandle({ operationId, callId, terminalDecision });
    }
    return createActiveRecordingHandle({
      operationId,
      callId,
      common,
      ledger: this.ledger,
      health: this.health,
      terminalDecision,
      context: this.context,
      admission: policy.missingCurrentAcknowledgement
        ? 'defer-for-current-acknowledgement'
        : 'start-before-handler',
    });
  } catch {
    this.health.recordCaptureFailure('provider', 'capture-failed', 2);
    return createNoopRecordingHandle({ operationId, callId, terminalDecision });
  }
}
```

`createActiveRecordingHandle` has private `finished`, `started`, `policyDriftRecorded`, and `captureDisabled` booleans. Its internal `append` returns immediately when capture is disabled; the first rejected append sets `captureDisabled = true`. `start()` appends Operation `running` plus Call `started` atomically once. `recordPolicyDrift()` increments policy health once. Every terminal method first checks/sets `finished` and calls `terminalDecision()` exactly once; it attempts a terminal batch only when `captureDisabled` is false. `finishSuccessWithDeliveryFailure` appends Operation `succeeded` plus Call `failed`; `recordDeliveryFailure` changes health only and never invokes another terminal method. `runWithContext` uses `AsyncLocalStorage.run({ operationId }, work)`.

The handle owns its finish-once boolean and the idempotent lifecycle-gauge completion closure outside ledger storage. A failed begin batch returns a handle whose later methods are no-op except finish-once gauge completion. Every MCP draft hard-codes actor `agent`/`local-mcp`, exact policy action/surface/risk/approval policy, non-empty redacted targets with runtime fallback, and `authorizationSource: none`; only the policy's safe acknowledgement result may set `clientAcknowledged`. Use `AsyncLocalStorage<{ operationId: string }>` only around the business handler; Task 8 consumes the trusted context without exposing it.

- [ ] **Step 4: Run recorder tests and confirm GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/core/activity/operation-recorder.test.ts tests/unit/core/activity/operation-ledger.test.ts
```

Expected: both files pass; finish-once and async context lifetime remain correct under injected capture faults.

## Task 7: Instrument the central registry without behavior drift

**Files:**

- Modify: `src/mcp/registry.ts`
- Modify: `src/mcp/server.ts`
- Modify: `tests/unit/mcp/registry.test.ts`
- Modify: `tests/unit/mcp/registry-sdk-boundary.test.ts`
- Modify: `tests/integration/high-impact-confirmation.test.ts`

- [ ] **Step 1: Add failing recorder-enabled registry parity tests**

Build an in-memory health/ledger/recorder and attach it to the fake server. Table-drive success, declared failure, `ToolError`, `Error`, non-Error throw, read-only version warning, version rejection, stale rejection, runtime diagnostics throw, known `CONFIRMATION_REQUIRED`, provider/redactor/append/listener failures, and unchanged handler/backend counts.

For response construction and serialization seams, use one successful Proxy handler-result fixture whose `success` read returns `true` but whose `evidence` read throws, plus a scoped `vi.spyOn(JSON, 'stringify')` that throws only for LinkTerm result payloads. Assert:

```text
successful business effect + serialization throw => Operation succeeded, CallAttempt failed
already-decided version/stale/ack rejection + serialization throw => CallAttempt remains rejected
declared/normalized business failure + serialization throw => CallAttempt remains failed
```

Extend the real SDK boundary test so malformed input leaves the ledger empty and handler/backend counts at zero.

- [ ] **Step 2: Run registry tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry.test.ts tests/unit/mcp/registry-sdk-boundary.test.ts tests/integration/high-impact-confirmation.test.ts
```

Expected: existing characterization stays green while new recorder assertions fail because no provider seam/events exist.

- [ ] **Step 3: Add the server-scoped provider seam**

Beside `runtimeDiagnosticsProviders`, add:

```ts
const operationRecorderProviders = new WeakMap<McpServer, OperationRecorderProvider>();

export function setOperationRecorderProvider(
  server: McpServer,
  provider: OperationRecorderProvider,
): void {
  operationRecorderProviders.set(server, provider);
}
```

Extend `CreateMcpServerOptions` with `operationRecorderProvider?: OperationRecorderProvider` and call the setter once in `createMcpServer`. Do not change `ToolDefinition`, any of the 63 handlers, or `http-runtime-server.ts`; the HTTP owner already spreads server options into every per-request server.

- [ ] **Step 4: Restructure only the central SDK callback**

At callback entry, create a safe no-op handle, then ask the optional provider for a handle with server-owned `def.name`, declared sensitivity, and raw args. Catch provider errors. Preserve the current order of version and runtime freshness checks. Apply these exact terminal rules:

```ts
const serializeRejected = (
  payload: LinkTermToolResult,
  stage: 'schema' | 'runtime-precondition' | 'policy',
  code: 'VERSION_MISMATCH' | 'INVALID_STATE' | 'CONFIRMATION_REQUIRED',
): CallToolResult => {
  handle.reject(stage, code);
  try {
    return toCallToolResult(payload);
  } catch (error) {
    handle.recordDeliveryFailure('response-serialization');
    throw error;
  }
};

// exact pre-admission mappings
// version mismatch -> serializeRejected(payload, 'schema', 'VERSION_MISMATCH')
// stale runtime -> serializeRejected(payload, 'runtime-precondition', 'INVALID_STATE')
// matching current acknowledgement failure -> serializeRejected(payload, 'policy', 'CONFIRMATION_REQUIRED')

const readRuntimeStatus = async (): Promise<Awaited<ReturnType<RuntimeDiagnosticsProvider>>> => {
  try {
    return await runtimeDiagnostics();
  } catch (error) {
    handle.reject('runtime-precondition', 'RUNTIME_DIAGNOSTICS_FAILED');
    throw error;
  }
};
const runtimeStatus = await readRuntimeStatus();

// admitted handler path
if (handle.admission === 'start-before-handler') handle.start();
const result = await handle.runWithContext(async () => {
  try {
    return await def.handler(input);
  } catch (error) {
    return normalizeError(error);
  }
});
```

If admission was deferred and the actual result is `CONFIRMATION_REQUIRED`, reject without started/running. Otherwise call `handle.recordPolicyDrift()` and then `handle.start()` before classifying the actual result. Construct/serialize the existing payload before `finishSuccess`; if serialization throws after business success, call `finishSuccessWithDeliveryFailure`. For business failure, make the failed terminal decision before serialization; a later delivery failure only records health. Do not add ids to the response or evidence.

- [ ] **Step 5: Run registry parity and Phase 0 confirmation tests**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry.test.ts tests/unit/mcp/registry-sdk-boundary.test.ts tests/integration/high-impact-confirmation.test.ts tests/unit/mcp/runtime-control-tools.test.ts tests/unit/mcp/terminal-tools.test.ts
```

Expected: all files pass with recorder disabled and enabled; result JSON/throw identity/backend counts match baseline; every entered enabled call has one terminal decision.

## Task 8: Post-commit workflow-job observation

**Files:**

- Modify: `src/mcp/surfaces/control-workflow/job-manager.ts`
- Modify: `src/mcp/surfaces/control-workflow/tools.ts`
- Modify: `src/main/ipc/control-profile-ipc.ts`
- Modify: `tests/unit/mcp/control-workflow-job-manager.test.ts`
- Modify: `tests/unit/mcp/control-workflow-tools.test.ts`
- Modify: `tests/unit/main/ipc/control-profile-ipc.test.ts`
- Modify: `tests/unit/core/activity/operation-recorder.test.ts`

- [ ] **Step 1: Add failing JobManager observer tests**

Assert post-commit order for create, running, update, cancel-requested, and every terminal. Assert the observer receives a detached frozen envelope with only primitive leaves and a detached frozen step-summary array. Observer mutation and throw cannot alter returned snapshots, AbortSignal timing, retention, terminal choice, or later transitions. A re-entrant read is observational only. A once-only re-entrant `cancel` or `update` executes that public method's existing semantics exactly once, queues its observation behind the current callback, and cannot recurse the notifier stack, lose an observation, duplicate a transition, or corrupt manager state; cancellation may abort/change state exactly as the same external call would. Feed more than 64 steps and seeded oversized/path-like step ids, then assert the observation retains at most 64 safe summaries, reports the full numeric `stepCount`, and contains none of the seed/path components. Inject type-escaped malformed step fields that make projection throw and assert create/update/cancel still preserve their existing return/state semantics while only that observation is skipped.

Keep the Phase 0 nested `step.evidence` alias test unchanged and green; the observer must never receive `ControlWorkflowJobSnapshot`, `ControlWorkflowData`, root, input, evidence, error text/details, next action, blocking detail, or controller.

- [ ] **Step 2: Run job tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/control-workflow-job-manager.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts
```

Expected: new tests fail because observer/activity metadata options do not exist; all old tests remain green.

- [ ] **Step 3: Add detached observation types and a queued notifier**

Define:

```ts
export type ControlWorkflowJobActivityOrigin = 'agent' | 'human' | 'system';
export const MAX_OBSERVED_WORKFLOW_STEPS = 64;
export const MAX_OBSERVED_STEP_CODE_LENGTH = 64;
export type ControlWorkflowJobObservationKind =
  | 'created'
  | 'running'
  | 'updated'
  | 'cancel-requested'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ControlWorkflowJobStepObservation {
  readonly id: string;
  readonly status: ControlWorkflowStepStatus;
  readonly durationMs: number;
  readonly errorCode?: ToolErrorCode;
  readonly failureCode?: ControlWorkflowFailureCode;
}

export interface ControlWorkflowJobObservation {
  readonly kind: ControlWorkflowJobObservationKind;
  readonly jobId: string;
  readonly state: ControlWorkflowJobState;
  readonly mode: RunControlWorkflowInput['mode'];
  readonly activityOrigin: ControlWorkflowJobActivityOrigin;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly updatedAt: number;
  readonly cancelRequested: boolean;
  readonly currentStepId?: string;
  readonly stepCount: number;
  readonly steps: readonly ControlWorkflowJobStepObservation[];
}
```

Extend options with `observer?: (observation: ControlWorkflowJobObservation) => void` and create input with `activityOrigin?: ControlWorkflowJobActivityOrigin`, defaulting internally to `system`. Notify only after committed state changes through one private FIFO drain. Observer re-entry queues the nested observation; observer exceptions are swallowed; manager state never reads observer state. Derive summaries from only `steps.slice(-64)`. Accept step/current-step ids only when they match `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u`; replace any invalid id with the stable code `workflow-step-unknown`, never a truncated user string. Clamp duration to a nonnegative safe integer, retain only typed closed error/failure codes, freeze each copied step, freeze the copied array, and freeze the envelope.

The notifier implementation is one guarded FIFO:

```ts
#enqueueObservation(kind: ControlWorkflowJobObservationKind, record: ControlWorkflowJobRecord): void {
  if (this.#observer === undefined) return;
  let projected: ControlWorkflowJobObservation;
  try {
    projected = buildJobObservation(kind, record);
  } catch {
    return;
  }
  this.#observationQueue.push(projected);
  if (this.#drainingObservations) return;
  this.#drainingObservations = true;
  try {
    while (this.#observationQueue.length > 0) {
      const observation = this.#observationQueue.shift()!;
      try {
        this.#observer(observation);
      } catch {
        // Best-effort observation cannot escape into manager behavior.
      }
    }
  } finally {
    this.#drainingObservations = false;
  }
}
```

Call it immediately after `#jobs.set` (`created`), `#markRunning` (`running`), `update` (`updated`), setting `cancelRequested` (`cancel-requested`), and each `#markTerminal/#markCancelled` commit. Never pass `#snapshot(record)` or `record.workflow` to the observer.

Keep the existing permissive update behavior: an update after terminal may affect retention ordering but cannot regress the recorder's terminal Operation or throw back into the manager. A queued cancel produces safe cancel-requested and cancelled observations after the committed cancellation; a running cancel keeps the existing `running + cancelRequested` state and AbortSignal timing.

- [ ] **Step 4: Add trusted metadata only at the two production create sites**

Change the MCP background call to:

```ts
const job = jobManager.create({
  input,
  correlationId: input.correlationId,
  activityOrigin: 'agent',
});
```

Change only `CONTROL_PROFILE_START_DOWNLOAD` Main handling to pass `activityOrigin: 'human'`. Do not accept an actor/origin field from Renderer raw payload and do not instrument direct RUN_DOWNLOAD.

- [ ] **Step 5: Connect JobManager observations to recorder tests**

Extend `OperationRecorder` only now with:

```ts
observeWorkflowJob(observation: ControlWorkflowJobObservation): void;
```

Construct JobManager in the focused test with:

```ts
const manager = new ControlWorkflowJobManager({
  observer: (observation) => recorder.observeWorkflowJob(observation),
});
```

Run MCP job creation inside `handle.runWithContext(...)`. At the create observation, capture the current parent once and persist `jobId -> child operationId`; later detached observations use that mapping, not the live async context. In a `finally` path after any terminal observation decision, delete both the active job mapping and its progress-coalescing signature even if ledger append fails. Ignore a late `updated` observation with no active mapping; never recreate an Operation from it. A many-sequential-jobs test must prove active correlation/coalescing state returns to zero after every terminal.

Assert fixed job metadata field by field:

```ts
expect(mcpChild).toMatchObject({
  parentOperationId: launchHandle.operationId,
  actor: { kind: 'agent', channel: 'local-mcp' },
  surface: 'workflow',
  action: 'control-workflow.job',
  risk: 'destructive-or-unknown',
  approvalPolicy: 'human-once',
  authorizationSource: 'none',
  targets: [{ kind: 'job', id: jobId }],
});
expect(mainChild).toMatchObject({
  actor: { kind: 'human', channel: 'desktop' },
  surface: 'control-profile',
  action: 'control-profile.download-job',
  risk: 'destructive-or-unknown',
  approvalPolicy: 'human-once',
  authorizationSource: 'none',
  targets: [{ kind: 'job', id: directJobId }],
});
expect(mainChild.parentOperationId).toBeUndefined();
```

Also assert later job events carry no `callId`, duplicate progress coalesces, update-after-terminal cannot regress/recreate the Operation, root/input/workflow/evidence/error details are absent, and public job snapshots remain unchanged.

- [ ] **Step 6: Run job/recorder integration and confirm GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/core/activity/operation-recorder.test.ts tests/unit/mcp/control-workflow-job-manager.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts
```

Expected: four files pass; existing nested evidence alias and all handler/backend counts remain unchanged.

## Task 9: Cursor-correct activity IPC

**Files:**

- Create: `src/main/ipc/activity-ipc.ts`
- Create: `tests/unit/main/ipc/activity-ipc.test.ts`
- Modify: `src/shared/ipc-protocol.ts`

- [ ] **Step 1: Add four channels and failing Main IPC tests**

Add exactly:

```ts
ACTIVITY_SUBSCRIBE: 'activity:subscribe',
ACTIVITY_UNSUBSCRIBE: 'activity:unsubscribe',
ACTIVITY_SNAPSHOT: 'activity:snapshot',
ACTIVITY_EVENT: 'activity:event',
```

With hoisted fakes for `ipcMain` and two independent `webContents`, test this synchronous order:

```text
parse request -> validate cursor -> register/refresh sender -> snapshotFromValidatedCursor
```

Assert invalid/future cursor does not register; an event at the snapshot cut is either in snapshot or sent; read-only snapshot does not subscribe; repeat subscribe replaces only that sender; explicit unsubscribe is idempotent; malformed unsubscribe payload is rejected without changing subscription state; destroyed/send-race cleanup removes references; after a send-race throw, later appends never retry that sender while other windows continue; two windows stay independent; dispose removes handlers and ledger callbacks. Add a Renderer reload case: destroy sender A after cursor C, append retained events to the same Main ledger, subscribe replacement sender B with C, and assert hydration plus pushed events is gap-free and uses the unchanged ledger `runtimeId`.

- [ ] **Step 2: Run IPC tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/main/ipc/activity-ipc.test.ts
```

Expected: FAIL because `registerActivityIpc` does not exist.

- [ ] **Step 3: Implement the narrow bridge**

Export one lifecycle function:

```ts
export function registerActivityIpc(ledger: OperationLedger): () => void;
```

Use this synchronous handler structure:

```ts
const invalidActivityRequest = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity request' },
});
const invalidActivityCursor = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity cursor' },
});

export function registerActivityIpc(ledger: OperationLedger): () => void {
  const subscribers = new Map<number, { offLedger: () => void; cleanup: () => void }>();
  const remove = (id: number): void => {
    const entry = subscribers.get(id);
    if (entry === undefined) return;
    subscribers.delete(id);
    entry.offLedger();
    entry.cleanup();
  };

  ipcMain.handle(
    IPC_CHANNELS.ACTIVITY_SUBSCRIBE,
    (event, raw): PreloadResult<ActivitySnapshotView> => {
      const parsed = ActivityCursorRequestSchema.safeParse(raw ?? {});
      if (!parsed.success) return invalidActivityRequest();
      let validated: ValidatedActivityCursor;
      try {
        validated = ledger.validateCursor(parsed.data.cursor);
      } catch {
        return invalidActivityCursor();
      }

      const sender = event.sender;
      remove(sender.id);
      const onDestroyed = (): void => remove(sender.id);
      sender.once('destroyed', onDestroyed);
      const offLedger = ledger.subscribe((activityEvent) => {
        if (sender.isDestroyed()) {
          remove(sender.id);
          return;
        }
        try {
          sender.send(IPC_CHANNELS.ACTIVITY_EVENT, activityEvent);
        } catch {
          remove(sender.id);
        }
      });
      subscribers.set(sender.id, {
        offLedger,
        cleanup: () => sender.removeListener('destroyed', onDestroyed),
      });
      return { success: true, data: ledger.snapshotFromValidatedCursor(validated) };
    },
  );

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_SNAPSHOT, (_event, raw) => {
    const parsed = ActivityCursorRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) return invalidActivityRequest();
    try {
      return { success: true as const, data: ledger.snapshot(parsed.data.cursor) };
    } catch {
      return invalidActivityCursor();
    }
  });

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE, (event, raw) => {
    if (!ActivityUnsubscribeRequestSchema.safeParse(raw ?? {}).success) {
      return invalidActivityRequest();
    }
    remove(event.sender.id);
    return { success: true as const, data: { unsubscribed: true as const } };
  });

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE);
    ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_SNAPSHOT);
    ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE);
    for (const id of [...subscribers.keys()]) remove(id);
  };
}
```

Use `ActivityCursorRequestSchema.safeParse(raw ?? {})` for subscribe/snapshot and `ActivityUnsubscribeRequestSchema.safeParse(raw ?? {})` for unsubscribe; the unsubscribe schema accepts only an empty strict object. Return the existing structured `PreloadResult` failure shape without echoing payload fragments. In subscribe, call `ledger.validateCursor` before changing the subscriber map, register a synchronous ledger callback that only calls `webContents.send`, then immediately call `snapshotFromValidatedCursor` with no `await`. On send to a destroyed window, clean it up. Explicit unsubscribe removes only the sender's ledger callback/destroyed hook. Dispose removes all three invoke handlers and all subscribers; `activity:event` is push-only.

- [ ] **Step 4: Run IPC tests and confirm GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/main/ipc/activity-ipc.test.ts tests/unit/core/activity/operation-ledger.test.ts
```

Expected: both files pass with gap-free ordering and independent cleanup.

## Task 10: Runtime-validated preload namespace

**Files:**

- Modify: `src/shared/preload-api.ts`
- Modify: `src/main/preload.ts`
- Modify: `tests/fixtures/mock-preload-api.ts`
- Create: `tests/unit/main/preload-activity.test.ts`
- Modify: `tests/unit/main/electron-runtime.test.ts`

- [ ] **Step 1: Write failing preload parser tests**

Mock Electron and import preload dynamically. Assert subscribe/snapshot/unsubscribe channels, strict success and failure response parsing, invalid invoke response mapping to stable local `INVALID_PAYLOAD`, pushed event parsing before callback, malformed push dropped, local `removeListener`, and absence of exposed `ipcRenderer`.

- [ ] **Step 2: Run preload tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/main/preload-activity.test.ts tests/unit/main/electron-runtime.test.ts
```

Expected: new test fails because `window.linkterm.activity` and activity parsers do not exist.

- [ ] **Step 3: Add type-only shared namespace**

`src/shared/preload-api.ts` may use only `import type` from `activity-contract.ts`:

```ts
export interface ActivityNamespace {
  subscribe(req?: ActivityCursorRequest): Promise<PreloadResult<ActivitySnapshotView>>;
  snapshot(req?: ActivityCursorRequest): Promise<PreloadResult<ActivitySnapshotView>>;
  unsubscribe(): Promise<PreloadResult<{ unsubscribed: true }>>;
  onEvent(handler: (event: ActivityEventView) => void): Unsubscribe;
}

export interface PreloadAPI {
  // existing namespaces remain unchanged
  activity: ActivityNamespace;
}
```

- [ ] **Step 4: Implement activity-specific runtime parsing in preload**

Import Zod-backed activity response/event schemas directly in `src/main/preload.ts`. Do not reuse the generic cast-only `invoke<T>` for Activity. Add:

```ts
const invalidActivityPayload = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'INVALID_PAYLOAD', message: 'Invalid activity payload' },
});
```

For each activity invoke, parse both success and failure envelopes and return the stable local failure on parse error. `onEvent` parses each push and invokes Renderer code only on success. Its returned function removes only its own listener. `unsubscribe()` is a separate Main invoke.

Import `ZodType` with `import type` and implement the namespace with this activity-specific adapter, not the generic cast-only invoke helper:

```ts
const invokeActivity = async <T>(
  channel: string,
  schema: ZodType<PreloadResult<T>>,
  payload?: unknown,
): Promise<PreloadResult<T>> => {
  const raw: unknown = await ipcRenderer.invoke(channel, payload);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : invalidActivityPayload();
};

const activity: ActivityNamespace = {
  subscribe: (req = {}) =>
    invokeActivity(IPC_CHANNELS.ACTIVITY_SUBSCRIBE, ActivitySnapshotResultSchema, req),
  snapshot: (req = {}) =>
    invokeActivity(IPC_CHANNELS.ACTIVITY_SNAPSHOT, ActivitySnapshotResultSchema, req),
  unsubscribe: () =>
    invokeActivity(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE, ActivityUnsubscribeResultSchema, {}),
  onEvent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = ActivityEventViewSchema.safeParse(payload);
      if (parsed.success) handler(parsed.data);
    };
    ipcRenderer.on(IPC_CHANNELS.ACTIVITY_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.ACTIVITY_EVENT, listener);
  },
};
```

- [ ] **Step 5: Extend the mock preload surface only**

Add activity spies and `emitActivityEvent(event)` to `createMockPreloadAPI`; do not add a reducer, store, component, grouping, or UI copy.

- [ ] **Step 6: Run preload and fixture tests and confirm GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/main/preload-activity.test.ts tests/unit/main/electron-runtime.test.ts tests/unit/main/ipc/ui-bridge.test.ts
```

Expected: all files pass; malformed activity payloads never reach Renderer handlers.

## Task 11: One Main-owned runtime and supported transport integration

**Files:**

- Modify: `src/main/ipc/index.ts`
- Modify: `tests/unit/main/ipc/index.test.ts`
- Modify: `tests/unit/mcp/http-runtime-server.test.ts`
- Create: `tests/integration/operation-ledger-mcp.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing Main composition tests**

Mock the new constructors/registration and assert creation order and object identity:

```text
ActivityHealthMonitor -> OperationLedger -> OperationRecorder -> ControlWorkflowJobManager
same recorder provider -> direct createMcpServer and startMcpHttpRuntimeServer
same recorder observer -> shared JobManager
same ledger -> registerActivityIpc and MainProcessContext.operationLedger
rollback/dispose -> unregisterActivityIpc exactly once
```

Create and dispose two independent Main contexts with deterministic runtime-id factories. Assert the second context has a different `runtimeId`, sequence 0, empty events/active views, and zero health counters; no first-runtime event is recovered or presented as persistent history.

Assert `MainProcessContext` exposes the ledger, not recorder, health internals, AsyncLocalStorage, raw events, or job observer.

- [ ] **Step 2: Write failing direct/HTTP shared-runtime integration tests**

Use MCP `InMemoryTransport` for the direct server and the existing localhost HTTP test harness on `127.0.0.1` with an ephemeral port. Inject one recorder provider into both. Make multiple HTTP calls that create short-lived servers and one direct call, then assert one runtime id, one strictly increasing cursor, unique server operation/call ids despite repeated correlation ids, and a combined snapshot. The stdio proxy requires no edit because it forwards calls into the owner HTTP server.

- [ ] **Step 3: Run composition/integration tests and confirm RED**

Run:

```powershell
pnpm exec vitest run tests/unit/main/ipc/index.test.ts tests/unit/mcp/http-runtime-server.test.ts tests/integration/operation-ledger-mcp.test.ts
```

Expected: new identity/ledger assertions fail because Main does not yet compose Phase 1 services.

- [ ] **Step 4: Compose services once in Main**

In `registerIpcHandlers`, create:

```ts
const activityHealth = new ActivityHealthMonitor();
const operationLedger = new OperationLedger({ health: activityHealth });
const operationRecorder = new OperationRecorder({
  ledger: operationLedger,
  health: activityHealth,
});
const controlWorkflowJobManager = new ControlWorkflowJobManager({
  observer: (observation) => operationRecorder.observeWorkflowJob(observation),
});
const operationRecorderProvider: OperationRecorderProvider = (input) =>
  operationRecorder.beginMcpCall(input);
```

Pass the same provider to both server constructors, register `activity-ipc` with the same ledger, add rollback/dispose cleanup beside other IPC registrations, and return `operationLedger` in `MainProcessContext`. Keep health/recorder private.

- [ ] **Step 5: Document the honest supported topology**

Add a concise README paragraph stating that product/Agent calls run through Electron Main's direct server or localhost HTTP owner; the stdio integration is a proxy to that owner, so all supported calls share one activity runtime. State that `src/mcp/stdio-entry.ts` is a legacy non-default development executable, is not installed/advertised by current Agent integrations, and has no Phase 1 queryable ledger.

- [ ] **Step 6: Run composition, HTTP, and focused Phase 0 regression tests**

Run:

```powershell
pnpm exec vitest run tests/unit/main/ipc/index.test.ts tests/unit/mcp/http-runtime-server.test.ts tests/integration/operation-ledger-mcp.test.ts tests/unit/mcp/registry.test.ts tests/unit/mcp/registry-sdk-boundary.test.ts tests/unit/mcp/control-workflow-job-manager.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/integration/high-impact-confirmation.test.ts tests/unit/mcp/tool-risk-inventory.test.ts
```

Expected: all selected files pass; supported calls share one runtime/cursor; no real hardware dependency is invoked.

## Task 12: Review, verification, graph scope, and Phase 1 evidence

**Files:**

- Modify only after evidence: `openspec/changes/add-operation-event-ledger/tasks.md`
- No archive, commit, push, or PR

- [ ] **Step 1: Run every focused Phase 1 test together**

Run:

```powershell
pnpm exec vitest run tests/unit/shared/activity-contract.test.ts tests/unit/core/activity/activity-event.test.ts tests/unit/core/activity/operation-state.test.ts tests/unit/core/activity/activity-health.test.ts tests/unit/core/activity/risk-policy.test.ts tests/unit/core/activity/audit-redactor.test.ts tests/unit/core/activity/operation-ledger.test.ts tests/unit/core/activity/operation-recorder.test.ts tests/unit/mcp/registry.test.ts tests/unit/mcp/registry-sdk-boundary.test.ts tests/unit/mcp/control-workflow-job-manager.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/unit/main/ipc/activity-ipc.test.ts tests/unit/main/preload-activity.test.ts tests/unit/main/ipc/index.test.ts tests/unit/main/electron-runtime.test.ts tests/unit/mcp/http-runtime-server.test.ts tests/integration/high-impact-confirmation.test.ts tests/integration/operation-ledger-mcp.test.ts tests/unit/mcp/tool-risk-inventory.test.ts
```

Expected: every listed file passes. Record the fresh file/test counts and the normal-run activity snapshot showing capture-failure, dropped-event, eviction, and incomplete-lifecycle counts all exactly zero. Record small-capacity nonzero tests separately.

- [ ] **Step 2: Run authoritative local quality gates**

Run each independently and preserve exit codes:

```powershell
pnpm run lint
pnpm run build
pnpm run test
pnpm run validate:licenses
pnpm run test:coverage
Get-Item coverage/coverage-summary.json, coverage/index.html, coverage/lcov.info
pnpm audit --prod --audit-level high
pnpm run ci:check
```

Expected: all commands exit 0. Coverage remains report-only with fresh JSON/HTML/LCOV artifacts. Audit has no production vulnerability at the configured failing severity. These commands use fakes/mocks and must not touch hardware.

- [ ] **Step 3: Request independent requirements and code/security review**

Ask one reviewer to compare the complete diff with proposal/design/spec/tasks and another to review code quality/security. Require checks for write-before-ledger redaction, Proxy/accessor traps, finish-once, atomic batches, registry response parity, JobManager snapshot compatibility, Main-only trust objects, cursor hydration, supported transport scope, and Phase 2/5/7/8 scope exclusions. Apply only technically valid feedback, then rerun every affected focused test.

- [ ] **Step 4: Run completion verification**

Load and follow `agent-governance:verification-before-completion`, then run:

```powershell
openspec status --change add-operation-event-ledger --json
openspec validate add-operation-event-ledger --strict --json
openspec validate --all --json
git diff --check
git status --short
git diff -- src tests README.md openspec/changes/add-operation-event-ledger docs/superpowers/plans/2026-07-12-add-operation-event-ledger.md
```

Expected: OpenSpec is valid, whitespace checks pass, and the diff contains only planned Phase 1 plus preserved earlier worktree content.

- [ ] **Step 5: Run GitNexus changed-scope and directed security review**

Refresh the graph after all new symbols exist:

```powershell
node .gitnexus/run.cjs analyze --pdg
node .gitnexus/run.cjs status
```

Expected: the refreshed index includes the uncommitted Phase 1 source tree and a PDG layer. Record the indexed worktree/commit status explicitly; refreshing the graph does not replace `git diff` as the authority for uncommitted scope.

Run `detect_changes({ scope: "compare", base_ref: "main", repo: "link-mcp" })`. Inspect every changed indexed symbol and affected process, and separately account for untracked/new files that the old index cannot map.

Run directed PDG impact/slices and `explain` on at least:

```text
registerTool
toCallToolResult
redactToolObservation
OperationRecorder.beginMcpCall
OperationLedger.appendBatch
registerActivityIpc
ControlWorkflowJobManager
```

Review raw args/credentials/paths/scripts/binary/evidence/error source paths into JSON serialization, ledger retention, and IPC send sinks. Treat zero taint findings as limited supporting evidence because callback/closure, property, control-dependence, and context-sensitivity gaps remain; targeted secrecy/backend-count tests are the primary evidence.

- [ ] **Step 6: Close only evidenced OpenSpec tasks**

Check an item in `openspec/changes/add-operation-event-ledger/tasks.md` only after its tests/review/evidence exist. Do not archive the change. Re-run strict validation and `git diff --check` after checkbox edits.

- [ ] **Step 7: Stop at the Phase boundary**

Report Phase 1 only: files changed, exact test/build/license/audit/coverage evidence, normal zero counters, pressure-test counters, review resolution, GitNexus impact/detect_changes/PDG/taint evidence and caveats, in-memory-only limitation, legacy stdio exclusion, and absence of real hardware effects. Explicitly state that A+D remains incomplete and request authorization before entering Phase 2. Do not call `update_goal` with `complete`: the user-created Phase 0–8 Goal remains unfinished after Phase 1, even if its persisted tool status still reflects an earlier blocked audit. Do not create a duplicate Goal, commit, push, create a PR, archive OpenSpec, or start Phase 2.

## Plan self-review matrix

| OpenSpec requirement                                              | Implemented/tested by     |
| ----------------------------------------------------------------- | ------------------------- |
| Server operation/call identity and finish-once                    | Tasks 2, 6, 7             |
| Separate monotonic reducers and synthetic future retry            | Task 2                    |
| Strict internal/display contracts and mandatory producer metadata | Tasks 1, 3, 6, 8          |
| Exact 63-tool conservative policy                                 | Task 3                    |
| Write-before-ledger bounded redaction                             | Task 4                    |
| Bounded atomic cursor-correct ledger and health                   | Task 5                    |
| Best-effort observation cannot change outcomes                    | Tasks 6, 7, 8             |
| Every entered supported registry handler                          | Task 7                    |
| Sanitized workflow-job milestones                                 | Tasks 6, 8                |
| One Main ledger across direct/HTTP/stdio proxy                    | Task 11                   |
| Strict snapshot/event IPC and preload                             | Tasks 9, 10, 11           |
| Phase 1 side-channel scope only                                   | Scope rules, Tasks 11, 12 |
