# LinkTerm Phase 0 Characterization and CI Gates Implementation Plan

> **For agentic workers:** Keep `agent-workflow-governance` as the sole main entry. Use `test-driven-development` as an implementation constraint and execute this plan task-by-task in the current worktree. Every step uses checkbox (`- [ ]`) tracking. Do not commit, push, create a PR, archive the OpenSpec change, or enter Phase 1 without explicit user authorization.

**Goal:** 完成 `establish-characterization-ci-gates`：在不修改 `src/` 或产品行为的前提下，锁定现有共享边界，交付经审阅的 63-tool 风险清单、三平台 CI、全源码 coverage report 和 GitNexus 治理证据。

**Architecture:** 生产实现保持原样，characterization 通过现有公开入口、真实 MCP SDK、`SessionManager` 的受控实例 spy、fake backend 和确定性时钟来锁定当前行为。风险清单位于 `docs/security/`，由 TypeScript compiler AST 测试验证注册名、surface 和 sensitivity；它只是一份 review data，不进入运行时授权。质量门禁由本地聚合命令与 GitHub Actions matrix 复用，coverage 只报告基线，不设置阈值。

**Tech Stack:** Electron 42、TypeScript 6、Vitest 4.1.8、V8 coverage、Zod 4、MCP SDK 1.29、pnpm 9.15、GitHub Actions、GitNexus PDG/taint、OpenSpec。

---

## Phase boundary and fresh baseline

- 本计划只实现 Phase 0；Operation Ledger、Activity Center、Readiness、First Signal、Human Approval、J-Link/RTT journey、Pause/Take Over、durable audit 均不在本计划中。
- `src/` 必须保持零 diff。测试不得打开真实串口、SSH、probe、RTT、GDB server，不得执行擦除、烧录或复位。
- 当前 HEAD 与 GitNexus index 均为 `ac1a329810042979aaa05d85aff0f87be19eb711`；`.gitnexusrc` 为 `{"pdg": true}`。
- 当前生产注册事实为 63 tools：25 `read-only`、38 `state-affecting`；`src/mcp/tool-set.ts` 的 57-tool core diagnostics 清单不能代替 AST 完整性检查。
- 实施规划前的自动测试基线为 107 文件：99 unit、8 integration；当时没有 `.skip`、`.todo` 或 `.only`。
- 当前 OpenSpec 严格验证为 35/35：1 active change + 34 canonical specs。
- 实施规划前的工作树只有用户已有/已授权的 `.gitnexusrc`、A+D 规格包和 Phase 0 OpenSpec；这些内容必须保留。

### GitNexus edit boundary

| Symbol                         |     Risk | Direct | Total | Processes | Modules | Phase 0 decision                    |
| ------------------------------ | -------: | -----: | ----: | --------: | ------: | ----------------------------------- |
| `registerTool`                 |     HIGH |     11 |    15 |         2 |       3 | 只通过测试观察，不编辑              |
| `SessionManager.createAndOpen` |     HIGH |      6 |    12 |         3 |       3 | 只通过实例 spy 调用真实实现，不编辑 |
| `buildSession`                 | CRITICAL |      3 |     8 |         4 |       5 | 不编辑；测试替换传入 factory        |
| `ControlWorkflowJobManager`    |     HIGH |      9 |    19 |         3 |       3 | 只扩展测试，不编辑 class            |

如果执行过程中出现必须修改上述符号或任何其他既有函数、类、方法的证据，立即停止：重新运行 upstream impact，先向用户报告 HIGH/CRITICAL、direct callers、affected processes 和 modules，再等待明确授权。不得把 characterization 失败静默修成新的产品行为。

## File map

**Characterization tests**

- Modify: `tests/unit/mcp/registry.test.ts` — 补 success once 与 handler-declared failure。
- Create: `tests/unit/mcp/registry-sdk-boundary.test.ts` — 真实 MCP SDK pre-handler validation。
- Modify: `tests/integration/high-impact-confirmation.test.ts` — 补 binary `confirm:false` precedence；保留七工具 7×3 矩阵。
- Modify: `tests/unit/mcp/control-workflow-tools.test.ts` — 三种 mode、sync/background、omitted/false 与 background-requested dry-run。
- Modify: `tests/unit/mcp/runtime-control-tools.test.ts` — `confirm:false` 时 fake scheduler=0。
- Modify: `tests/unit/main/ipc/control-profile-ipc.test.ts` — 明确 `CONTROL_PROFILE_RUN_DOWNLOAD` 与 `CONTROL_PROFILE_START_DOWNLOAD` 都注入当前 caller acknowledgement。
- Modify: `tests/unit/main/ipc/session-create.test.ts` — Renderer open/errored/pre-registration 三种语义。
- Modify: `tests/unit/mcp/terminal-tools.test.ts` — MCP `open_session` rollback、`INTERNAL`、零 ghost/lifecycle event。
- Modify: `tests/unit/mcp/control-workflow-job-manager.test.ts` — 精确浅复制边界、失败、取消、默认 TTL/cap 与现有限制。
- Create: `tests/unit/mcp/tool-risk-inventory.test.ts` — TypeScript AST + inventory contract。

**Review data and documentation**

- Create: `docs/security/mcp-tool-risk-inventory.json` — 63 项权威 Phase 0 review data。
- Create: `docs/security/mcp-tool-risk-inventory.md` — 字段、风险等级、已知门禁缺口和非授权声明。
- Create: `docs/engineering/quality-gates.md` — 本地/CI 命令、平台边界、coverage baseline 解释。
- Create: `docs/security/gitnexus-governance.md` — impact、PDG/taint、detect_changes 和证据边界。
- Include unchanged: `.gitnexusrc` — clean checkout 继承 `pdg: true`。
- Modify: `openspec/changes/establish-characterization-ci-gates/tasks.md` — 只在证据完成后逐项勾选。

**Tooling and CI**

- Modify: `package.json` — 精确 coverage dependency 对应脚本与 `ci:check`。
- Modify mechanically: `pnpm-lock.yaml` — 由 pnpm 生成。
- Modify: `vitest.config.ts` — 全源码、四种 reporter、零 threshold。
- Modify: `.gitignore` — 忽略 `coverage/`。
- Create: `.github/workflows/quality.yml` — Windows/Ubuntu/macOS quality matrix + Ubuntu coverage artifact。

---

### Task 1: Lock the registry wrapper and real SDK boundary

**Files:**

- Modify: `tests/unit/mcp/registry.test.ts`
- Create: `tests/unit/mcp/registry-sdk-boundary.test.ts`
- Test: `tests/unit/mcp/registry.test.ts`
- Test: `tests/unit/mcp/registry-sdk-boundary.test.ts`

- [ ] **Step 1: Confirm the existing registry tests are green**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry.test.ts
```

Expected: `1 passed`, existing registry tests all pass.

- [ ] **Step 2: Append success-once and handler-declared-failure characterizations**

Add `vi` to the existing Vitest import, then append these tests inside the existing `describe` block:

```ts
it('invokes a successful handler exactly once and preserves its evidence', async () => {
  const { server, tools } = fakeServer();
  const handler = vi.fn(() => ({
    success: true as const,
    sessionId: 'sess_characterized',
    state: 'open',
    evidence: { kind: 'app_status' as const, data: { ok: true }, cursor: 7 },
  }));

  registerTool(server, {
    name: 'success_once',
    description: 'success characterization',
    sensitivity: 'read-only',
    inputSchema: schema,
    handler,
  });

  const out = structured(await tools[0]!.callback({ correlationId: 'corr-success' }));

  expect(handler).toHaveBeenCalledOnce();
  expect(out).toMatchObject({
    success: true,
    sessionId: 'sess_characterized',
    state: 'open',
    correlationId: 'corr-success',
    origin: 'ai',
    schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
    evidence: { kind: 'app_status', data: { ok: true }, cursor: 7 },
  });
});

it('preserves a handler-declared failure and invokes the handler exactly once', async () => {
  const { server, tools } = fakeServer();
  const handler = vi.fn(() => ({
    success: false as const,
    sessionId: 'sess_failed',
    state: 'errored',
    error: {
      code: 'INVALID_STATE' as const,
      message: 'characterized failure',
      details: { reason: 'fixture' },
    },
  }));

  registerTool(server, {
    name: 'declared_failure',
    description: 'failure characterization',
    sensitivity: 'read-only',
    inputSchema: schema,
    handler,
  });

  const result = await tools[0]!.callback({ correlationId: 'corr-failure' });
  const out = structured(result);

  expect(handler).toHaveBeenCalledOnce();
  expect(result.isError).toBe(true);
  expect(out).toMatchObject({
    success: false,
    sessionId: 'sess_failed',
    state: 'errored',
    correlationId: 'corr-failure',
    origin: 'ai',
    schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
    error: {
      code: 'INVALID_STATE',
      message: 'characterized failure',
      details: { reason: 'fixture' },
    },
  });
});
```

- [ ] **Step 3: Run the registry unit test after each appended case**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry.test.ts
```

Expected: all registry tests pass; no `src/` edit is needed. Characterization is expected to be GREEN because it captures existing behavior.

- [ ] **Step 4: Write the real-SDK pre-handler boundary test**

Create `tests/unit/mcp/registry-sdk-boundary.test.ts` with this complete test:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerTool } from '@/mcp/registry.js';

describe('MCP SDK pre-handler validation boundary', () => {
  it('rejects invalid input before the LinkTerm handler or fake backend runs', async () => {
    const server = new McpServer({ name: 'registry-boundary-server', version: '1.0.0' });
    const client = new Client({ name: 'registry-boundary-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const handlerCalls = vi.fn();
    const backendCalls = vi.fn();

    registerTool(server, {
      name: 'sdk_validated_tool',
      description: 'SDK validation characterization',
      sensitivity: 'state-affecting',
      inputSchema: z
        .object({
          payload: z.string(),
          correlationId: z.string().optional(),
          clientSchemaVersion: z.string().optional(),
        })
        .strict(),
      handler: () => {
        handlerCalls();
        backendCalls();
        return {
          success: true,
          evidence: { kind: 'app_status', data: { started: true }, cursor: 0 },
        };
      },
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'sdk_validated_tool',
        arguments: { payload: 42 },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringMatching(/Input validation error|Invalid arguments/u),
        }),
      ]);
      expect(handlerCalls).not.toHaveBeenCalled();
      expect(backendCalls).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
```

- [ ] **Step 5: Prove the SDK test uses the real validation result**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry-sdk-boundary.test.ts
```

Expected: `1 passed`; the Client promise resolves with `isError:true`, no LinkTerm `structuredContent`, handler=0, backend=0. Do not change the expectation to a rejected promise.

- [ ] **Step 6: Review the task diff without staging or committing**

Run:

```powershell
git diff -- tests/unit/mcp/registry.test.ts tests/unit/mcp/registry-sdk-boundary.test.ts
git diff -- src
```

Expected: only the two test paths differ; `git diff -- src` is empty.

---

### Task 2: Characterize every current caller-acknowledgement path

**Files:**

- Modify: `tests/integration/high-impact-confirmation.test.ts`
- Modify: `tests/unit/mcp/control-workflow-tools.test.ts`
- Modify: `tests/unit/mcp/runtime-control-tools.test.ts`
- Modify: `tests/unit/main/ipc/control-profile-ipc.test.ts`

- [ ] **Step 1: Confirm the four existing acknowledgement suites are green**

Run:

```powershell
pnpm exec vitest run tests/integration/high-impact-confirmation.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/mcp/runtime-control-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts
```

Expected: all four files pass with fake-only dependencies.

- [ ] **Step 2: Add binary-decode precedence for explicit false acknowledgement**

Append to `high-impact-confirmation.test.ts`:

```ts
it.each([
  {
    tool: 'flash_download',
    backendMethod: 'flashDownload',
    args: { binaryBase64: '@@@' },
  },
  {
    tool: 'flash_write',
    backendMethod: 'flashWrite',
    args: { address: 0x0800_0000, dataBase64: '@@@' },
  },
])(
  '$tool treats confirm:false as caller acknowledgement failure before decoding',
  async ({ tool, backendMethod, args }) => {
    const callsBefore = h.fake.callsOf(backendMethod).length;
    const out = await callTool(h.client, tool, {
      probeId: h.probeId,
      ...args,
      confirm: false,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
    expect(h.fake.callsOf(backendMethod)).toHaveLength(callsBefore);
  },
);
```

Keep the existing 7 tools × omitted/false/true matrix. Its `confirm:true` backend increment proves only current caller acknowledgement, never human approval.

- [ ] **Step 3: Add the exact synchronous/background workflow rejection matrix**

Append inside the existing control-workflow `describe` block:

```ts
it.each([
  {
    label: 'sync debug-diagnose omitted',
    mode: 'debug-diagnose',
    execution: undefined,
    confirm: undefined,
  },
  {
    label: 'sync debug-diagnose false',
    mode: 'debug-diagnose',
    execution: undefined,
    confirm: false,
  },
  {
    label: 'sync flash-observe omitted',
    mode: 'flash-observe',
    execution: undefined,
    confirm: undefined,
  },
  {
    label: 'sync flash-observe false',
    mode: 'flash-observe',
    execution: undefined,
    confirm: false,
  },
  {
    label: 'sync flash-observe-diagnose omitted',
    mode: 'flash-observe-diagnose',
    execution: undefined,
    confirm: undefined,
  },
  {
    label: 'sync flash-observe-diagnose false',
    mode: 'flash-observe-diagnose',
    execution: undefined,
    confirm: false,
  },
  {
    label: 'background debug-diagnose omitted',
    mode: 'debug-diagnose',
    execution: { mode: 'background' },
    confirm: undefined,
  },
  {
    label: 'background debug-diagnose false',
    mode: 'debug-diagnose',
    execution: { mode: 'background' },
    confirm: false,
  },
  {
    label: 'background flash-observe omitted',
    mode: 'flash-observe',
    execution: { mode: 'background' },
    confirm: undefined,
  },
  {
    label: 'background flash-observe false',
    mode: 'flash-observe',
    execution: { mode: 'background' },
    confirm: false,
  },
  {
    label: 'background flash-observe-diagnose omitted',
    mode: 'flash-observe-diagnose',
    execution: { mode: 'background' },
    confirm: undefined,
  },
  {
    label: 'background flash-observe-diagnose false',
    mode: 'flash-observe-diagnose',
    execution: { mode: 'background' },
    confirm: false,
  },
] as const)(
  'rejects $label before job, session, or backend effects',
  async ({ mode, execution, confirm }) => {
    await initProfile(h);
    const args = {
      root: h.root,
      mode,
      ...(execution === undefined ? {} : { execution }),
      ...(confirm === undefined ? {} : { confirm }),
    };

    const out = await callTool(h.client, 'run_control_workflow', args);

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
    expect(h.jobManager.listJobs()).toHaveLength(0);
    expect(h.openSerialCalls).toHaveLength(0);
    expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
    expect(h.fake.callsOf('cpuReset')).toHaveLength(0);
    expect(h.fake.callsOf('gdbServerStart')).toHaveLength(0);
  },
);
```

All three modes currently accepted by the schema already satisfy the high-impact policy. Keep the
separate `debug.haltOnFailure` case only as a non-bypass regression: adding the flag must not weaken
the existing mode gate. It cannot prove that the flag independently causes confirmation because no
schema-valid low-impact mode exists in Phase 0.

- [ ] **Step 4: Add background-requested dry-run characterization**

Append:

```ts
it('returns planning evidence for a background-requested dry run without creating a job', async () => {
  await initProfile(h);

  const out = await callTool(h.client, 'run_control_workflow', {
    root: h.root,
    mode: 'flash-observe-diagnose',
    execution: { mode: 'background' },
    dryRun: true,
  });

  expect(out.success).toBe(true);
  const planned = (out.evidence as { data: Record<string, unknown> }).data;
  expect(planned).not.toHaveProperty('jobId');
  expect(h.jobManager.listJobs()).toHaveLength(0);
  expect(h.openSerialCalls).toHaveLength(0);
  expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
  expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
  expect(h.fake.callsOf('cpuReset')).toHaveLength(0);
  expect(h.fake.callsOf('gdbServerStart')).toHaveLength(0);
});
```

- [ ] **Step 5: Add explicit false runtime-restart acknowledgement**

Append to `runtime-control-tools.test.ts`:

```ts
it('does not call the fake restart scheduler when confirm is false', async () => {
  const out = await callTool(h.client, 'restart_mcp_runtime', { confirm: false });

  expect(out.success).toBe(false);
  expect(out.error).toMatchObject({
    code: 'CONFIRMATION_REQUIRED',
    details: { tool: 'restart_mcp_runtime' },
  });
  expect(h.restartRequests).toEqual([]);
});
```

Keep the existing `confirm:true` test and its exact `restartRequests` length of one; describe it as one fake scheduler call, not proof that an OS restart completed.

- [ ] **Step 6: Add synchronous direct Download input capture**

In the existing `vi.hoisted` object in `control-profile-ipc.test.ts`, add `runControlWorkflowMock: vi.fn()`. Add this module mock before importing `registerControlProfileIpc`:

```ts
vi.mock('../../../../src/mcp/surfaces/control-workflow/workflow-runner.js', () => ({
  runControlWorkflow: runControlWorkflowMock,
}));
```

Reset the mock in `beforeEach` and give it this deterministic result:

```ts
runControlWorkflowMock.mockReset();
runControlWorkflowMock.mockResolvedValue({
  mode: 'flash-observe',
  root: 'C:/repo',
  steps: [],
  summary: {
    serialOpened: false,
    probeConnected: false,
    gdbServerStarted: false,
    flashed: false,
    verified: false,
    reset: false,
    serialObserved: false,
    rttObserved: false,
    debugCaptured: false,
  },
  nextActions: [],
});
```

Append this test:

```ts
it('characterizes RUN_DOWNLOAD confirm:true as caller acknowledgement, not human approval', async () => {
  registerControlProfileIpc({} as ControlProfileManager, undefined, {
    sessionManager: {},
    jlinkBackend: {},
  } as never);

  const run = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD)!;
  const result = await run({}, { root: 'C:/repo' });

  expect(result).toEqual({
    success: true,
    data: expect.objectContaining({ mode: 'flash-observe', root: 'C:/repo' }),
  });
  expect(runControlWorkflowMock).toHaveBeenCalledOnce();
  expect(runControlWorkflowMock.mock.calls[0]?.[1]).toEqual({
    root: 'C:/repo',
    mode: 'flash-observe',
    confirm: true,
    observe: { enabled: false, serial: false },
  });
});
```

Retain the existing `CONTROL_PROFILE_START_DOWNLOAD` fake job-manager assertion. Together these freeze both IPC channels; the injected `confirm:true` remains caller acknowledgement.

- [ ] **Step 7: Run the acknowledgement group**

Run:

```powershell
pnpm exec vitest run tests/integration/high-impact-confirmation.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/mcp/runtime-control-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts
```

Expected: all four files pass; all omitted/false paths have job/session/backend/scheduler count zero; no real hardware runs.

- [ ] **Step 8: Review scope without staging or committing**

Run:

```powershell
git diff -- tests/integration/high-impact-confirmation.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/mcp/runtime-control-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts
git diff -- src
```

Expected: test-only diff; `src/` empty.

---

### Task 3: Freeze Renderer-retain versus MCP-rollback session semantics

**Files:**

- Modify: `tests/unit/main/ipc/session-create.test.ts`
- Modify: `tests/unit/mcp/terminal-tools.test.ts`
- Reference only: `tests/unit/core/session-manager.test.ts`

- [ ] **Step 1: Confirm the existing two-entry baseline**

Run:

```powershell
pnpm exec vitest run tests/unit/main/ipc/session-create.test.ts tests/unit/mcp/terminal-tools.test.ts tests/unit/core/session-manager.test.ts
```

Expected: all three files pass before additions.

- [ ] **Step 2: Add a controlled test session and valid Renderer request**

Add imports for `SessionBase`, `SessionId`, and `MockTransport` to `session-create.test.ts`, then add:

```ts
class CharacterizationSession extends SessionBase {
  constructor(id: SessionId, transport: MockTransport) {
    super({ id, transport });
  }
}

const validSerialRequest = {
  config: {
    type: 'serial',
    port: 'COM7',
    baudRate: 115200,
    mode: 'terminal',
  },
} as const;
```

- [ ] **Step 3: Add Renderer open, retained errored, and construction failure cases**

Append inside `describe('registerSessionCreate')`:

```ts
it('returns success with a registered open session', async () => {
  const sm = new SessionManager();
  const realCreate = sm.create.bind(sm);
  vi.spyOn(sm, 'create').mockImplementation((_factory, metadata) =>
    realCreate((id) => new CharacterizationSession(id, new MockTransport()), metadata),
  );
  registerSessionCreate(sm);

  const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;
  const result = (await handler({}, validSerialRequest)) as {
    success: true;
    data: { sessionId: SessionId; state: string };
  };

  expect(result).toMatchObject({ success: true, data: { state: 'open' } });
  expect(sm.has(result.data.sessionId)).toBe(true);
  expect(sm.summaryOf(result.data.sessionId)).toMatchObject({ state: 'open' });
});

it('returns success with a retained errored session after transport open fails', async () => {
  const sm = new SessionManager();
  const realCreate = sm.create.bind(sm);
  vi.spyOn(sm, 'create').mockImplementation((_factory, metadata) =>
    realCreate(
      (id) =>
        new CharacterizationSession(id, new MockTransport({ failOnOpen: new Error('port busy') })),
      metadata,
    ),
  );
  registerSessionCreate(sm);

  const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;
  const result = (await handler({}, validSerialRequest)) as {
    success: true;
    data: { sessionId: SessionId; state: string };
  };

  expect(result).toMatchObject({ success: true, data: { state: 'errored' } });
  expect(sm.has(result.data.sessionId)).toBe(true);
  expect(sm.listSummaries()).toContainEqual(
    expect.objectContaining({
      sessionId: result.data.sessionId,
      state: 'errored',
      connectionType: 'serial',
    }),
  );
});

it('returns INTERNAL without registering a session when construction fails', async () => {
  const sm = new SessionManager();
  vi.spyOn(sm, 'create').mockImplementationOnce(() => {
    throw new Error('manager create failed');
  });
  registerSessionCreate(sm);

  const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;
  const result = await handler({}, validSerialRequest);

  expect(result).toEqual({
    success: false,
    error: { code: 'INTERNAL', message: 'manager create failed' },
  });
  expect(sm.list()).toEqual([]);
});
```

- [ ] **Step 4: Run Renderer characterization**

Run:

```powershell
pnpm exec vitest run tests/unit/main/ipc/session-create.test.ts
```

Expected: 7 tests pass; open failure remains `success:true/state:'errored'` and manager retains the session.

- [ ] **Step 5: Add the MCP rollback boundary case**

Add `vi` to the Vitest import in `terminal-tools.test.ts`, then append:

```ts
it('rolls back a failed open_session candidate and emits no lifecycle events', async () => {
  const created = vi.fn();
  const destroyed = vi.fn();
  const sessionEvents = vi.fn();
  harness.manager.on('session:created', created);
  harness.manager.on('session:destroyed', destroyed);
  harness.manager.on('session:event', sessionEvents);

  const realCreateAndOpen = harness.manager.createAndOpen.bind(harness.manager);
  vi.spyOn(harness.manager, 'createAndOpen').mockImplementationOnce((_factory, metadata) =>
    realCreateAndOpen(
      (id) => new TestSession(id, new MockTransport({ failOnOpen: new Error('port busy') })),
      metadata,
    ),
  );

  const out = await callTool(harness.client, 'open_session', {
    config: {
      type: 'serial',
      port: 'COM7',
      baudRate: 115200,
      mode: 'terminal',
    },
  });

  expect(out).toMatchObject({
    success: false,
    error: { code: 'INTERNAL' },
  });
  expect(harness.manager.list()).toEqual([]);
  expect(harness.manager.listSummaries()).toEqual([]);
  expect(created).not.toHaveBeenCalled();
  expect(destroyed).not.toHaveBeenCalled();
  expect(sessionEvents).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run the dual-entry comparison**

Run:

```powershell
pnpm exec vitest run tests/unit/main/ipc/session-create.test.ts tests/unit/mcp/terminal-tools.test.ts tests/unit/core/session-manager.test.ts
```

Expected: Renderer retains errored metadata under success; MCP returns structured `INTERNAL`, manager lists are empty, and all three candidate lifecycle spies remain zero.

- [ ] **Step 7: Review scope without staging or committing**

Run:

```powershell
git diff -- tests/unit/main/ipc/session-create.test.ts tests/unit/mcp/terminal-tools.test.ts
git diff -- src
```

Expected: test-only diff; `src/` empty.

---

### Task 4: Characterize the exact ControlWorkflowJobManager contract

**Files:**

- Modify: `tests/unit/mcp/control-workflow-job-manager.test.ts`

The production class must not change. Existing tests already cover success lifecycle, single-active rejection, running cancellation and basic custom TTL/cap cleanup. Add only the missing exact contracts below.

- [ ] **Step 1: Confirm the existing job-manager baseline**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/control-workflow-job-manager.test.ts
```

Expected: the existing four tests pass.

- [ ] **Step 2: Add exact structural-copy-boundary characterization**

Append:

```ts
it('copies exactly the workflow structures owned by the current clone boundary', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const manager = new ControlWorkflowJobManager({ createId: () => 'job-copy' });
  manager.create({ input: input() });
  const workflow: ControlWorkflowData = {
    ...data('C:/workspace'),
    steps: [
      {
        id: 'probe',
        status: 'failed',
        durationMs: 1,
        error: { code: 'PROBE_BUSY', message: 'busy' },
        evidence: { nested: { value: 'not-deep-cloned' } },
      },
    ],
    summary: { ...data().summary, probeConnected: true },
    nextActions: [{ kind: 'retry', message: 'Retry probe connection', tool: 'probe_connect' }],
    blockingReasons: [
      { kind: 'jlink_gdb_server_start_failed', code: 'PROBE_BUSY', message: 'busy' },
    ],
  };

  const completion = manager.start('job-copy', async ({ update }) => {
    update(workflow);
    await gate;
    return workflow;
  });

  workflow.steps[0]!.id = 'mutated-step';
  workflow.steps[0]!.error!.message = 'mutated-error';
  workflow.summary.probeConnected = false;
  workflow.nextActions[0]!.tool = 'mutated-tool';
  workflow.blockingReasons![0]!.message = 'mutated-reason';

  expect(manager.read('job-copy').workflow).toMatchObject({
    steps: [{ id: 'probe', error: { message: 'busy' } }],
    summary: { probeConnected: true },
    nextActions: [{ tool: 'probe_connect' }],
    blockingReasons: [{ message: 'busy' }],
  });

  release();
  await completion;
});
```

Do not add an assertion claiming deep cloning for `steps[].evidence`; current code intentionally has no such guarantee in Phase 0.

- [ ] **Step 3: Add failedStep and thrown-runner terminalization**

Append:

```ts
it('marks a resolved workflow with failedStep as failed', async () => {
  const manager = new ControlWorkflowJobManager({ createId: () => 'job-failed-step' });
  manager.create({ input: input() });
  const failed = {
    ...data('C:/workspace', [
      { id: 'load_profile', status: 'passed' },
      { id: 'flash', status: 'failed' },
    ]),
    failedStep: 'flash',
  };

  const result = await manager.start('job-failed-step', async () => failed);

  expect(result).toMatchObject({ state: 'failed', currentStepId: 'flash' });
  expect(result.workflow).toEqual(failed);
});

it.each([
  {
    label: 'ToolError',
    error: new ToolError('PROBE_BUSY', 'probe is busy'),
    code: 'PROBE_BUSY',
  },
  {
    label: 'unexpected error',
    error: new Error('runner exploded'),
    code: 'INTERNAL',
  },
])('appends job_failed for $label', async ({ error, code }) => {
  const manager = new ControlWorkflowJobManager({ createId: () => `job-throw-${code}` });
  const job = manager.create({ input: input() });

  const result = await manager.start(job.jobId, async () => {
    throw error;
  });

  expect(result).toMatchObject({ state: 'failed', currentStepId: 'job_failed' });
  expect(result.workflow?.steps.at(-1)).toMatchObject({
    id: 'job_failed',
    status: 'failed',
    error: { code },
  });
});
```

- [ ] **Step 4: Add queued and terminal cancellation cases**

Append:

```ts
it('cancels a queued job without starting a runner', () => {
  const manager = new ControlWorkflowJobManager({ createId: () => 'job-queued' });
  manager.create({ input: input() });

  const result = manager.cancel('job-queued');

  expect(result).toMatchObject({
    state: 'cancelled',
    cancelRequested: true,
    currentStepId: 'job_cancelled',
  });
  expect(result.workflow?.steps.at(-1)).toMatchObject({
    id: 'job_cancelled',
    error: { code: 'ABORTED' },
  });
});

it('keeps terminal cancellation idempotent', async () => {
  let now = 100;
  const manager = new ControlWorkflowJobManager({
    now: () => now,
    createId: () => 'job-terminal',
  });
  manager.create({ input: input() });
  await manager.start('job-terminal', async () => data());
  const before = manager.read('job-terminal');
  now = 999;

  expect(manager.cancel('job-terminal')).toEqual(before);
  expect(manager.read('job-terminal')).toEqual(before);
});
```

- [ ] **Step 5: Add production-default TTL and cap behavior**

Append:

```ts
it('uses the production 30-minute TTL without expiring active jobs', async () => {
  let now = 0;
  let nextId = 0;
  const manager = new ControlWorkflowJobManager({
    now: () => now,
    createId: () => `job-ttl-${++nextId}`,
  });
  const terminal = manager.create({ input: input('C:/terminal') });
  await manager.start(terminal.jobId, async () => data('C:/terminal'));
  const active = manager.create({ input: input('C:/active') });

  now = 30 * 60 * 1000 - 1;
  expect(manager.getStatus(terminal.jobId).state).toBe('succeeded');
  now = 30 * 60 * 1000;
  expect(() => manager.getStatus(terminal.jobId)).toThrow(/not found/i);
  expect(manager.getStatus(active.jobId).state).toBe('queued');
});

it('enforces the production 32-job cap after runner completion by updatedAt', async () => {
  let now = 0;
  let nextId = 0;
  const manager = new ControlWorkflowJobManager({
    now: () => now,
    createId: () => `job-cap-${++nextId}`,
  });

  for (let index = 1; index <= 33; index += 1) {
    now = index;
    const job = manager.create({ input: input(`C:/job-${index}`) });
    await manager.start(job.jobId, async () => data(`C:/job-${index}`));
  }

  const ids = manager.listJobs().map((job) => job.jobId);
  expect(ids).toHaveLength(32);
  expect(ids).not.toContain('job-cap-1');
  expect(ids).toContain('job-cap-33');
});

it('characterizes queued-cancellation over-cap retention until a later completion', async () => {
  let nextId = 0;
  const manager = new ControlWorkflowJobManager({
    createId: () => `job-cancel-cap-${++nextId}`,
  });

  for (let index = 1; index <= 33; index += 1) {
    const job = manager.create({ input: input(`C:/cancel-${index}`) });
    manager.cancel(job.jobId);
  }
  expect(manager.listJobs()).toHaveLength(33);

  const converging = manager.create({ input: input('C:/converge') });
  await manager.start(converging.jobId, async () => data('C:/converge'));
  expect(manager.listJobs()).toHaveLength(32);
});
```

- [ ] **Step 6: Add explicit cleanup active-job protection**

Append:

```ts
it('cleanup removes matching terminal jobs but preserves active jobs', async () => {
  let nextId = 0;
  const manager = new ControlWorkflowJobManager({
    createId: () => `job-cleanup-${++nextId}`,
  });
  const terminal = manager.create({ input: input('C:/terminal') });
  await manager.start(terminal.jobId, async () => data('C:/terminal'));
  const active = manager.create({ input: input('C:/active') });

  expect(manager.cleanup({ jobId: active.jobId })).toEqual({ removed: 0 });
  expect(manager.getStatus(active.jobId).state).toBe('queued');
  expect(manager.cleanup({ jobId: terminal.jobId })).toEqual({ removed: 1 });
  expect(() => manager.getStatus(terminal.jobId)).toThrow(/not found/i);
  expect(manager.cleanup()).toEqual({ removed: 0 });
  expect(manager.getStatus(active.jobId).state).toBe('queued');
});
```

- [ ] **Step 7: Run the exact job-manager suite**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/control-workflow-job-manager.test.ts
```

Expected: all old and new tests pass against unchanged production code. If the structural-copy or cap tests fail, compare the assertion to the revised OpenSpec before considering any implementation change.

- [ ] **Step 8: Review scope without staging or committing**

Run:

```powershell
git diff -- tests/unit/mcp/control-workflow-job-manager.test.ts
git diff -- src
```

Expected: one test file differs; `src/` empty.

---

### Task 5: Build and review the exact 63-tool inventory

**Files:**

- Create: `tests/unit/mcp/tool-risk-inventory.test.ts`
- Create: `docs/security/mcp-tool-risk-inventory.json`
- Create: `docs/security/mcp-tool-risk-inventory.md`

- [ ] **Step 1: Write the failing AST inventory validator first**

Create `tests/unit/mcp/tool-risk-inventory.test.ts`. The following code block records the initial
RED skeleton used before adversarial review; it is historical, non-normative, and must not be copied
as the final validator. The executable test file plus the post-review invariant list below are the
final implementation truth:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_ROOT = join(ROOT, 'src');
const MCP_ROOT = join(ROOT, 'src', 'mcp');
const SURFACES = join(MCP_ROOT, 'surfaces');
const INVENTORY = join(ROOT, 'docs', 'security', 'mcp-tool-risk-inventory.json');

const REQUIRED_ACKNOWLEDGEMENT = [
  'cpu_reset',
  'flash_download',
  'flash_erase',
  'flash_write',
  'gdb_server_start',
  'jlink_commander_script',
  'jlink_reboot',
  'restart_mcp_runtime',
] as const;
const CONDITIONAL_ACKNOWLEDGEMENT = ['run_control_workflow'] as const;

const entrySchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    surface: z.string().min(1),
    sensitivity: z.enum(['read-only', 'state-affecting']),
    risk: z.enum(['read-only', 'state-affecting', 'disruptive', 'destructive-or-unknown']),
    acknowledgementPolicy: z.enum([
      'none',
      'client-acknowledgement-required',
      'conditional-client-acknowledgement',
    ]),
    acknowledgementCondition: z.string().min(1).optional(),
    futureApprovalPolicy: z.literal('unassigned'),
    rationale: z.string().trim().min(12),
  })
  .strict()
  .superRefine((entry, context) => {
    const conditional = entry.acknowledgementPolicy === 'conditional-client-acknowledgement';
    if (conditional !== (entry.acknowledgementCondition !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['acknowledgementCondition'],
        message: 'condition is present exactly for conditional acknowledgement',
      });
    }
  });

const inventorySchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    authority: z.literal('review-data-only'),
    sourcePattern: z.literal('src/**/*.{ts,tsx}'),
    tools: z.array(entrySchema).length(63),
  })
  .strict();

interface Registration {
  name: string;
  surface: string;
  sensitivity: 'read-only' | 'state-affecting';
  source: string;
  line: number;
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(path);
      return entry.isFile() &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.endsWith('.d.ts')
        ? [path]
        : [];
    });
}

function normalizedRelative(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

function property(
  object: ts.ObjectLiteralExpression,
  key: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find((candidate): candidate is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(candidate)) return false;
    return (
      (ts.isIdentifier(candidate.name) || ts.isStringLiteralLike(candidate.name)) &&
      candidate.name.text === key
    );
  });
}

function requiredLiteral(
  object: ts.ObjectLiteralExpression,
  key: string,
  file: string,
  sourceFile: ts.SourceFile,
): string {
  const assignment = property(object, key);
  if (!assignment || !ts.isStringLiteralLike(assignment.initializer)) {
    const position = sourceFile.getLineAndCharacterOfPosition(object.getStart(sourceFile));
    throw new Error(
      `${normalizedRelative(file)}:${position.line + 1}: registerTool ${key} must be a string literal`,
    );
  }
  return assignment.initializer.text;
}

function scanSourceRegistrations(file: string, sourceText: string): Registration[] {
  const registrations: Registration[] = [];
  let centralSdkBridgeCalls = 0;
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const directCallees = new Set<string>();
  const namespaceCallees = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      /(^|\/)registry\.js$/u.test(statement.moduleSpecifier.text)
    ) {
      const exports = statement.exportClause;
      const reexportsRegisterTool =
        !exports ||
        ts.isNamespaceExport(exports) ||
        exports.elements.some(
          (element) => (element.propertyName?.text ?? element.name.text) === 'registerTool',
        );
      if (reexportsRegisterTool) {
        throw new Error(`${normalizedRelative(file)}: registerTool must not be re-exported`);
      }
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !/(^|\/)registry\.js$/u.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName === 'registerTool') directCallees.add(element.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceCallees.add(bindings.name.text);
    }
  }

  const isRegisterToolCallee = (expression: ts.LeftHandSideExpression): boolean =>
    (ts.isIdentifier(expression) && directCallees.has(expression.text)) ||
    (ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      namespaceCallees.has(expression.expression.text) &&
      expression.name.text === 'registerTool');

  const surfaceForRegistration = (): string => {
    const path = relative(SURFACES, file);
    const segments = path.split(sep);
    const surface = segments[0];
    if (isAbsolute(path) || !surface || surface === '..' || segments.length < 2) {
      throw new Error(
        `${normalizedRelative(file)}: registerTool registration must be under a directory in src/mcp/surfaces`,
      );
    }
    return surface;
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      /(^|\/)registry\.js$/u.test(node.arguments[0].text)
    ) {
      throw new Error(`${normalizedRelative(file)}: dynamic registry access is unsupported`);
    } else if (ts.isCallExpression(node) && isRegisterToolCallee(node.expression)) {
      const definition = node.arguments[1];
      if (!definition || !ts.isObjectLiteralExpression(definition)) {
        throw new Error(
          `${normalizedRelative(file)}: registerTool definition must be an object literal`,
        );
      }
      const name = requiredLiteral(definition, 'name', file, sourceFile);
      const sensitivity = requiredLiteral(definition, 'sensitivity', file, sourceFile);
      if (sensitivity !== 'read-only' && sensitivity !== 'state-affecting') {
        throw new Error(`${name}: unsupported sensitivity ${sensitivity}`);
      }
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      registrations.push({
        name,
        surface: surfaceForRegistration(),
        sensitivity,
        source: normalizedRelative(file),
        line: position.line + 1,
      });
    } else if (
      ts.isIdentifier(node) &&
      directCallees.has(node.text) &&
      !ts.isImportSpecifier(node.parent) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      throw new Error(
        `${normalizedRelative(file)}: registerTool binding "${node.text}" must be invoked directly`,
      );
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaceCallees.has(node.expression.text) &&
      node.name.text === 'registerTool' &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      throw new Error(
        `${normalizedRelative(file)}: registerTool namespace member must be invoked directly`,
      );
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      (node.argumentExpression.text === 'registerTool' || node.argumentExpression.text === 'tool')
    ) {
      if (ts.isIdentifier(node.expression) && namespaceCallees.has(node.expression.text)) {
        throw new Error(
          `${normalizedRelative(file)}: registerTool namespace binding "${node.expression.text}" must not escape`,
        );
      }
      throw new Error(
        `${normalizedRelative(file)}: computed ${node.argumentExpression.text} member access must use the registry wrapper`,
      );
    } else if (
      ts.isIdentifier(node) &&
      namespaceCallees.has(node.text) &&
      !ts.isNamespaceImport(node.parent) &&
      !(
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node &&
        (node.parent.name.text !== 'registerTool' ||
          (ts.isCallExpression(node.parent.parent) &&
            node.parent.parent.expression === node.parent))
      )
    ) {
      throw new Error(
        `${normalizedRelative(file)}: registerTool namespace binding "${node.text}" must not escape`,
      );
    } else if (
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === 'registerTool' || node.name.text === 'tool') &&
      !isRegisterToolCallee(node)
    ) {
      const call =
        ts.isCallExpression(node.parent) && node.parent.expression === node
          ? node.parent
          : undefined;
      const firstArgument = call?.arguments[0];
      const isCentralSdkBridge =
        normalizedRelative(file) === 'src/mcp/registry.ts' &&
        node.name.text === 'registerTool' &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'server' &&
        firstArgument !== undefined &&
        ts.isPropertyAccessExpression(firstArgument) &&
        ts.isIdentifier(firstArgument.expression) &&
        firstArgument.expression.text === 'def' &&
        firstArgument.name.text === 'name';
      if (!isCentralSdkBridge) {
        throw new Error(
          `${normalizedRelative(file)}: direct ${node.name.text} member access must use the registry wrapper`,
        );
      }
      centralSdkBridgeCalls += 1;
      if (centralSdkBridgeCalls > 1) {
        throw new Error(
          `${normalizedRelative(file)}: central registry must contain exactly one fixed-shape SDK bridge`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (normalizedRelative(file) === 'src/mcp/registry.ts' && centralSdkBridgeCalls !== 1) {
    throw new Error(
      `${normalizedRelative(file)}: central registry must contain exactly one fixed-shape SDK bridge`,
    );
  }
  return registrations;
}

function scanRegistrations(): Registration[] {
  const registrations = collectTypeScriptFiles(SOURCE_ROOT).flatMap((file) =>
    scanSourceRegistrations(file, readFileSync(file, 'utf8')),
  );
  return registrations.sort((left, right) => left.name.localeCompare(right.name));
}

function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

describe('MCP tool risk inventory', () => {
  const registrations = scanRegistrations();

  it.each([
    {
      label: 'named import alias',
      source: `
        import { registerTool as addTool } from '../../registry.js';
        addTool(server, { name: 'synthetic_alias_tool', sensitivity: 'read-only' });
      `,
    },
    {
      label: 'namespace import member',
      source: `
        import * as registry from '../../registry.js';
        registry.registerTool(server, {
          name: 'synthetic_alias_tool',
          sensitivity: 'read-only',
        });
      `,
    },
  ])('discovers a registration through a $label', ({ source }) => {
    expect(scanSourceRegistrations(join(SURFACES, 'synthetic', 'tools.ts'), source)).toHaveLength(
      1,
    );
  });

  it('fails closed when a local wrapper hides the registration object', () => {
    const source = `
      import { registerTool } from '../../registry.js';
      const addTool = (definition: unknown) => registerTool(server, definition);
    `;
    expect(() => scanSourceRegistrations(join(SURFACES, 'synthetic', 'tools.ts'), source)).toThrow(
      /definition must be an object literal/u,
    );
  });

  it('fails closed when an imported binding escapes or registers outside a surface', () => {
    const escaped = `
      import { registerTool } from '../../registry.js';
      const addTool = registerTool;
    `;
    expect(() => scanSourceRegistrations(join(SURFACES, 'synthetic', 'tools.ts'), escaped)).toThrow(
      /must be invoked directly/u,
    );

    const outside = `
      import { registerTool } from './registry.js';
      registerTool(server, { name: 'outside', sensitivity: 'read-only' });
    `;
    expect(() =>
      scanSourceRegistrations(join(SOURCE_ROOT, 'main', 'outside-tools.ts'), outside),
    ).toThrow(/must be under a directory in src\/mcp\/surfaces/u);
  });

  it('discovers exactly 63 unique literal production registrations', () => {
    expect(registrations).toHaveLength(63);
    expect(duplicates(registrations.map((entry) => entry.name))).toEqual([]);
    expect(registrations.filter((entry) => entry.sensitivity === 'read-only')).toHaveLength(25);
    expect(registrations.filter((entry) => entry.sensitivity === 'state-affecting')).toHaveLength(
      38,
    );
  });

  it('matches every registration to one strict sorted inventory entry', () => {
    const inventory = inventorySchema.parse(JSON.parse(readFileSync(INVENTORY, 'utf8')));
    const sourceNames = registrations.map((entry) => entry.name);
    const inventoryNames = inventory.tools.map((entry) => entry.name);
    expect({
      missing: sourceNames.filter((name) => !inventoryNames.includes(name)),
      extra: inventoryNames.filter((name) => !sourceNames.includes(name)),
      duplicates: duplicates(inventoryNames),
    }).toEqual({ missing: [], extra: [], duplicates: [] });
    expect(inventoryNames).toEqual([...inventoryNames].sort());

    const sourceByName = new Map(registrations.map((entry) => [entry.name, entry]));
    for (const entry of inventory.tools) {
      expect(entry.surface, entry.name).toBe(sourceByName.get(entry.name)?.surface);
      expect(entry.sensitivity, entry.name).toBe(sourceByName.get(entry.name)?.sensitivity);
      expect(entry.sensitivity, `${entry.name}: risk/sensitivity mismatch`).toBe(
        entry.risk === 'read-only' ? 'read-only' : 'state-affecting',
      );
      if (entry.sensitivity === 'read-only') {
        expect(entry.acknowledgementPolicy, entry.name).toBe('none');
      }
    }

    expect(inventory.tools.filter((entry) => entry.risk === 'read-only')).toHaveLength(25);
    expect(inventory.tools.filter((entry) => entry.risk === 'state-affecting')).toHaveLength(20);
    expect(inventory.tools.filter((entry) => entry.risk === 'disruptive')).toHaveLength(12);
    expect(inventory.tools.filter((entry) => entry.risk === 'destructive-or-unknown')).toHaveLength(
      6,
    );

    expect(
      inventory.tools
        .filter((entry) => entry.acknowledgementPolicy === 'client-acknowledgement-required')
        .map((entry) => entry.name),
    ).toEqual([...REQUIRED_ACKNOWLEDGEMENT]);
    expect(
      inventory.tools
        .filter((entry) => entry.acknowledgementPolicy === 'conditional-client-acknowledgement')
        .map((entry) => entry.name),
    ).toEqual([...CONDITIONAL_ACKNOWLEDGEMENT]);
    expect(
      inventory.tools.find((entry) => entry.name === 'run_control_workflow')
        ?.acknowledgementCondition,
    ).toBe('input.dryRun !== true && requiresHighImpactWorkflow(input)');
  });
});
```

The final RED/GREEN contract is exact at these boundaries:

1. Recursively scan every production `.ts`/`.tsx` file under `src`; reject any source symlink rather
   than silently skipping it.
2. Resolve every import whose original or local name is `registerTool` through a relative
   `registry.js` specifier to the unique `src/mcp/registry.ts`. Reject alternate filenames,
   alternate provenance, extensionless imports, named/star/namespace re-exports, direct dynamic
   registry imports, central-entry aliasing, and central forwarding wrappers.
3. Require the central file to expose exactly one `registerTool` function and exactly one
   fixed-shape `server.registerTool(def.name, ...)` SDK bridge. Reject missing/duplicate bridges,
   every other direct/computed/destructured `.registerTool` path, and every
   direct/computed/binding-destructured/assignment-destructured legacy `.tool` path.
4. Accept only direct object-literal wrapper calls inside a first-level
   `src/mcp/surfaces/<surface>/` directory with literal `name` and `sensitivity`; reject named and
   namespace binding escapes, local aliases/wrappers, binding/assignment destructuring, literal
   computed access, a file directly under `surfaces/`, and registration elsewhere under `src`.
5. Require exact 63/25/38 definition coverage plus 25/20/12/6 risk and 54/8/1 acknowledgement
   totals. This is a static-definition gate; it does not claim to prove runtime wiring or
   arbitrarily obfuscated/generated registration, which the Phase 0 convention prohibits.

- [ ] **Step 2: Run the validator and observe the intended RED state**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/tool-risk-inventory.test.ts
```

Expected: FAIL because `docs/security/mcp-tool-risk-inventory.json` does not exist. The AST-only discovery test should already report 63/25/38 correctly.

- [ ] **Step 3: Create the exact inventory JSON**

Create this top-level shape and serialize the 63 rows from Appendix A in exact name order:

```json
{
  "schemaVersion": "1.0.0",
  "authority": "review-data-only",
  "sourcePattern": "src/**/*.{ts,tsx}",
  "tools": []
}
```

For every Appendix A row, use exactly these fields; omit `acknowledgementCondition` unless the row is conditional:

```json
{
  "name": "run_control_workflow",
  "surface": "control-workflow",
  "sensitivity": "state-affecting",
  "risk": "destructive-or-unknown",
  "acknowledgementPolicy": "conditional-client-acknowledgement",
  "acknowledgementCondition": "input.dryRun !== true && requiresHighImpactWorkflow(input)",
  "futureApprovalPolicy": "unassigned",
  "rationale": "非 dry-run workflow 可组合 flash、reset、debug 和 observe，实际后果由不可变计划步骤决定。"
}
```

All other rows use `futureApprovalPolicy: "unassigned"`. Do not reduce risk labels to hide missing acknowledgement gates.

- [ ] **Step 4: Create the companion non-authority document**

`docs/security/mcp-tool-risk-inventory.md` must state all of the following explicitly:

```markdown
# MCP Tool Risk Inventory

This Phase 0 inventory is review data and a test fixture. It is not runtime authorization, an Approval Broker, a human grant, or proof that `confirm:true` came from a human.

The four consequence levels are `read-only`, `state-affecting`, `disruptive`, and `destructive-or-unknown`. `surface` is the source directory below `src/mcp/surfaces/`; it is a `ToolSurface`, not the future `OperationEvent.surface` enum.

Current caller acknowledgement is separate from future approval. Eight tools require client acknowledgement today, `run_control_workflow` is conditional, and every other entry records `none`. High-risk entries such as `memory_write` and `register_write` currently have no acknowledgement gate; the inventory exposes that gap and does not downgrade their risk.

`CONTROL_PROFILE_RUN_DOWNLOAD` and `CONTROL_PROFILE_START_DOWNLOAD` are Main-process IPC paths, not MCP tools, so they are documented here but excluded from the 63-entry count. Both currently inject `confirm:true`; Phase 0 labels that caller acknowledgement, not human approval.

The AST validator detects registration name, count, source surface, and declared sensitivity. Exact behavior tests cover the named seven low-level paths, runtime restart, and conditional workflow. A newly introduced guard elsewhere requires manual review, an inventory update, and a new behavior test; the AST scan cannot infer it from schemas or handler text.
```

- [ ] **Step 5: Make the inventory test GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/tool-risk-inventory.test.ts
```

Expected: one file passes; exact totals are 63 tools, 25/20/12/6 risks, and 54/8/1 acknowledgement policies.

- [ ] **Step 6: Manually review every disruptive/destructive and guarded entry**

Use Appendix A plus the real handlers/backends. Confirm particularly:

- `memory_write` remains `destructive-or-unknown` with current acknowledgement `none`.
- `register_write`, CPU control, breakpoint control, GDB server lifecycle and runtime restart remain `disruptive`.
- `flash_download`, `flash_write`, `flash_erase`, Commander script and workflow remain `destructive-or-unknown` where specified.
- `flash_verify` remains registry `state-affecting`, not silently reclassified read-only.
- `write_to_session` and `send_and_wait` remain `state-affecting`; Phase 0 does not parse command text to guess device consequences.
- confidentiality is not represented by the four consequence levels; later redaction/data-exposure policy is still required.

- [ ] **Step 7: Review scope without staging or committing**

Run:

```powershell
git diff -- tests/unit/mcp/tool-risk-inventory.test.ts docs/security/mcp-tool-risk-inventory.json docs/security/mcp-tool-risk-inventory.md
git diff -- src
```

Expected: one validator and two review-data documents; `src/` empty.

---

### Task 6: Add coverage and local aggregate quality commands

**Files:**

- Modify: `package.json`
- Modify mechanically: `pnpm-lock.yaml`
- Modify: `vitest.config.ts`
- Modify: `.gitignore`
- Modify: `scripts/validate-licenses.ts`
- Create: `tests/unit/scripts/validate-dev-tooling-licenses.test.ts`
- Modify: `third-party-manifest.json`
- Create: reviewed coverage-tooling license files under `licenses/dev-tooling/`
- Modify: `README.md`

- [ ] **Step 1: Install the coverage provider at the exact Vitest version**

Run:

```powershell
pnpm add --workspace-root --save-dev --save-exact @vitest/coverage-v8@4.1.8
```

Expected: `package.json` adds exactly `"@vitest/coverage-v8": "4.1.8"`; pnpm updates the lockfile. No runtime dependency changes.

- [ ] **Step 2: Add a failing license-audit regression for the coverage tooling root**

Create `tests/unit/scripts/validate-dev-tooling-licenses.test.ts` with an installed-package fixture that declares `@vitest/coverage-v8` in `devDependencies` and omits one child from its audited development-tooling closure. Run the focused test and verify RED because the current validator ignores that closure:

```powershell
pnpm exec vitest run tests/unit/scripts/validate-dev-tooling-licenses.test.ts
```

Expected RED: the validator incorrectly reports success or lacks the expected missing-package diagnostic. A parse/import error is not the required failure.

- [ ] **Step 3: Audit the installed coverage production closure without reclassifying it as runtime**

Add a separate `auditedDevTooling` collection to `third-party-manifest.json`. Its `@vitest/coverage-v8@4.1.8` record contains the exact 29-package installed production-dependency closure, including the root, plus reviewed repository license files. Keep the existing runtime `dependencies` collection at 19 entries.

Extend `validateLicenses` so an allowlisted audited tooling root present in `package.json` devDependencies is mandatory, resolves from the installed graph, walks only package `dependencies` edges, and compares exact name/version/license records. Do not walk peer dependencies, package devDependencies, or uninstalled optional peers, and do not derive the closure from peer-injected pnpm snapshot edges.

Add synthetic happy-path, missing-transitive, version/license mismatch, stale-entry, missing-license-file, and peer/dev exclusion coverage, then verify GREEN:

```powershell
pnpm exec vitest run tests/unit/scripts/validate-dev-tooling-licenses.test.ts
pnpm run validate:licenses
```

Expected: focused tests pass; the real command reports 19 runtime dependencies and 29 packages in one audited development-tooling production closure.

- [ ] **Step 4: Align the Node engine and add the two scripts without replacing authoritative commands**

Set the root engine contract to the supported ranges exercised by the current dependency graph:

```json
"node": "^22.13.0 || >=24.0.0"
```

CI will exercise the Node.js 22 line at its supported floor, 22.13.0; the range deliberately does not claim Node.js 23 compatibility.

Add to `package.json` scripts:

```json
"test:coverage": "node scripts/doctor-wsl.mjs && vitest run --coverage",
"ci:check": "pnpm run lint && pnpm run build && pnpm run test && pnpm run validate:licenses"
```

Keep existing `lint`, `build`, `test`, `pretest`, and `validate:licenses` unchanged.

- [ ] **Step 5: Configure whole-source report-only coverage**

Replace only the `coverage` object in `vitest.config.ts` with:

```ts
coverage: {
  provider: 'v8',
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['src/**/*.d.ts'],
  reporter: ['text', 'json-summary', 'html', 'lcov'],
  reportsDirectory: 'coverage',
},
```

Do not add `thresholds` and do not exclude Main, Renderer, shared, J-Link, or other LinkTerm source areas.

- [ ] **Step 6: Ignore generated coverage output**

Append to `.gitignore`:

```gitignore

# Test coverage reports
coverage/
```

- [ ] **Step 7: Verify the lockfile is frozen-install reproducible**

Run:

```powershell
pnpm install --frozen-lockfile
```

Expected: exit 0 and no subsequent lockfile diff caused by the frozen install.

- [ ] **Step 8: Run coverage and capture the honest baseline**

Run:

```powershell
pnpm run test:coverage
Get-Content -Raw coverage/coverage-summary.json
```

Expected: the complete suite passes; `coverage/coverage-summary.json`, `coverage/index.html`, and `coverage/lcov.info` exist. Record the exact lines/functions/statements/branches values in the Phase 0 completion evidence; do not turn them into a pass/fail threshold.

- [ ] **Step 9: Review package/config scope without staging or committing**

Run:

```powershell
git diff -- package.json pnpm-lock.yaml vitest.config.ts .gitignore
git diff -- src
```

Expected: one exact dev dependency, a separate audited 29-package coverage-tooling production closure with license files, the aligned Node engine range, two scripts, whole-source reporter config, ignore rule; `src/` empty.

---

### Task 7: Add cross-platform CI and engineering governance docs

**Files:**

- Create: `.github/workflows/quality.yml`
- Create: `docs/engineering/quality-gates.md`
- Create: `docs/security/gitnexus-governance.md`
- Include unchanged: `.gitnexusrc`

- [ ] **Step 1: Create the least-privilege quality workflow**

Create `.github/workflows/quality.yml`:

```yaml
name: Quality

on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  quality:
    name: Quality (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, ubuntu-latest, macos-latest]
    steps:
      - name: Check out repository
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
        with:
          persist-credentials: false
      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0
        with:
          version: 9.15.0
          run_install: false
      - name: Install Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22.13.0
          cache: pnpm
      - name: Install frozen dependencies
        run: pnpm install --frozen-lockfile
      - name: Run repository quality gates
        run: pnpm run ci:check

  coverage:
    name: Coverage report (ubuntu-latest)
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
        with:
          persist-credentials: false
      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0
        with:
          version: 9.15.0
          run_install: false
      - name: Install Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22.13.0
          cache: pnpm
      - name: Install frozen dependencies
        run: pnpm install --frozen-lockfile
      - name: Generate report-only coverage
        run: pnpm run test:coverage
      - name: Upload coverage artifact
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: linkterm-coverage-linux
          path: coverage/
          if-no-files-found: error
          retention-days: 14
```

This tests the current dependency-graph-compatible minimum Node.js version, caches only pnpm's store through setup-node, pins each Action to a reviewed full commit SHA, and disables checkout credential persistence. It never caches or shares `node_modules`, never calls Codecov/SaaS, and has no hardware step.

- [ ] **Step 2: Write the quality-gates guide**

`docs/engineering/quality-gates.md` must include this command contract:

```markdown
# Engineering Quality Gates

`pnpm run ci:check` is the local aggregate for lint, the authoritative production build, the complete automated test suite, and license validation. CI performs a fresh platform-local `pnpm install --frozen-lockfile` on Windows, Ubuntu, and macOS before running it.

`pnpm run test:coverage` runs the WSL/native dependency doctor and the complete Vitest suite with V8 coverage. Reports are written to `coverage/` as text, JSON summary, HTML, and LCOV. Phase 0 publishes an honest whole-source baseline and defines no numeric threshold.

The CI matrix is core automation, not install-level hardware acceptance. Windows remains the first manual UI/hardware acceptance platform. macOS and Linux must keep types, build, tests, licenses, and hardware-free core logic compatible.

CI tests use mocks, fakes, or null backends. They must never open a real serial port, attach a probe, erase or program flash, reset a target, start a real GDB server, or connect RTT.

Native packages are installed separately on each operating system. Do not cache or copy `node_modules` between platforms. On Linux/WSL, `scripts/doctor-wsl.mjs` reports missing Rolldown/Tailwind native bindings and preserves the existing remediation guidance.
```

- [ ] **Step 3: Write the GitNexus governance guide**

`docs/security/gitnexus-governance.md` must include:

```markdown
# GitNexus Change Governance

The repository versions `.gitnexusrc` with `pdg: true`. Before editing an existing function, class, or method, verify that the index commit matches HEAD and run upstream impact for the exact symbol. Report HIGH or CRITICAL risk, direct dependents, affected processes, and affected modules before editing.

Use GitNexus query/context to understand execution flows before broad text search. Do not rename symbols with text replacement; use graph-aware rename.

PDG and persisted taint are directed supporting evidence. Zero findings are not proof of safety: callback/closure flows, fields/properties, implicit control flow, sanitizers, context merging, and other model limits still require targeted tests and trust-boundary review.

Before claiming a Phase complete, run `detect_changes` against `main`, inspect every changed symbol and affected process, and cross-check untracked/new files with exact `git status` and diff scope. The phase also needs fresh OpenSpec, lint, build, full test, license, coverage-report, review, and no-product-behavior-change evidence.

Phase 0 does not call GitNexus from product runtime or CI, and GitNexus is never an authorization authority.
```

- [ ] **Step 4: Validate `.gitnexusrc` is an explicit Phase 0 deliverable**

Run:

```powershell
Get-Content -Raw .gitnexusrc
```

Expected exact semantic content: `pdg` is `true`. Do not remove the user's file or leave it as an undocumented local-only prerequisite.

- [ ] **Step 5: Format-check the workflow and documents**

Run:

```powershell
pnpm exec prettier --check .github/workflows/quality.yml docs/engineering/quality-gates.md docs/security/gitnexus-governance.md docs/security/mcp-tool-risk-inventory.md docs/security/mcp-tool-risk-inventory.json
```

Expected: all files pass. If formatting is required, run Prettier only on these exact files, then inspect their diff.

- [ ] **Step 6: Review CI/docs scope without staging or committing**

Run:

```powershell
git diff -- .github/workflows/quality.yml .gitnexusrc docs/engineering/quality-gates.md docs/security/gitnexus-governance.md
git diff -- src
```

Expected: workflow/config/docs only; `src/` empty.

---

### Task 8: Run the Phase 0 targeted and full quality gates

**Files:**

- Modify after evidence: `openspec/changes/establish-characterization-ci-gates/tasks.md`

- [ ] **Step 1: Run the complete targeted characterization set**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/registry.test.ts tests/unit/mcp/registry-sdk-boundary.test.ts tests/unit/main/ipc/session-create.test.ts tests/unit/mcp/terminal-tools.test.ts tests/unit/core/session-manager.test.ts tests/unit/mcp/control-workflow-job-manager.test.ts tests/integration/high-impact-confirmation.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/mcp/runtime-control-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/unit/mcp/tool-risk-inventory.test.ts
```

Expected: 11 files pass; no hardware access. Record exact test count from fresh output.

- [ ] **Step 2: Run lint**

Run:

```powershell
pnpm run lint
```

Expected: exit 0.

- [ ] **Step 3: Run the authoritative build**

Run:

```powershell
pnpm run build
```

Expected: `tsc -b` and Vite production build both exit 0.

- [ ] **Step 4: Run the complete test suite**

Run:

```powershell
pnpm run test
```

Expected: WSL/native doctor succeeds or skips appropriately; all test files pass.

- [ ] **Step 5: Run license validation**

Run:

```powershell
pnpm run validate:licenses
```

Expected: exit 0 including `@vitest/coverage-v8@4.1.8` and its transitive development dependencies.

- [ ] **Step 6: Regenerate fresh coverage evidence**

Run:

```powershell
pnpm run test:coverage
Get-Item coverage/coverage-summary.json, coverage/index.html, coverage/lcov.info
```

Expected: full suite passes; all three report paths exist; no threshold is evaluated.

- [ ] **Step 7: Run the aggregate command exactly as CI will**

Run:

```powershell
pnpm run ci:check
```

Expected: lint, build, full tests and licenses all exit 0 in sequence.

- [ ] **Step 8: Confirm the production tree remains unchanged**

Run:

```powershell
git diff --exit-code -- src
if (git status --short -- src) { throw 'Unexpected untracked or modified path under src/' }
git status --short
```

Expected: first command exit 0. Status contains only the original A+D/OpenSpec/config work plus Phase 0 tests, docs, package/config and CI files named in this plan.

- [ ] **Step 9: Check completed OpenSpec tasks only after their evidence exists**

Mark tasks 1.3–5.4 and 6.1 complete only when the matching command/file evidence above exists. Keep 6.2–6.6 unchecked until their own closing steps finish.

---

### Task 9: Independent review and verification-before-completion

**Files:**

- Review: all Phase 0 files in this plan
- Modify only for valid review findings: exact affected Phase 0 files
- Modify after evidence: `openspec/changes/establish-characterization-ci-gates/tasks.md`

- [ ] **Step 1: Re-run strict OpenSpec validation**

Run:

```powershell
openspec validate establish-characterization-ci-gates --type change --strict --no-interactive --json
openspec validate --all --strict --no-interactive --json
git diff --check
```

Expected: active change 1/1, all items 35/35, whitespace check exit 0.

- [ ] **Step 2: Run plan/document consistency checks**

Run:

```powershell
rg -n "^- (状态|Status|当前结论)[:：]\s*(Draft|Awaiting User Review|PASS WITH CHANGES)(\s|$)|^结论：\*\*(Draft|Awaiting User Review|PASS WITH CHANGES)\*\*$" docs/superpowers/specs/2026-07-11-linkterm-first-success-ai-trust openspec/changes/establish-characterization-ci-gates
rg -n "automation-allowlisted|30 days|30 天|10 MiB|Windows-first|headless-deny|interactive-required" docs/superpowers/specs/2026-07-11-linkterm-first-success-ai-trust
```

Expected: no stale review status; all four accepted decisions remain consistently present.

- [ ] **Step 3: Request independent code review**

The reviewer must compare the implementation to this plan and the Phase 0 OpenSpec, focusing on:

- accidental `src/` or user-visible behavior change;
- fake-only guarantees and hidden hardware access;
- false deep-copy/cap claims in JobManager tests;
- exact 63/25/38 inventory and 25/20/12/6 risk counts;
- current acknowledgement 54 none / 8 required / 1 conditional;
- AST blind spots and non-authority wording;
- SDK validation resolving with `isError:true` and no LinkTerm structured result;
- Renderer retained errored versus MCP rollback/no-event distinction;
- frozen per-platform installs, coverage with no threshold, least privilege and no SaaS.

Resolve every valid finding with the smallest Phase 0-only edit, rerun its targeted test, then rerun the relevant full gate. Do not expand into Phase 1–8.

- [ ] **Step 4: Run verification-before-completion with fresh commands**

Use the `verification-before-completion` constraint. Re-run, rather than cite old output:

```powershell
pnpm run lint
pnpm run build
pnpm run test
pnpm run validate:licenses
pnpm run test:coverage
openspec validate --all --strict --no-interactive --json
git diff --check
git diff --exit-code -- src
if (git status --short -- src) { throw 'Unexpected untracked or modified path under src/' }
```

Expected: every command exits 0; coverage files are fresh; `src/` remains unchanged.

- [ ] **Step 5: Run GitNexus change detection against main**

Because new files begin untracked and ordinary `git diff` may omit them, first record exact status and do not alter the user's index merely to improve graph visibility. Run GitNexus on the visible tracked diff, then cross-check every untracked Phase 0 path with `git status --short` and the File map above. Record the untracked/new-file visibility limitation explicitly; never stage broadly with `git add -A` or `git add --all`.

Required GitNexus call:

```text
detect_changes({ scope: "compare", base_ref: "main", repo: "link-mcp" })
```

Expected: only test/config/docs/tooling scope; no production runtime symbol or unexpected process. Record any limitation for new unindexed files rather than interpreting an empty graph result as proof of no impact.

- [ ] **Step 6: Run directed PDG and taint review**

Review the existing registration/confirmation boundaries with GitNexus `pdg_query`/PDG impact and `explain`, anchored to `registerTool`, the low-level debug handlers, `run_control_workflow`, and `restart_mcp_runtime`. Record findings and model caveats. A zero-finding result is limited supporting evidence only; the targeted backend=0 tests remain required.

- [ ] **Step 7: Close the Phase 0 OpenSpec checklist without archiving**

After review, verification, detect_changes and PDG/taint evidence are all fresh, check tasks 6.2–6.5. Check 6.6 only when the user-facing Phase 0 evidence report is prepared. Do not archive the change.

- [ ] **Step 8: Review the entire worktree and stop without commit**

Run:

```powershell
git status --short
git diff --stat
git diff --check
```

Expected: intended Phase 0 scope only, no staged files, no `src/` diff. Stop without commit, push or PR.

---

### Task 10: Report Phase 0 evidence and wait at the phase gate

The user-facing report must contain:

- OpenSpec: active change and all canonical specs strict-pass counts.
- Characterization: targeted file/test counts and the exact contracts locked.
- Inventory: 63 total, sensitivity 25/38, risk 25/20/12/6, acknowledgement 54/8/1, plus the important current missing-gate examples.
- Quality: fresh lint/build/full-test/license/coverage/aggregate exit results and report paths.
- CI: Windows/Ubuntu/macOS matrix plus independent Ubuntu coverage artifact; note that workflow configuration is locally reviewed but hosted runs require a remote push, which is not authorized.
- GitNexus: fresh index/HEAD match, HIGH/CRITICAL boundaries avoided, detect_changes scope, directed PDG/taint result and caveats.
- Scope: `src/` unchanged; no real hardware side effects; no commit/push/PR/archive.
- Limitations: JobManager nested evidence is not deeply cloned; queued cancellation can temporarily exceed the retained cap; risk inventory is not authorization; `confirm:true` is not human approval; coverage has no threshold.
- Gate: Phase 0 is the only phase being claimed. Ask for explicit permission before entering Phase 1.

Only after the report exists may OpenSpec task 6.6 be checked. The overall A+D Goal remains in progress until Phase 0–8 all satisfy their own evidence gates.

---

## Appendix A: Exact 63-tool reviewed classification

Every row has `futureApprovalPolicy: unassigned`. `—` means omit `acknowledgementCondition`.

| name                                | surface              | sensitivity     | risk                   | acknowledgementPolicy              | condition                                                    | rationale                                                                       |
| ----------------------------------- | -------------------- | --------------- | ---------------------- | ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `activate_control_profile`          | control-profile      | state-affecting | state-affecting        | none                               | —                                                            | 打开配置串口并连接 J-Link，占用本机和硬件资源，但不烧录、复位或 halt。          |
| `apply_control_profile_answer`      | control-profile      | state-affecting | state-affecting        | none                               | —                                                            | 将答案写入 control-profile，改变后续连接和工作流参数。                          |
| `breakpoint_clear`                  | debug                | state-affecting | disruptive             | none                               | —                                                            | 删除断点会改变调试控制状态，并可能使程序越过停止位置。                          |
| `breakpoint_list`                   | debug                | read-only       | read-only              | none                               | —                                                            | 只读取当前断点集合，不改变目标或调试器状态。                                    |
| `breakpoint_set`                    | debug                | state-affecting | disruptive             | none                               | —                                                            | 新断点会改变目标后续执行路径，并可能在命中时中断程序。                          |
| `cancel_control_workflow_job`       | control-workflow     | state-affecting | disruptive             | none                               | —                                                            | 请求停止硬件工作流，已完成的烧录或其他步骤不会回滚。                            |
| `cleanup_control_workflow_jobs`     | control-workflow     | state-affecting | state-affecting        | none                               | —                                                            | 删除终态 job 记录，影响后续查询但不停止 active job。                            |
| `close_session`                     | terminal             | state-affecting | state-affecting        | none                               | —                                                            | 关闭会话并释放端口或进程资源，后续输入输出不可继续。                            |
| `connect_control_profile_chip`      | control-profile      | state-affecting | state-affecting        | none                               | —                                                            | 根据 profile 建立 J-Link 连接并占用 probe，但不主动 reset、halt 或烧录。        |
| `cpu_halt`                          | debug                | state-affecting | disruptive             | none                               | —                                                            | 立即停止目标 CPU，会中断正在运行的固件和实时行为。                              |
| `cpu_reset`                         | debug                | state-affecting | disruptive             | client-acknowledgement-required    | —                                                            | 复位目标会丢失当前运行态并重新开始固件执行。                                    |
| `cpu_run`                           | debug                | state-affecting | disruptive             | none                               | —                                                            | 从 halt 恢复 CPU，可能立即触发外设和固件副作用。                                |
| `cpu_step`                          | debug                | state-affecting | disruptive             | none                               | —                                                            | 执行一条指令会推进目标状态并可能触发内存或外设访问。                            |
| `crash_diagnose`                    | debug                | read-only       | read-only              | none                               | —                                                            | 只采集和解释崩溃证据，不写目标状态。                                            |
| `diagnose_rtt_log_session`          | rtt-log-session      | read-only       | read-only              | none                               | —                                                            | 只检查 RTT 日志会话和诊断事实，不创建或关闭会话。                               |
| `disconnect_control_profile_chip`   | control-profile      | state-affecting | state-affecting        | none                               | —                                                            | 释放 profile 建立的 probe 连接，但不关闭其他会话。                              |
| `discover_serial_ports`             | terminal             | read-only       | read-only              | none                               | —                                                            | 只执行一次串口枚举，不打开端口或启动轮询。                                      |
| `flash_download`                    | debug                | state-affecting | destructive-or-unknown | client-acknowledgement-required    | —                                                            | 下载固件会覆盖目标 flash，LinkTerm 无法自动恢复原内容。                         |
| `flash_erase`                       | debug                | state-affecting | destructive-or-unknown | client-acknowledgement-required    | —                                                            | 擦除 flash 会永久删除目标中的现有数据或固件。                                   |
| `flash_verify`                      | debug                | state-affecting | state-affecting        | none                               | —                                                            | 通过 active probe 读取并比较 flash，占用硬件操作通道但不编程字节。              |
| `flash_write`                       | debug                | state-affecting | destructive-or-unknown | client-acknowledgement-required    | —                                                            | 向指定 flash 地址写入会覆盖持久内容并可能破坏可启动镜像。                       |
| `gdb_server_start`                  | debug                | state-affecting | disruptive             | client-acknowledgement-required    | —                                                            | 启动 GDB server 会占用 probe/端口并改变调试控制状态。                           |
| `gdb_server_stop`                   | debug                | state-affecting | disruptive             | none                               | —                                                            | 停止 GDB server 会中断现有调试客户端和调试会话。                                |
| `get_agent_runbook`                 | agent-runbook        | read-only       | read-only              | none                               | —                                                            | 只返回 Agent 操作说明和能力信息。                                               |
| `get_app_status`                    | agent-runbook        | read-only       | read-only              | none                               | —                                                            | 只读取应用、runtime 和能力状态，不触发恢复或重启。                              |
| `get_control_profile`               | control-profile      | read-only       | read-only              | none                               | —                                                            | 只读取当前 control-profile 配置。                                               |
| `get_control_workflow_job_status`   | control-workflow     | read-only       | read-only              | none                               | —                                                            | 只读取后台工作流轻量状态，不重试硬件动作。                                      |
| `get_session_status`                | terminal             | read-only       | read-only              | none                               | —                                                            | 只返回会话状态和 transcript cursor。                                            |
| `get_workspace_config`              | workspace            | read-only       | read-only              | none                               | —                                                            | 只读取 workspace 配置，不创建或改写文件。                                       |
| `init_control_profile`              | control-profile      | state-affecting | state-affecting        | none                               | —                                                            | 创建或初始化 control-profile 文件，改变工作区持久配置。                         |
| `init_workspace`                    | workspace            | state-affecting | state-affecting        | none                               | —                                                            | 创建 LinkTerm workspace 配置和目录事实。                                        |
| `inspect_control_profile`           | control-profile      | read-only       | read-only              | none                               | —                                                            | 只检查 profile 完整性和可执行条件，不保存修正。                                 |
| `jlink_commander_script`            | debug                | state-affecting | destructive-or-unknown | client-acknowledgement-required    | —                                                            | 任意 Commander 指令可复位、擦除、写内存或执行未分类动作。                       |
| `jlink_device_catalog_get`          | jlink-device-catalog | read-only       | read-only              | none                               | —                                                            | 只读取一个已安装的 SEGGER device catalog 条目。                                 |
| `jlink_device_catalog_search`       | jlink-device-catalog | read-only       | read-only              | none                               | —                                                            | 只搜索本机 SEGGER device catalog。                                              |
| `jlink_reboot`                      | debug                | state-affecting | disruptive             | client-acknowledgement-required    | —                                                            | 重启 J-Link probe 会中断依赖该 probe 的连接和操作。                             |
| `list_sessions`                     | terminal             | read-only       | read-only              | none                               | —                                                            | 只列出非敏感 session metadata 和状态。                                          |
| `memory_read`                       | debug                | read-only       | read-only              | none                               | —                                                            | 只从目标地址读取字节，不写目标内存。                                            |
| `memory_write`                      | debug                | state-affecting | destructive-or-unknown | none                               | —                                                            | 任意地址写入可破坏 RAM、外设寄存器或执行状态。                                  |
| `open_rtt_log_session`              | rtt-log-session      | state-affecting | state-affecting        | none                               | —                                                            | 创建并注册 RTT 日志会话，占用 session 和 probe 相关资源。                       |
| `open_session`                      | terminal             | state-affecting | state-affecting        | none                               | —                                                            | 打开串口、SSH 或本地 shell 会话并占用对应资源。                                 |
| `prepare_control_profile_questions` | control-profile      | read-only       | read-only              | none                               | —                                                            | 只分析缺失配置并生成问题，不保存答案。                                          |
| `probe_connect`                     | debug                | state-affecting | state-affecting        | none                               | —                                                            | 建立 probe/target 连接并改变资源所有权，但不主动 halt 或 reset。                |
| `probe_detect`                      | debug                | read-only       | read-only              | none                               | —                                                            | 只枚举当前可见的 J-Link probes。                                                |
| `probe_disconnect`                  | debug                | state-affecting | state-affecting        | none                               | —                                                            | 断开 probe 并使现有 probeId 失效。                                              |
| `probe_status`                      | debug                | read-only       | read-only              | none                               | —                                                            | 只读取 probe 连接状态与 metadata。                                              |
| `read_control_workflow_job`         | control-workflow     | read-only       | read-only              | none                               | —                                                            | 只读取 job 步骤、证据和 cursor 引用。                                           |
| `read_from_session`                 | terminal             | read-only       | read-only              | none                               | —                                                            | 只读取 transcript，不向设备或终端写入。                                         |
| `register_list`                     | debug                | read-only       | read-only              | none                               | —                                                            | 只列出目标可见寄存器及当前值。                                                  |
| `register_read`                     | debug                | read-only       | read-only              | none                               | —                                                            | 只读取单个 CPU 寄存器。                                                         |
| `register_write`                    | debug                | state-affecting | disruptive             | none                               | —                                                            | 修改 PC、SP 或控制寄存器会改变目标后续执行状态。                                |
| `restart_mcp_runtime`               | runtime-control      | state-affecting | disruptive             | client-acknowledgement-required    | —                                                            | 重启 MCP runtime 会终止当前请求并使 runtime-bound 状态失效。                    |
| `rtt_clear`                         | debug                | state-affecting | state-affecting        | none                               | —                                                            | 排空 RTT channel 会永久丢弃尚未读取的日志。                                     |
| `rtt_connect`                       | debug                | state-affecting | state-affecting        | none                               | —                                                            | 建立 RTT control-block 连接并占用 probe 通道。                                  |
| `rtt_read`                          | debug                | state-affecting | state-affecting        | none                               | —                                                            | 读取 RTT up channel 会推进硬件读指针并消费设备输出。                            |
| `rtt_search`                        | debug                | read-only       | read-only              | none                               | —                                                            | 只在 RTT 数据中搜索模式，不推进硬件读指针。                                     |
| `run_control_workflow`              | control-workflow     | state-affecting | destructive-or-unknown | conditional-client-acknowledgement | `input.dryRun !== true && requiresHighImpactWorkflow(input)` | 非 dry-run workflow 可组合 flash、reset、debug 和 observe，后果由计划步骤决定。 |
| `send_and_wait`                     | terminal             | state-affecting | state-affecting        | none                               | —                                                            | 向会话写入命令并等待响应，不用脆弱文本解析猜测设备后果。                        |
| `snapshot_capture`                  | debug                | read-only       | read-only              | none                               | —                                                            | 只采集目标寄存器、内存或调试证据快照。                                          |
| `ui_configure`                      | ui                   | state-affecting | state-affecting        | none                               | —                                                            | 修改桌面 UI 配置或可见状态，但不直接操作硬件。                                  |
| `ui_screenshot`                     | ui                   | read-only       | read-only              | none                               | —                                                            | 只捕获当前 UI 图像，不改变 UI 或设备状态。                                      |
| `update_workspace_config`           | workspace            | state-affecting | state-affecting        | none                               | —                                                            | 改写 workspace 持久配置，影响后续 session 和 workflow 默认值。                  |
| `write_to_session`                  | terminal             | state-affecting | state-affecting        | none                               | —                                                            | 向终端或设备发送原始数据，不用命令文本推断具体后果。                            |

## Plan self-review

- 规格覆盖：每个 `engineering-quality-gates` requirement 已映射到 Task 1–10；双 session 入口、7+1+1 acknowledgement、JobManager 限制、63-tool inventory、CI、coverage、GitNexus 和 no-product-change 均有独立命令与断言。
- 占位符检查：计划内没有未决实现选择；Appendix A 冻结所有 63 项值和 rationale。
- 类型一致性：统一使用 `client-acknowledgement-required`、`conditional-client-acknowledgement`、`futureApprovalPolicy: unassigned`、`ToolSurface`、`ControlWorkflowJobManager` 和 `SessionManager.createAndOpen`。
- 范围检查：所有拟改生产符号都被排除；只有测试、review data、dev dependency、配置、CI、OpenSpec 进度和工程文档。
- Git 纪律：所有步骤只检查 diff；没有 stage、commit、push、PR 或 archive 步骤。
