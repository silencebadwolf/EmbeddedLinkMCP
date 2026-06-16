import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  AgentIntegrationManager,
  type AgentIntegrationTarget,
  type LinkTermMcpLaunchConfig,
} from '@/core/agent-integrations/index.js';

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'lt-agent-integrations-'));
}

function makeTargets(root: string): AgentIntegrationTarget[] {
  return [
    {
      id: 'vscode',
      label: 'VS Code Copilot',
      configPath: path.join(root, 'Code', 'User', 'settings.json'),
      configKind: 'vscode-settings',
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: path.join(root, 'Claude', 'claude_desktop_config.json'),
      configKind: 'mcp-servers',
    },
  ];
}

function makeVscodeMcpJsonTargets(root: string): AgentIntegrationTarget[] {
  return [
    {
      id: 'vscode',
      label: 'VS Code Copilot',
      configPath: path.join(root, 'Code', 'User', 'mcp.json'),
      configKind: 'vscode-mcp-json',
    },
  ];
}

function makeLaunchConfig(root: string): LinkTermMcpLaunchConfig {
  return {
    command: path.join(root, 'LinkTerm.exe'),
    args: [root],
    env: {
      LINKTERM_MCP_STDIO: '1',
      LINKTERM_FORCE_DIST: '1',
    },
  };
}

describe('AgentIntegrationManager', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('detects missing config files and reports installable status', async () => {
    const manager = new AgentIntegrationManager({
      targets: makeTargets(root),
      launchConfig: makeLaunchConfig(root),
    });

    const statuses = await manager.listStatuses();

    expect(statuses).toEqual([
      expect.objectContaining({
        id: 'vscode',
        label: 'VS Code Copilot',
        configKind: 'vscode-settings',
        status: 'not-found',
        configured: false,
        canInstall: true,
      }),
      expect.objectContaining({
        id: 'claude-desktop',
        label: 'Claude Desktop',
        configKind: 'mcp-servers',
        status: 'not-found',
        configured: false,
        canInstall: true,
      }),
    ]);
  });

  it('installs VS Code chat.mcpServers.linkterm while preserving existing settings and creating backup', async () => {
    const targets = makeTargets(root);
    const vscode = targets[0];
    await mkdir(path.dirname(vscode.configPath), { recursive: true });
    await writeFile(vscode.configPath, JSON.stringify({ editor: { fontSize: 16 } }, null, 2));

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      now: () => new Date('2026-06-15T08:09:10Z'),
    });

    const result = await manager.install('vscode');

    expect(result.status.status).toBe('configured');
    expect(result.backupPath).toMatch(/settings\.json\.bak-20260615-080910-\d{6}$/);

    const parsed = JSON.parse(await readFile(vscode.configPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed.editor).toEqual({ fontSize: 16 });
    expect(parsed['chat.mcpServers']).toMatchObject({
      linkterm: makeLaunchConfig(root),
    });

    const backup = JSON.parse(await readFile(result.backupPath!, 'utf-8')) as Record<string, unknown>;
    expect(backup).toEqual({ editor: { fontSize: 16 } });
  });

  it('accepts JSONC-style VS Code settings and still backs up original text', async () => {
    const targets = makeTargets(root);
    const vscode = targets[0];
    await mkdir(path.dirname(vscode.configPath), { recursive: true });
    const original = `{
      // User comment kept in backup
      "editor.fontSize": 16,
    }`;
    await writeFile(vscode.configPath, original);

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      now: () => new Date('2026-06-15T08:09:10Z'),
    });

    const result = await manager.install('vscode');

    expect(result.status.status).toBe('configured');
    expect(await readFile(result.backupPath!, 'utf-8')).toBe(original);
    const parsed = JSON.parse(await readFile(vscode.configPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed['editor.fontSize']).toBe(16);
    expect(parsed['chat.mcpServers']).toMatchObject({ linkterm: makeLaunchConfig(root) });
  });

  it('does not treat comma-brace text inside JSONC strings as trailing commas', async () => {
    const targets = makeTargets(root);
    const vscode = targets[0];
    await mkdir(path.dirname(vscode.configPath), { recursive: true });
    await writeFile(
      vscode.configPath,
      `{
        "literal": "keep comma before object close: , } and array close: , ]",
        "arrayLiteral": "text, ]"
      }`,
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
    });

    await manager.install('vscode');

    const parsed = JSON.parse(await readFile(vscode.configPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed.literal).toBe('keep comma before object close: , } and array close: , ]');
    expect(parsed.arrayLiteral).toBe('text, ]');
  });

  it('does not overwrite backups or conflict on temp files for repeated installs in the same second', async () => {
    const targets = makeTargets(root);
    const vscode = targets[0];
    await mkdir(path.dirname(vscode.configPath), { recursive: true });
    const firstConfig = JSON.stringify({ marker: 'first' }, null, 2);
    await writeFile(vscode.configPath, firstConfig);

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      now: () => new Date('2026-06-15T08:09:10Z'),
    });

    const first = await manager.install('vscode');
    await writeFile(vscode.configPath, JSON.stringify({ marker: 'second' }, null, 2));
    const second = await manager.install('vscode');

    expect(first.backupPath).toBeDefined();
    expect(second.backupPath).toBeDefined();
    expect(second.backupPath).not.toBe(first.backupPath);
    expect(first.backupPath).toMatch(/\.bak-20260615-080910-\d{6}$/);
    expect(second.backupPath).toMatch(/\.bak-20260615-080910-\d{6}$/);
    expect(await readFile(first.backupPath!, 'utf-8')).toBe(firstConfig);
    expect(JSON.parse(await readFile(second.backupPath!, 'utf-8'))).toEqual({ marker: 'second' });
  });

  it('serializes concurrent installs for the same target', async () => {
    const targets = makeTargets(root);
    const vscode = targets[0];
    await mkdir(path.dirname(vscode.configPath), { recursive: true });
    await writeFile(vscode.configPath, JSON.stringify({ marker: 'initial' }, null, 2));

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      now: () => new Date('2026-06-15T08:09:10Z'),
    });

    const [first, second] = await Promise.all([
      manager.install('vscode'),
      manager.install('vscode'),
    ]);

    expect(first.backupPath).toBeDefined();
    expect(second.backupPath).toBeDefined();
    expect(second.backupPath).not.toBe(first.backupPath);
    const parsed = JSON.parse(await readFile(vscode.configPath, 'utf-8')) as Record<string, unknown>;
    expect(parsed['chat.mcpServers']).toMatchObject({ linkterm: makeLaunchConfig(root) });
  });

  it('installs VS Code User mcp.json servers.linkterm while preserving inputs', async () => {
    const targets = makeVscodeMcpJsonTargets(root);
    const vscodeMcp = targets[0];
    await mkdir(path.dirname(vscodeMcp.configPath), { recursive: true });
    await writeFile(
      vscodeMcp.configPath,
      JSON.stringify({ inputs: [{ id: 'keep' }], servers: { existing: { command: 'keep.exe' } } }, null, 2),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      now: () => new Date('2026-06-15T08:09:10Z'),
    });

    const result = await manager.install('vscode');

    expect(result.status.status).toBe('configured');
    const parsed = JSON.parse(await readFile(vscodeMcp.configPath, 'utf-8')) as {
      inputs: unknown[];
      servers: Record<string, unknown>;
    };
    expect(parsed.inputs).toEqual([{ id: 'keep' }]);
    expect(parsed.servers.existing).toEqual({ command: 'keep.exe' });
    expect(parsed.servers.linkterm).toEqual({ ...makeLaunchConfig(root), type: 'stdio' });
  });

  it('reports VS Code User mcp.json linkterm config without stdio type as needs-update', async () => {
    const targets = makeVscodeMcpJsonTargets(root);
    const vscodeMcp = targets[0];
    await mkdir(path.dirname(vscodeMcp.configPath), { recursive: true });
    await writeFile(
      vscodeMcp.configPath,
      JSON.stringify({ servers: { linkterm: makeLaunchConfig(root) } }, null, 2),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
    });

    const status = await manager.getStatus('vscode');

    expect(status.status).toBe('needs-update');
    expect(status.canInstall).toBe(true);
  });

  it('installs Claude Desktop mcpServers.linkterm and reports mismatched existing config as needs-update', async () => {
    const targets = makeTargets(root);
    const claude = targets[1];
    await mkdir(path.dirname(claude.configPath), { recursive: true });
    await writeFile(
      claude.configPath,
      JSON.stringify({ mcpServers: { linkterm: { command: 'old.exe' }, other: { command: 'keep.exe' } } }, null, 2),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      now: () => new Date('2026-06-15T08:09:10Z'),
    });

    const before = await manager.getStatus('claude-desktop');
    expect(before.status).toBe('needs-update');

    const result = await manager.install('claude-desktop');
    expect(result.status.status).toBe('configured');

    const parsed = JSON.parse(await readFile(claude.configPath, 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers.other).toEqual({ command: 'keep.exe' });
    expect(parsed.mcpServers.linkterm).toEqual(makeLaunchConfig(root));
  });

  it('refuses to overwrite malformed JSON', async () => {
    const targets = makeTargets(root);
    const vscode = targets[0];
    await mkdir(path.dirname(vscode.configPath), { recursive: true });
    await writeFile(vscode.configPath, '{ broken json');

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
    });

    const status = await manager.getStatus('vscode');
    expect(status.status).toBe('invalid-json');
    expect(status.canInstall).toBe(false);

    await expect(manager.install('vscode')).rejects.toMatchObject({ code: 'AGENT_CONFIG_INVALID_JSON' });
    await expect(readFile(vscode.configPath, 'utf-8')).resolves.toBe('{ broken json');
  });
});
