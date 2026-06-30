# HTTP MCP Codex Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex integrations install LinkTerm as a Streamable HTTP MCP server by default, especially for WSL, while preserving stdio as a compatibility fallback.

**Architecture:** Keep LinkTerm's existing HTTP owner runtime as the deep module and move Codex-specific configuration generation to an HTTP-first adapter. The external interface stays `AgentIntegrationManager.install/getStatus`; only target launch metadata and TOML rendering learn the difference between stdio and streamable HTTP. Stdio remains available for clients that do not support HTTP or when the app HTTP runtime is unavailable.

**Tech Stack:** Electron main process, TypeScript, Codex `~/.codex/config.toml`, Streamable HTTP MCP, Vitest, GitNexus impact/detect_changes.

---

## Current Problem

The current WSL Codex path uses stdio:

```text
Codex in WSL -> cmd.exe -> Windows Electron launcher -> LinkTerm owner runtime -> MCP stdio proxy
```

That chain is fragile. WSL cwd, `cmd.exe` startup warnings, Electron environment variables, proxy lifecycle, and stdout/stderr noise can all affect MCP discovery. LinkTerm already exposes an authenticated Streamable HTTP MCP endpoint through `startMcpHttpRuntimeServer`, and Codex supports HTTP MCP via `codex mcp add <name> --url <URL>`.

The desired target shape for Codex is:

```toml
[mcp_servers.linkterm]
type = "streamable_http"
url = "http://localhost:57371/mcp"
bearer_token_env_var = "LINKTERM_MCP_TOKEN"
```

If Codex expects the type spelling to be `http` or another concrete value in this version, use the value produced by `codex mcp add linkterm --url ... --bearer-token-env-var LINKTERM_MCP_TOKEN` and assert it in tests.

## Files And Responsibilities

- `src/shared/agent-integrations.ts`
  - Extend integration target metadata so one target can install either stdio or HTTP MCP configuration.
  - Add HTTP launch/config shape without exposing HTTP token values to the renderer.

- `src/core/agent-integrations/agent-integration-manager.ts`
  - Parse, render, install, and status-check Codex TOML for both stdio and HTTP transports.
  - Prefer the target-provided transport config over fallback stdio launch config.

- `src/core/agent-integrations/launch-config.ts`
  - Keep stdio builders unchanged.
  - Add a small HTTP config builder if needed, but avoid mixing runtime startup with config rendering.

- `src/main/ipc/agent-integration-targets.ts`
  - Build Windows Codex and WSL Codex targets as HTTP-first when LinkTerm can provide a stable HTTP endpoint.
  - Keep stdio target data for fallback or for non-HTTP clients.

- `src/main/ipc/index.ts`
  - Pass userData/app root/runtime HTTP metadata details needed to construct HTTP targets.
  - Do not leak bearer tokens over renderer-visible status.

- `src/mcp/http-runtime-server.ts`
  - Make the HTTP runtime endpoint suitable for stable agent configuration: fixed or deterministic port, persistent token, and localhost-safe URL.

- `src/mcp/runtime-metadata.ts`
  - Persist/read metadata fields required by stable HTTP setup, including token and chosen URL.

- `src/renderer/components/AgentIntegrationsPanel.tsx`
  - Show transport as `HTTP` or `stdio` and keep location badges.

- Tests:
  - `tests/unit/core/agent-integrations/agent-integration-manager.test.ts`
  - `tests/unit/main/ipc/agent-integration-targets.test.ts`
  - `tests/unit/mcp/http-runtime-server.test.ts`
  - `tests/unit/mcp/runtime-metadata.test.ts`
  - `tests/unit/renderer/components/AgentIntegrationsPanel.test.tsx`

## Design Decisions

1. HTTP is default for Codex targets because Codex supports `--url`.
2. Stdio remains fallback for VS Code/Cursor/Claude-style config targets and for explicit compatibility mode.
3. LinkTerm HTTP config should use `localhost`, not raw `127.0.0.1`, because WSL proxy/no_proxy handling was observed to be safer with `localhost`.
4. The bearer token must not be embedded directly in `config.toml`. Store it in an environment variable reference when Codex supports it.
5. The HTTP endpoint needs stable configuration. A random port and random token written into app metadata is fine for stdio proxy attachment, but not for persistent Codex config.

---

### Task 1: Discover Codex HTTP TOML Shape

**Files:**
- Create: `tests/unit/fixtures/codex-http-mcp-shape.md`
- No production code change.

- [ ] **Step 1: Generate a reference config in an isolated Codex home**

Run:

```powershell
$tmp = New-Item -ItemType Directory -Force "$env:TEMP\codex-http-shape"
$env:CODEX_HOME = $tmp.FullName
codex mcp add linkterm --url http://localhost:57371/mcp --bearer-token-env-var LINKTERM_MCP_TOKEN
Get-Content -Raw (Join-Path $tmp.FullName "config.toml")
```

Expected: `config.toml` contains an `[mcp_servers.linkterm]` table with a URL transport field and token env var field.

- [ ] **Step 2: Record the exact reference shape**

Create `tests/unit/fixtures/codex-http-mcp-shape.md` with the exact TOML block from the current Codex CLI. Use this template after replacing field names with the observed output:

```markdown
# Codex HTTP MCP Shape

Generated by:

```powershell
codex mcp add linkterm --url http://localhost:57371/mcp --bearer-token-env-var LINKTERM_MCP_TOKEN
```

Observed TOML:

```toml
[mcp_servers.linkterm]
type = "streamable_http"
url = "http://localhost:57371/mcp"
bearer_token_env_var = "LINKTERM_MCP_TOKEN"
```
```

- [ ] **Step 3: Commit reference fixture**

Run:

```powershell
git add tests/unit/fixtures/codex-http-mcp-shape.md
git commit -m "test: document codex http mcp config shape"
```

Expected: commit succeeds. If not committing in this workflow, leave the file staged or mention it in the final report.

---

### Task 2: Add Transport Types To Shared Integration Model

**Files:**
- Modify: `src/shared/agent-integrations.ts`
- Test: `tests/unit/core/agent-integrations/agent-integration-manager.test.ts`

- [ ] **Step 1: Write failing tests for HTTP Codex install/status**

Add this test near existing Codex TOML tests in `tests/unit/core/agent-integrations/agent-integration-manager.test.ts`:

```ts
it('installs Codex HTTP MCP config using a bearer token environment variable', async () => {
  const targets = makeCodexTargets(root).map((target) => ({
    ...target,
    transport: {
      type: 'http' as const,
      url: 'http://localhost:57371/mcp',
      bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
    },
  }));
  const codex = targets[0];

  const manager = new AgentIntegrationManager({
    targets,
    launchConfig: makeLaunchConfig(root),
  });

  await manager.install('codex');

  const written = await readFile(codex.configPath, 'utf-8');
  expect(written).toContain('[mcp_servers.linkterm]');
  expect(written).toContain('url = "http://localhost:57371/mcp"');
  expect(written).toContain('bearer_token_env_var = "LINKTERM_MCP_TOKEN"');
  expect(written).not.toContain('command = ');
  expect(await manager.getStatus('codex')).toMatchObject({
    status: 'configured',
    configured: true,
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
pnpm test -- tests/unit/core/agent-integrations/agent-integration-manager.test.ts
```

Expected: FAIL because `transport` is not defined on `AgentIntegrationTarget`, and HTTP Codex TOML rendering is not implemented.

- [ ] **Step 3: Add shared types**

Modify `src/shared/agent-integrations.ts`:

```ts
export interface LinkTermMcpStdioTransport {
  type: 'stdio';
  launchConfig: LinkTermMcpLaunchConfig;
}

export interface LinkTermMcpHttpTransport {
  type: 'http';
  url: string;
  bearerTokenEnvVar?: string;
}

export type LinkTermMcpTransport =
  | LinkTermMcpStdioTransport
  | LinkTermMcpHttpTransport;
```

Add to `AgentIntegrationTarget`:

```ts
transport?: LinkTermMcpTransport;
```

Do not remove `launchConfig` yet. It is the compatibility field used by existing code.

- [ ] **Step 4: Run test**

Run:

```powershell
pnpm test -- tests/unit/core/agent-integrations/agent-integration-manager.test.ts
```

Expected: still FAIL, now because manager does not render HTTP transport.

---

### Task 3: Render And Parse Codex HTTP TOML

**Files:**
- Modify: `src/core/agent-integrations/agent-integration-manager.ts`
- Test: `tests/unit/core/agent-integrations/agent-integration-manager.test.ts`

- [ ] **Step 1: Add transport resolution helpers**

In `src/core/agent-integrations/agent-integration-manager.ts`, add:

```ts
type ResolvedMcpConfig =
  | { type: 'stdio'; launchConfig: LinkTermMcpLaunchConfig }
  | { type: 'http'; url: string; bearerTokenEnvVar?: string };

function mcpConfigForTarget(
  target: AgentIntegrationTarget,
  fallback: LinkTermMcpLaunchConfig,
): ResolvedMcpConfig {
  if (target.transport?.type === 'http') {
    return {
      type: 'http',
      url: target.transport.url,
      ...(target.transport.bearerTokenEnvVar ? { bearerTokenEnvVar: target.transport.bearerTokenEnvVar } : {}),
    };
  }
  if (target.transport?.type === 'stdio') {
    return { type: 'stdio', launchConfig: target.transport.launchConfig };
  }
  return { type: 'stdio', launchConfig: launchConfigForTarget(target, fallback) };
}
```

- [ ] **Step 2: Update install path**

In `#installNow`, replace:

```ts
const launchConfig = launchConfigForTarget(target, this.#launchConfig);
```

with:

```ts
const mcpConfig = mcpConfigForTarget(target, this.#launchConfig);
```

For Codex:

```ts
await this.#writeTargetConfigText(target, mergeCodexTomlConfig(current, mcpConfig));
```

For JSON config targets:

```ts
if (mcpConfig.type !== 'stdio') throw new Error(`HTTP MCP config is only supported for Codex targets: ${target.id}`);
await this.#writeConfig(target.configPath, mergeLinkTermConfig(current, target, mcpConfig.launchConfig));
```

- [ ] **Step 3: Update status path**

In `#statusFor`, compare against `mcpConfigForTarget(target, this.#launchConfig)` instead of only `launchConfigForTarget`.

- [ ] **Step 4: Make Codex TOML functions transport-aware**

Change signatures:

```ts
function mergeCodexTomlConfig(raw: string, mcpConfig: ResolvedMcpConfig): string
function renderCodexLinkTermToml(mcpConfig: ResolvedMcpConfig): string
function readCodexTomlLinkTermConfig(raw: string): ResolvedMcpConfig | undefined
function mcpConfigMatches(current: unknown, expected: ResolvedMcpConfig, configKind: AgentIntegrationTarget['configKind']): boolean
```

Render HTTP using the exact Codex shape discovered in Task 1:

```ts
function renderCodexLinkTermToml(mcpConfig: ResolvedMcpConfig): string {
  if (mcpConfig.type === 'http') {
    return [
      '[mcp_servers.linkterm]',
      'type = "streamable_http"',
      `url = ${tomlString(mcpConfig.url)}`,
      ...(mcpConfig.bearerTokenEnvVar ? [`bearer_token_env_var = ${tomlString(mcpConfig.bearerTokenEnvVar)}`] : []),
    ].join('\n');
  }
  const launchConfig = mcpConfig.launchConfig;
  const args = launchConfig.args.map(tomlString).join(', ');
  const envEntries = Object.entries(launchConfig.env).map(
    ([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`,
  );
  return [
    '[mcp_servers.linkterm]',
    'type = "stdio"',
    `command = ${tomlString(launchConfig.command)}`,
    `args = [ ${args} ]`,
    ...(launchConfig.cwd ? [`cwd = ${tomlString(launchConfig.cwd)}`] : []),
    '',
    '[mcp_servers.linkterm.env]',
    ...envEntries,
  ].join('\n');
}
```

Parse HTTP:

```ts
const url = parseTomlString(server.url);
if (url !== undefined) {
  const bearerTokenEnvVar = parseTomlString(server.bearer_token_env_var);
  return { type: 'http', url, ...(bearerTokenEnvVar ? { bearerTokenEnvVar } : {}) };
}
```

- [ ] **Step 5: Run test and verify GREEN**

Run:

```powershell
pnpm test -- tests/unit/core/agent-integrations/agent-integration-manager.test.ts
```

Expected: PASS for the new HTTP Codex test and all existing Codex stdio tests.

---

### Task 4: Stabilize LinkTerm HTTP Runtime Config

**Files:**
- Modify: `src/mcp/http-runtime-server.ts`
- Modify: `src/mcp/runtime-metadata.ts`
- Test: `tests/unit/mcp/http-runtime-server.test.ts`
- Test: `tests/unit/mcp/runtime-metadata.test.ts`

- [ ] **Step 1: Write failing test for stable token/port inputs**

Add to `tests/unit/mcp/http-runtime-server.test.ts`:

```ts
it('can start on a requested localhost port with a provided token', async () => {
  server = await startMcpHttpRuntimeServer({
    sessionManager: new SessionManager(),
    serialDiscovery: makeSerialDiscovery(),
    metadataPath: path.join(root, 'mcp-runtime.json'),
    host: '127.0.0.1',
    port: 57371,
    token: 'abcdefghijklmnopqrstuvwxyz1234567890_stable',
  });

  expect(server.url).toBe('http://127.0.0.1:57371/mcp');
  expect(server.token).toBe('abcdefghijklmnopqrstuvwxyz1234567890_stable');
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
pnpm test -- tests/unit/mcp/http-runtime-server.test.ts
```

Expected: FAIL because `token` is not accepted in `StartMcpHttpRuntimeServerOptions`, or port may be occupied in local dev. If port collision occurs in test, use `port: 0` but assert token override first.

- [ ] **Step 3: Add token option**

Modify `StartMcpHttpRuntimeServerOptions`:

```ts
token?: string;
```

Change:

```ts
const token = createRuntimeToken();
```

to:

```ts
const token = options.token ?? createRuntimeToken();
```

- [ ] **Step 4: Add persistent HTTP settings helpers**

In `src/mcp/runtime-metadata.ts`, add:

```ts
const RUNTIME_HTTP_SETTINGS_FILE = 'mcp-http-settings.json';

export interface McpHttpSettings {
  schemaVersion: 'linkterm-mcp-http-settings/1.0.0';
  host: '127.0.0.1';
  port: number;
  token: string;
}

export function runtimeHttpSettingsPath(userDataDir: string): string {
  return path.join(userDataDir, RUNTIME_HTTP_SETTINGS_FILE);
}
```

Add `readRuntimeHttpSettings` and `writeRuntimeHttpSettings` with the same validation style as `readRuntimeMetadata`. Default port should be `57371`, and token should be generated once if missing.

- [ ] **Step 5: Add runtime metadata tests**

Create or extend `tests/unit/mcp/runtime-metadata.test.ts`:

```ts
it('persists stable HTTP settings for external agent configuration', async () => {
  const filePath = path.join(root, 'mcp-http-settings.json');
  const first = await readOrCreateRuntimeHttpSettings(filePath);
  const second = await readOrCreateRuntimeHttpSettings(filePath);

  expect(second).toEqual(first);
  expect(first.host).toBe('127.0.0.1');
  expect(first.port).toBe(57371);
  expect(first.token.length).toBeGreaterThanOrEqual(32);
});
```

- [ ] **Step 6: Run tests**

Run:

```powershell
pnpm test -- tests/unit/mcp/http-runtime-server.test.ts tests/unit/mcp/runtime-metadata.test.ts
```

Expected: PASS.

---

### Task 5: Build HTTP-First Codex Targets

**Files:**
- Modify: `src/main/ipc/agent-integration-targets.ts`
- Modify: `src/main/ipc/index.ts`
- Test: `tests/unit/main/ipc/agent-integration-targets.test.ts`

- [ ] **Step 1: Write failing target discovery test**

Add to `tests/unit/main/ipc/agent-integration-targets.test.ts`:

```ts
it('builds Codex targets as HTTP-first when HTTP settings are provided', async () => {
  const targets = await buildDefaultAgentIntegrationTargets({
    appData: 'C:\\Users\\A\\AppData\\Roaming',
    appRoot: 'C:\\Users\\Admin\\Desktop\\Code\\link-terminal',
    home: 'C:\\Users\\A',
    httpTransport: {
      url: 'http://localhost:57371/mcp',
      bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
    },
    wslHomeDirs: async () => [
      {
        distroName: 'Ubuntu-24.04',
        userName: 'jianyin',
        homePath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin',
        linuxHomePath: '/home/jianyin',
      },
    ],
  });

  expect(targets).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'codex',
      transport: { type: 'http', url: 'http://localhost:57371/mcp', bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN' },
    }),
    expect.objectContaining({
      id: 'codex:wsl:Ubuntu-24.04:jianyin',
      transport: { type: 'http', url: 'http://localhost:57371/mcp', bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN' },
    }),
  ]));
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
pnpm test -- tests/unit/main/ipc/agent-integration-targets.test.ts
```

Expected: FAIL because `httpTransport` is not accepted.

- [ ] **Step 3: Add target builder option**

Modify `BuildDefaultAgentIntegrationTargetsOptions`:

```ts
httpTransport?: {
  url: string;
  bearerTokenEnvVar?: string;
};
```

When creating Windows and WSL Codex targets, set:

```ts
transport: options.httpTransport
  ? { type: 'http', ...options.httpTransport }
  : undefined,
```

Keep existing WSL `launchConfig` fallback for stdio.

- [ ] **Step 4: Wire main process settings**

In `src/main/ipc/index.ts`, before `buildDefaultAgentIntegrationTargets`, read or create stable HTTP settings:

```ts
const httpSettings = await readOrCreateRuntimeHttpSettings(runtimeHttpSettingsPath(app.getPath('userData')));
```

Pass:

```ts
httpTransport: {
  url: `http://localhost:${httpSettings.port}/mcp`,
  bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
},
```

Also pass `token: httpSettings.token` and `port: httpSettings.port` into `startMcpHttpRuntimeServer`.

- [ ] **Step 5: Run target tests**

Run:

```powershell
pnpm test -- tests/unit/main/ipc/agent-integration-targets.test.ts
```

Expected: PASS.

---

### Task 6: Token Environment Delivery For Codex

**Files:**
- Modify: `src/core/agent-integrations/agent-integration-manager.ts`
- Create: `src/main/ipc/codex-token-env.ts`
- Test: `tests/unit/main/ipc/codex-token-env.test.ts`

- [ ] **Step 1: Decide token delivery strategy**

Use this strategy:

```text
Preferred: Codex config references bearer_token_env_var = "LINKTERM_MCP_TOKEN".
Install flow writes a companion environment helper only when the host supports it.
If Codex does not inherit that env var in the current host, status reports needs-update with a message.
```

Do not embed the token directly in `config.toml`.

- [ ] **Step 2: Add test for env helper content**

Create `tests/unit/main/ipc/codex-token-env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderCodexTokenEnvScript } from '@/main/ipc/codex-token-env.js';

describe('renderCodexTokenEnvScript', () => {
  it('renders a shell-safe PowerShell env assignment', () => {
    expect(renderCodexTokenEnvScript({
      envVar: 'LINKTERM_MCP_TOKEN',
      token: 'abc123_-.TOKEN',
    })).toContain('$env:LINKTERM_MCP_TOKEN = "abc123_-.TOKEN"');
  });
});
```

- [ ] **Step 3: Implement helper**

Create `src/main/ipc/codex-token-env.ts`:

```ts
export function renderCodexTokenEnvScript(input: { envVar: string; token: string }): string {
  const escaped = input.token.replace(/`/g, '``').replace(/"/g, '`"');
  return `$env:${input.envVar} = "${escaped}"\n`;
}
```

- [ ] **Step 4: Run test**

Run:

```powershell
pnpm test -- tests/unit/main/ipc/codex-token-env.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add status warning if token env var is required**

In `AgentIntegrationManager.#statusFor`, when expected config is HTTP and `bearerTokenEnvVar` is set, include a clear `message` if the current process does not have that env var:

```ts
if (configured && expected.type === 'http' && expected.bearerTokenEnvVar && !process.env[expected.bearerTokenEnvVar]) {
  return toStatus(target, 'needs-update', false, true, `Set ${expected.bearerTokenEnvVar} before starting Codex`);
}
```

If passing `process.env` into core is preferable, add an injected `env?: NodeJS.ProcessEnv` option to avoid hard global reads.

---

### Task 7: Renderer Shows HTTP Transport

**Files:**
- Modify: `src/renderer/components/AgentIntegrationsPanel.tsx`
- Test: `tests/unit/renderer/components/AgentIntegrationsPanel.test.tsx`

- [ ] **Step 1: Write failing UI test**

Add to `tests/unit/renderer/components/AgentIntegrationsPanel.test.tsx`:

```tsx
it('shows HTTP transport badges for HTTP MCP targets', async () => {
  mockList.mockResolvedValue([
    {
      id: 'codex',
      label: 'Codex',
      configPath: 'C:\\Users\\A\\.codex\\config.toml',
      configKind: 'codex-config-toml',
      platform: 'windows',
      locationLabel: 'Windows',
      transportLabel: 'HTTP',
      status: 'configured',
      configured: true,
      canInstall: false,
    },
  ]);

  render(<AgentIntegrationsPanel />);

  expect(await screen.findByText('HTTP')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
pnpm test -- tests/unit/renderer/components/AgentIntegrationsPanel.test.tsx
```

Expected: FAIL because `transportLabel` is not displayed.

- [ ] **Step 3: Add transport label to status**

In `src/shared/agent-integrations.ts`, add:

```ts
transportLabel?: 'HTTP' | 'stdio';
```

In `toStatus`, set it based on `target.transport?.type`.

- [ ] **Step 4: Render badge**

In `AgentIntegrationsPanel.tsx`, render a small badge next to `locationLabel`:

```tsx
{status.transportLabel ? (
  <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
    {status.transportLabel}
  </span>
) : null}
```

- [ ] **Step 5: Run UI test**

Run:

```powershell
pnpm test -- tests/unit/renderer/components/AgentIntegrationsPanel.test.tsx
```

Expected: PASS.

---

### Task 8: End-To-End Smoke Verification

**Files:**
- No required source changes.
- Optional create: `scripts/probe-codex-http-mcp.mjs`

- [ ] **Step 1: Start LinkTerm HTTP runtime**

Run LinkTerm in development mode or start the app once so `mcp-runtime.json` and stable HTTP settings exist.

Expected:

```powershell
Invoke-RestMethod -Uri http://localhost:57371/health -Headers @{ Authorization = "Bearer $env:LINKTERM_MCP_TOKEN" }
```

returns:

```json
{"success":true}
```

- [ ] **Step 2: Install Codex HTTP config**

Use the UI install button or call the IPC-backed manager from an integration harness.

Expected Windows `C:\Users\Admin\.codex\config.toml` contains the HTTP `linkterm` block.

Expected WSL `/home/jianyin/.codex/config.toml` contains the same HTTP `linkterm` block.

- [ ] **Step 3: Verify Windows Codex parsing**

Run:

```powershell
codex mcp get linkterm --json
```

Expected JSON has `transport.type` corresponding to HTTP and URL `http://localhost:57371/mcp`.

- [ ] **Step 4: Verify WSL Codex parsing**

Run:

```powershell
wsl.exe -d Ubuntu-24.04 -e /bin/sh -lc 'codex mcp get linkterm --json'
```

Expected JSON has HTTP URL `http://localhost:57371/mcp`.

- [ ] **Step 5: Verify WSL network path**

Run:

```powershell
wsl.exe -d Ubuntu-24.04 -e /bin/sh -lc 'curl -fsS -H "Authorization: Bearer '"$env:LINKTERM_MCP_TOKEN"'" http://localhost:57371/health'
```

Expected:

```json
{"success":true}
```

- [ ] **Step 6: Verify MCP tool call**

Run a small MCP SDK client against `http://localhost:57371/mcp`, or use Codex after restart and call `get_app_status`.

Expected:

```json
{
  "success": true,
  "evidence": {
    "kind": "app_status"
  }
}
```

---

### Task 9: Final Quality Gate

**Files:**
- No source change.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm test -- tests/unit/core/agent-integrations/agent-integration-manager.test.ts tests/unit/main/ipc/agent-integration-targets.test.ts tests/unit/mcp/http-runtime-server.test.ts tests/unit/mcp/runtime-metadata.test.ts tests/unit/renderer/components/AgentIntegrationsPanel.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Run build and lint**

Run:

```powershell
pnpm run build:main
pnpm run lint
```

Expected: both commands exit 0.

- [ ] **Step 4: Run GitNexus detect_changes**

Run through MCP:

```json
detect_changes({ "repo": "link-mcp", "scope": "unstaged" })
```

Expected: affected processes are limited to agent integration config/status, HTTP runtime metadata/server, and renderer display. If risk is HIGH or CRITICAL, report it explicitly before merging.

---

## Acceptance Criteria

- Codex Windows target installs LinkTerm as HTTP MCP by default.
- Codex WSL target installs LinkTerm as HTTP MCP by default.
- Stdio install path still works for non-HTTP targets and compatibility fallback.
- No WSL `cmd.exe`/UNC stdout or stderr startup noise is needed for HTTP Codex integration.
- `codex mcp get linkterm --json` reports URL-based transport for both Windows and WSL Codex configs.
- `get_app_status` succeeds over HTTP from Windows and from WSL.
- Full test suite, `build:main`, `lint`, and GitNexus `detect_changes` have fresh results.

## Rollback Plan

If HTTP config breaks Codex in the field, keep the stable HTTP runtime code but flip Codex targets back to stdio by omitting `httpTransport` in `buildDefaultAgentIntegrationTargets`. Because stdio fallback remains implemented, rollback should only touch `src/main/ipc/index.ts` and target-builder tests.
