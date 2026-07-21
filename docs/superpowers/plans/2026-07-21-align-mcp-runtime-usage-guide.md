# Align MCP Runtime Usage Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan
> task-by-task. Do not delegate unless the user separately authorizes sub-agents. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Make LinkTerm's initialize instructions, detailed runbook, key MCP tool descriptions, and
maintainer documentation a truthful operating manual for the current runtime.

**Architecture:** Keep packaged runtime guidance in `agent-runbook/runbook.ts`; direct and proxy MCP
servers deliver the same generator output, `get_agent_runbook` supplies detailed Markdown and
structured data, and `tools/list` supplies action-local contracts. Add a narrow proxy-server factory
for protocol-level initialize tests. Do not change SessionManager, serial coordination, execution
policy, Agent integration persistence, or hardware backends.

**Tech Stack:** TypeScript 6, MCP SDK, Zod, Vitest, OpenSpec, GitNexus/PDG.

**Git constraint:** Do not commit or push without a new explicit user instruction. Every symbol edit
requires a fresh GitNexus upstream impact report first.

**Execution status (2026-07-21):** Completed. Every step below was executed; fresh final evidence,
including review fixes and all quality/security gates, is recorded in
`openspec/changes/align-mcp-runtime-usage-guide/verification.md`. The per-step boxes below preserve
the original implementation sequence; this status line is the authoritative execution record.

---

## File map

- Modify `src/mcp/surfaces/agent-runbook/runbook.ts`: compact instructions, workflows, safety rules,
  and Markdown wording.
- Modify `src/mcp/surfaces/agent-runbook/tools.ts`: truthful `get_agent_runbook` and
  `get_app_status` descriptions/recommendations.
- Modify `src/mcp/surfaces/terminal/tools.ts`: create-or-reuse, shared close, host-acceptance,
  cursor, settle, discovery, status, and conflict descriptions.
- Modify `src/mcp/surfaces/control-workflow/tools.ts`: background timeout recovery/no-repeat wording.
- Modify `src/mcp/stdio-proxy.ts`: extract a transport-independent proxy `Server` construction seam.
- Modify `tests/unit/mcp/agent-runbook.test.ts`: direct initialize and detailed runbook contracts.
- Modify `tests/unit/mcp/tool-descriptions.test.ts`: key `tools/list` contracts.
- Modify `tests/unit/mcp/stdio-proxy.test.ts`: in-memory proxy initialize/forwarding proof.
- Modify `tests/unit/core/agent-integrations/agent-integration-manager.test.ts`: prompt-free managed
  JSON/TOML/HTTP characterization.
- Create `docs/mcp-usage-guide.md`: maintainer/operator manual.
- Update `openspec/changes/align-mcp-runtime-usage-guide/tasks.md` and create `verification.md` during
  closeout.

### Task 1: Direct initialize and detailed runbook RED contracts

**Files:**
- Modify: `tests/unit/mcp/agent-runbook.test.ts:100-200,285-322`
- Test: `tests/unit/mcp/agent-runbook.test.ts`

- [x] **Step 1: Run GitNexus upstream impact for the future implementation symbols**

Run `impact` upstream for `createAgentRunbookInstructions`, `RUNBOOK_WORKFLOWS`, `SAFETY_RULES`,
`renderRunbookMarkdown`, and `registerAgentRunbookTools`. Report direct callers, affected processes,
and risk before any source edit. If any result is HIGH/CRITICAL, stop and request authorization.

- [x] **Step 2: Add failing direct initialize assertions**

Extend `advertises actionable runbook guidance in initialize instructions` with exact semantic
clauses:

```ts
expect(instructions).toContain('call get_app_status first');
expect(instructions).toContain('read-only serial-port and J-Link probe discovery');
expect(instructions).toContain('create or reuse');
expect(instructions).toContain('evidence.data.reused=true');
expect(instructions).toContain('same WriteQueue and transcript');
expect(instructions).toContain('do not close a shared session');
expect(instructions).toContain('writes once');
expect(instructions).toContain('does not retry automatically');
expect(instructions).toContain('legacy confirm values are ignored');
expect(instructions).toContain('no approval, pause, resume-AI, or take-over');
expect(instructions).toContain('host timeout is not evidence of hardware failure');
```

Keep existing firmware/RTT/background/fresh-evidence assertions.

- [x] **Step 3: Add failing detailed runbook assertions**

```ts
const observeSerial = runbook.workflows.find((workflow) => workflow.id === 'observe_serial');
expect(observeSerial?.recommendedTools.slice(0, 3)).toEqual([
  'list_sessions',
  'get_app_status',
  'open_session',
]);
expect(observeSerial?.recommendedTools).not.toContain('discover_serial_ports');
expect(observeSerial?.description).toContain(
  'call discover_serial_ports only when no active session or known configuration exists',
);
expect(runbook.markdown).toContain('SERIAL_SESSION_CONFLICT');
expect(runbook.markdown).toContain('do not close a shared session');
expect(runbook.markdown).toContain('empty settle window does not prove');
expect(runbook.markdown).toContain('no approval, pause, resume-AI, or take-over');
expect(runbook.markdown).not.toContain('requires confirmation');
```

- [x] **Step 4: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/agent-runbook.test.ts
```

Expected: FAIL on missing `call get_app_status first`, missing create-or-reuse/shared-close/conflict
language, and the current `discover_serial_ports` workflow position. Existing unrelated assertions
must remain green.

### Task 2: Key tool-description RED contracts

**Files:**
- Modify: `tests/unit/mcp/tool-descriptions.test.ts`
- Test: `tests/unit/mcp/tool-descriptions.test.ts`

- [x] **Step 1: Run GitNexus upstream impact for description-owning registration functions**

Run upstream impact for `registerTerminalTools`, `registerAgentRunbookTools`, and
`registerControlWorkflowTools`. Report risk and direct callers before editing their source functions.

- [x] **Step 2: Add a failing terminal description test**

```ts
it('describes shared create-or-reuse terminal operation without blind retries', async () => {
  const tools = await h.client.listTools();
  const descriptions = new Map(tools.tools.map((tool) => [tool.name, tool.description ?? '']));

  expect(descriptions.get('list_sessions')).toContain('before opening serial');
  expect(descriptions.get('open_session')).toContain('create or reuse');
  expect(descriptions.get('open_session')).toContain('evidence.data.reused');
  expect(descriptions.get('open_session')).toContain('SERIAL_SESSION_CONFLICT');
  expect(descriptions.get('open_session')).toContain('do not retry blindly');
  expect(descriptions.get('close_session')).toContain('human and AI');
  expect(descriptions.get('close_session')).toContain('shared');
  expect(descriptions.get('write_to_session')).toContain('host-side acceptance');
  expect(descriptions.get('read_from_session')).toContain('cursor');
  expect(descriptions.get('send_and_wait')).toContain('writes once');
  expect(descriptions.get('send_and_wait')).toContain('does not retry automatically');
  expect(descriptions.get('discover_serial_ports')).toContain('only when');
  expect(descriptions.get('discover_serial_ports')).toContain('no known configuration');
});
```

- [x] **Step 3: Extend workflow and status description assertions**

```ts
expect(descriptions.get('get_app_status')).toContain('read-only discovery');
expect(descriptions.get('get_app_status')).toContain('does not connect to or mutate hardware');
expect(descriptions.get('get_agent_runbook')).toContain('operating guide');
expect(descriptions.get('run_control_workflow')).toContain(
  'host timeout is not proof that the hardware operation failed',
);
expect(descriptions.get('run_control_workflow')).toContain('do not retry');
```

- [x] **Step 4: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/tool-descriptions.test.ts
```

Expected: FAIL because current `open_session` says “Create a new session,” `close_session` has no
shared-user warning, discovery is unconditional, and workflow/status descriptions lack the new
clauses.

### Task 3: Protocol-level stdio proxy initialize RED contract

**Files:**
- Modify: `tests/unit/mcp/stdio-proxy.test.ts`
- Modify: `src/mcp/stdio-proxy.ts:18-103`
- Test: `tests/unit/mcp/stdio-proxy.test.ts`

- [x] **Step 1: Run GitNexus upstream impact for `startMcpStdioProxy`**

Report its direct callers (`runProxy`, `startProxyToExistingRuntime`), affected runtime startup
processes, and risk. The new factory has no pre-existing impact target; impact its caller before
extracting.

- [x] **Step 2: Add the failing in-memory client test**

Import the not-yet-created factory and existing transport fixture:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpProxyServer } from '@/mcp/stdio-proxy.js';
import { createAgentRunbookInstructions } from '@/mcp/surfaces/agent-runbook/runbook.js';
import { LINKTERM_MCP_SCHEMA_VERSION } from '@/mcp/versioning/version-check.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';
```

Add:

```ts
it('delivers the packaged runbook through proxy initialize and forwards tools/list', async () => {
  const upstream = {
    listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'list_sessions', inputSchema: {} }] }),
    callTool: vi.fn(),
  };
  const { server: serverTransport, client: clientTransport } =
    createInMemoryMcpTransportPair();
  const server = createMcpProxyServer(upstream, vi.fn().mockResolvedValue(undefined));
  const client = new Client({ name: 'proxy-guide-test', version: '0.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  expect(client.getInstructions()).toBe(
    createAgentRunbookInstructions(LINKTERM_MCP_SCHEMA_VERSION),
  );
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('list_sessions');

  await client.close();
  await server.close();
});
```

Use the narrow structural type exported by the implementation rather than `any`.

- [x] **Step 3: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/stdio-proxy.test.ts
```

Expected: module/type failure stating `createMcpProxyServer` is not exported.

- [x] **Step 4: Extract the minimal proxy server factory**

Add a structural upstream interface and factory in `src/mcp/stdio-proxy.ts`:

```ts
export interface McpProxyUpstream {
  listTools(params?: Parameters<Client['listTools']>[0]): ReturnType<Client['listTools']>;
  callTool(
    params: Parameters<Client['callTool']>[0],
    resultSchema: typeof CallToolResultSchema,
  ): ReturnType<Client['callTool']>;
}

export function createMcpProxyServer(
  upstream: McpProxyUpstream,
  stopProxy: ProxyStopFn,
): Server {
  const server = new Server(
    {
      name: 'linkterm-stdio-proxy',
      version: LINKTERM_MCP_SCHEMA_VERSION,
      title: APP_NAME,
    },
    {
      capabilities: { tools: {} },
      instructions: createAgentRunbookInstructions(LINKTERM_MCP_SCHEMA_VERSION),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request) =>
    forwardRuntimeRequest(() => upstream.listTools(request.params), stopProxy),
  );
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    forwardRuntimeRequest(async () => {
      const result = await upstream.callTool(request.params, CallToolResultSchema);
      return CallToolResultSchema.parse(result);
    }, stopProxy),
  );
  return server;
}
```

Refactor `startMcpStdioProxy` to create the same `Client`/HTTP/stdin transports and call this factory;
keep stop order and owner-transport failure behavior unchanged.

- [x] **Step 5: Run proxy tests and verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/stdio-proxy.test.ts tests/unit/mcp/electron-runtime-launcher-core.test.ts
```

Expected: all tests PASS; proxy initialize instructions equal the packaged generator exactly.

### Task 4: Implement the layered runbook guidance

**Files:**
- Modify: `src/mcp/surfaces/agent-runbook/runbook.ts:99-277,397-467`
- Modify: `src/mcp/surfaces/agent-runbook/tools.ts:108-212,432-515`
- Test: `tests/unit/mcp/agent-runbook.test.ts`

- [x] **Step 1: Update the serial workflow minimally**

Use this ordering and conditional description:

```ts
{
  id: 'observe_serial',
  title: 'Observe an existing or configured serial terminal',
  description:
    'Inspect Main-owned sessions first and reuse a compatible active terminal. Use get_app_status with a known workspace root to reuse profile facts; call discover_serial_ports only when no active session or known configuration exists. Serial open_session is create-or-reuse and Main coordination remains authoritative under races.',
  recommendedTools: [
    'list_sessions',
    'get_app_status',
    'open_session',
    'read_from_session',
    'send_and_wait',
  ],
  riskLevel: 'low',
  requiresConfirmation: false,
  expectedEvidenceKind: 'terminal_output',
}
```

- [x] **Step 2: Add shared terminal, conflict, silence, and automatic-execution safety rules**

Add stable sentences to `SAFETY_RULES`:

```ts
'Serial open_session is create-or-reuse: inspect list_sessions/get_app_status first, use evidence.data.reused when returned, and on SERIAL_SESSION_CONFLICT compare the active/requested configuration instead of retrying blindly.',
'Human and AI share the same SessionManager, WriteQueue, transport, and transcript; do not close a shared session unless the user requested closure or the owning workflow explicitly disposes it.',
'An empty send_and_wait settle window does not prove a device crash or command completion; inspect fresh transcript/context and never repeat a state-affecting command automatically.',
'Validated AI operations execute automatically; legacy confirm values are ignored metadata, and LinkTerm has no approval, pause, resume-AI, or take-over action.',
```

- [x] **Step 3: Replace compact initialize text with the verified sequence**

Keep the schema/version, firmware, RTT, no-CLI, background-job, and fresh-evidence clauses, but ensure
the ordered essentials are:

```ts
'Startup: call get_app_status first for current sessions, readiness, read-only serial-port and J-Link probe discovery, and tool integrity; it does not connect to or mutate hardware.',
'Serial: inspect existing sessions and known workspace/control-profile facts before opening; open_session may create or reuse a compatible session and reports evidence.data.reused=true when reused; discover ports only when configuration is unknown.',
'Human and AI use the same SessionManager, WriteQueue, transport, and transcript; do not close a shared session unless the user requested it, and do not disable human input or claim terminal ownership.',
'send_and_wait writes once, waits a bounded settle window, returns observed device-origin bytes, treats markers as metadata, and does not retry automatically; silence alone proves neither crash nor completion.',
'Validated operations execute automatically; legacy confirm values are ignored and there is no approval, pause, resume-AI, or take-over workflow.',
'For long hardware workflows use background mode and recover with job status/evidence tools; a host timeout is not evidence of hardware failure and must not trigger repeated flash, erase, reset, attach, or GDB startup.',
```

- [x] **Step 4: Align Markdown and status tool descriptions**

Keep the Markdown/structured payload fields intact. Render the new rules and change the high-impact
heading/body only as needed to say “automatic after validation; observe evidence.” Update:

```ts
description:
  'Return the detailed packaged LinkTerm MCP operating guide as Markdown and structured workflows, including sanitized runtime/profile facts. This tool is read-only.',
```

and:

```ts
description:
  'Return a read-only LinkTerm startup/status snapshot. It performs one-shot serial-port and J-Link probe discovery but does not connect to or mutate hardware, capture screenshots, flash, erase, reset, halt, start GDB, or write sessions.',
```

- [x] **Step 5: Run direct/runbook tests and verify GREEN**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/agent-runbook.test.ts
```

Expected: all tests PASS with existing sanitization, firmware, RTT, status, and workflow contracts
preserved.

### Task 5: Implement truthful key tool descriptions

**Files:**
- Modify: `src/mcp/surfaces/terminal/tools.ts:85-430`
- Modify: `src/mcp/surfaces/control-workflow/tools.ts:63-99`
- Test: `tests/unit/mcp/tool-descriptions.test.ts`
- Test: `tests/unit/mcp/terminal-tools.test.ts`
- Test: `tests/unit/mcp/control-workflow-tools.test.ts`

- [x] **Step 1: Update terminal descriptions without touching handlers**

Use descriptions with these exact semantics:

```ts
// list_sessions
'List all Main-owned visible sessions with states and non-sensitive UI metadata. Inspect this before opening serial so a compatible sessionId can be reused.'

// open_session
'Open a serial, SSH, or local-shell session. Serial uses Main-owned create or reuse: a compatible active session may return its existing sessionId with evidence.data.reused=true; incompatible same-port configuration returns SERIAL_SESSION_CONFLICT, so inspect the active configuration and do not retry blindly.'

// close_session
'Close the underlying transport but keep its transcript readable. Human and AI share the session, so closing a shared session affects both parties; close only when requested or explicitly owned for disposal.'

// write_to_session
'Write bytes once through the shared SessionManager/WriteQueue. bytesWritten is host-side acceptance, not proof that the device consumed or executed the command.'

// read_from_session
'Read cursor-based transcript events since the supplied cursor (0 = earliest visible), including origin/sequence/timestamp/meta and a next cursor; truncated means earlier ring-buffer events were dropped.'

// send_and_wait
'Write bytes once through the shared queue, wait a bounded settle interval, and return device-origin output observed during that interval. Markers are optional metadata rather than a success gate; silence proves neither crash nor completion, and the tool does not retry automatically.'

// discover_serial_ports
'Conditionally enumerate currently available serial ports once, only when no compatible active session or known user/workspace/control-profile configuration exists; no polling.'

// get_session_status
'Read the current state and latest transcript cursor before deciding whether a session can be reused or must be reopened.'
```

- [x] **Step 2: Add background no-repeat wording to `run_control_workflow`**

Append:

```ts
'A host timeout is not proof that the hardware operation failed; recover the background job by id and do not retry flash, erase, reset, attach, or GDB startup solely because the client deadline expired.'
```

- [x] **Step 3: Run focused description and behavior tests**

Run:

```powershell
pnpm exec vitest run tests/unit/mcp/tool-descriptions.test.ts tests/unit/mcp/terminal-tools.test.ts tests/unit/mcp/control-workflow-tools.test.ts
```

Expected: all tests PASS; handler behavior, response schemas, serial reuse, settle behavior, and
background jobs remain unchanged.

### Task 6: Characterize prompt-free Agent integration persistence

**Files:**
- Modify: `tests/unit/core/agent-integrations/agent-integration-manager.test.ts`
- Test: `tests/unit/core/agent-integrations/agent-integration-manager.test.ts`

- [x] **Step 1: Add a reusable forbidden prompt-field assertion in the test file**

```ts
function expectNoEmbeddedRuntimeGuide(serialized: string): void {
  expect(serialized).not.toContain('LinkTerm MCP Agent Runbook');
  expect(serialized).not.toMatch(/systemPrompt|system_prompt|instructions\s*=/);
  expect(serialized).not.toContain('get_agent_runbook');
  expect(serialized).not.toContain('SERIAL_SESSION_CONFLICT');
}
```

- [x] **Step 2: Apply it to existing VS Code/Cursor/Claude JSON, Codex stdio TOML, and Codex HTTP TOML install tests**

No product implementation is expected because current `mergeLinkTermConfig` and TOML writers already
persist only command/args/env or URL/token fields. This is characterization, not a fabricated RED
behavior change.

- [x] **Step 3: Run the Agent integration tests**

Run:

```powershell
pnpm exec vitest run tests/unit/core/agent-integrations/agent-integration-manager.test.ts tests/unit/core/agent-integrations/launch-config.test.ts
```

Expected: PASS. If it fails, inspect the concrete serialized config; do not remove required launch or
authentication fields merely to satisfy the negative assertion.

### Task 7: Add the maintainer MCP operating manual

**Files:**
- Create: `docs/mcp-usage-guide.md`
- Reference: `README.md`
- Reference: `openspec/changes/align-mcp-runtime-usage-guide/design.md`

- [x] **Step 1: Write the manual with this concrete structure**

```markdown
# LinkTerm MCP 使用说明与维护指南

## 1. 先理解运行模型
## 2. AI 的推荐启动顺序
## 3. 简单串口、活动 Session、工作区与控制配置如何选择
## 4. 人和 AI 如何共享终端
## 5. write/read/send_and_wait 的准确语义
## 6. J-Link、RTT、烧录和后台工作流
## 7. Activity/Audit 与硬件成功证据
## 8. 常见错误和禁止的重试方式
## 9. 提示词的四个层次和源码位置
## 10. direct server、HTTP owner 和 stdio proxy
## 11. Agent integration 配置保存什么
## 12. 修改说明书时的同步清单
## 13. MCP Host 限制与 Main 强制边界
## 14. 无真实硬件副作用的验证方法
```

Include exact paths/symbol names, current error codes, and examples for:

```text
get_app_status({root?}) → list_sessions → reuse sessionId
unknown serial config → discover_serial_ports → open_session(create-or-reuse)
send_and_wait(write once + settle) → read_from_session(cursor)
run_control_workflow(background) → get_control_workflow_job_status → read_control_workflow_job
```

- [x] **Step 2: Add an explicit source synchronization table**

The table must map initialize, detailed runbook, tool descriptions, direct server, proxy, Agent
configuration, specs, tests, and build output to exact files. State that source changes require a
rebuild/restart and that host support for MCP server instructions varies.

- [x] **Step 3: Verify names and links mechanically**

Run:

```powershell
rg -n "createAgentRunbookInstructions|get_agent_runbook|get_app_status|open_session|send_and_wait|run_control_workflow|startMcpStdioProxy|mergeLinkTermConfig" docs/mcp-usage-guide.md src/mcp src/core/agent-integrations
git diff --check -- docs/mcp-usage-guide.md
```

Expected: every named symbol/tool appears in source and the document has no whitespace errors.

### Task 8: OpenSpec task closure, review, and full verification

**Files:**
- Modify: `openspec/changes/align-mcp-runtime-usage-guide/tasks.md`
- Create: `openspec/changes/align-mcp-runtime-usage-guide/verification.md`

- [x] **Step 1: Run all focused tests together**

```powershell
pnpm exec vitest run tests/unit/mcp/agent-runbook.test.ts tests/unit/mcp/tool-descriptions.test.ts tests/unit/mcp/stdio-proxy.test.ts tests/unit/mcp/terminal-tools.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/core/agent-integrations/agent-integration-manager.test.ts tests/unit/core/agent-integrations/launch-config.test.ts
```

Expected: all selected files/tests PASS, with no skipped new acceptance test.

- [x] **Step 2: Request independent code review**

Review against the OpenSpec requirements, especially protocol delivery, false hardware claims,
shared-session closure, automatic execution, retry safety, and accidental runtime behavior changes.
Address valid high-confidence findings and rerun affected tests.

- [x] **Step 3: Load `verification-before-completion` and run full gates**

```powershell
pnpm run test:coverage
pnpm run lint
pnpm run build
pnpm run validate:licenses
pnpm exec openspec validate align-mcp-runtime-usage-guide --strict --json
git diff --check
```

Expected: zero command failures; record file/test counts, skips, and coverage percentages from fresh
output. A Vite chunk-size warning is non-fatal but must be recorded.

- [x] **Step 4: Refresh GitNexus PDG if stale and run scope/security review**

Run `detect_changes(scope=all)`, PDG impact/query for the changed instruction/proxy/registration
symbols, and directed taint `explain` for:

```text
src/mcp/stdio-proxy.ts
src/mcp/surfaces/agent-runbook/runbook.ts
src/mcp/surfaces/agent-runbook/tools.ts
src/mcp/surfaces/terminal/tools.ts
src/mcp/surfaces/control-workflow/tools.ts
```

Expected: only guidance/proxy-construction/test/doc flows are affected. Treat no-layer/degraded PDG as
UNKNOWN and zero taint findings as limited evidence, not proof of safety.

- [x] **Step 5: Record verification and close tasks**

Create `verification.md` with commands/results, review findings/fixes, direct/proxy/get-runbook/
tools-list evidence, GitNexus scope, taint caveat, spec-conflict note, worktree status, and explicit
confirmation that no real hardware operation, commit, push, PR, reset, checkout, or cleanup occurred.

- [x] **Step 6: Completion audit**

Re-read every OpenSpec scenario and map it to a current file/test/command result. Do not call the Goal
complete until every requirement has direct evidence and no required task remains.
