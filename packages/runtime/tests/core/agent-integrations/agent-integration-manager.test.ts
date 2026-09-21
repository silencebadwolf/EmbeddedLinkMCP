import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  AgentIntegrationManager,
  type AgentIntegrationTarget,
  type LinkTermMcpLaunchConfig,
} from '@linkterm/runtime/core/agent-integrations/index';

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
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: path.join(root, '.cursor', 'mcp.json'),
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

function makeCodexTargets(root: string): AgentIntegrationTarget[] {
  return [
    {
      id: 'codex',
      label: 'Codex',
      configPath: path.join(root, '.codex', 'config.toml'),
      configKind: 'codex-config-toml',
      platform: 'windows',
      locationLabel: 'Windows',
    },
  ];
}

function makeWslCodexTargets(root: string): AgentIntegrationTarget[] {
  return [
    {
      id: 'codex:wsl:Ubuntu-24.04:jianyin',
      label: 'Codex (Ubuntu-24.04)',
      configPath: path.join(root, 'wsl', 'Ubuntu-24.04', 'home', 'jianyin', '.codex', 'config.toml'),
      wslConfigPath: '/home/jianyin/.codex/config.toml',
      configKind: 'codex-config-toml',
      platform: 'wsl',
      locationLabel: 'WSL: Ubuntu-24.04 / jianyin',
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

function makeWslLaunchConfig(root: string): LinkTermMcpLaunchConfig {
  return {
    ...makeLaunchConfig(root),
    cwd: '/mnt/c/Users/Admin/Desktop/Code/link-terminal',
  };
}

function expectNoEmbeddedRuntimeGuide(serialized: string): void {
  expect(serialized).not.toContain('LinkTerm MCP Agent Runbook');
  expect(serialized).not.toMatch(/["']?(systemPrompt|system_prompt|instructions)["']?\s*[:=]/);
  expect(serialized).not.toContain('get_agent_runbook');
  expect(serialized).not.toContain('SERIAL_SESSION_CONFLICT');
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
      expect.objectContaining({
        id: 'cursor',
        label: 'Cursor',
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
    expectNoEmbeddedRuntimeGuide(JSON.stringify(parsed['chat.mcpServers']));

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
    expectNoEmbeddedRuntimeGuide(JSON.stringify(parsed.servers.linkterm));
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

  it('installs Codex mcp_servers.linkterm TOML while preserving existing settings', async () => {
    const targets = makeCodexTargets(root);
    const codex = targets[0];
    await mkdir(path.dirname(codex.configPath), { recursive: true });
    const original = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.gitnexus]',
      'command = "gitnexus"',
      'args = [ "mcp" ]',
      '',
    ].join('\n');
    await writeFile(codex.configPath, original);

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      now: () => new Date('2026-06-15T08:09:10Z'),
    });

    const result = await manager.install('codex');

    expect(result.status.status).toBe('configured');
    expect(result.status.platform).toBe('windows');
    expect(result.status.locationLabel).toBe('Windows');
    expect(result.backupPath).toMatch(/config\.toml\.bak-20260615-080910-\d{6}$/);

    const written = await readFile(codex.configPath, 'utf-8');
    expect(written).toContain('model = "gpt-5"');
    expect(written).toContain('[mcp_servers.gitnexus]');
    expect(written).toContain('[mcp_servers.linkterm]');
    expect(written).toContain('type = "stdio"');
    expect(written).toContain(`command = ${JSON.stringify(makeLaunchConfig(root).command)}`);
    expect(written).toContain(`args = [ ${JSON.stringify(root)} ]`);
    expect(written).toContain('[mcp_servers.linkterm.env]');
    expect(written).toContain('LINKTERM_MCP_STDIO = "1"');
    expectNoEmbeddedRuntimeGuide(written);
    expect(await readFile(result.backupPath!, 'utf-8')).toBe(original);
  });

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
      env: { LINKTERM_MCP_TOKEN: 'test-token' },
    });

    await manager.install('codex');

    const written = await readFile(codex.configPath, 'utf-8');
    expect(written).toContain('[mcp_servers.linkterm]');
    expect(written).toContain('url = "http://localhost:57371/mcp"');
    expect(written).toContain('bearer_token_env_var = "LINKTERM_MCP_TOKEN"');
    expect(written).not.toContain('command = ');
    expectNoEmbeddedRuntimeGuide(written);
    expect(await manager.getStatus('codex')).toMatchObject({
      status: 'configured',
      configured: true,
    });
  });

  it('uninstalls VS Code mcp.json linkterm config while preserving other servers and creating backup', async () => {
    const targets = makeVscodeMcpJsonTargets(root);
    const vscodeMcp = targets[0];
    await mkdir(path.dirname(vscodeMcp.configPath), { recursive: true });
    const original = {
      inputs: [{ id: 'keep' }],
      servers: {
        keep: { command: 'keep.exe' },
        linkterm: { ...makeLaunchConfig(root), type: 'stdio' },
      },
    };
    await writeFile(vscodeMcp.configPath, JSON.stringify(original, null, 2));

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      now: () => new Date('2026-06-15T08:09:10Z'),
    });

    const result = await manager.uninstall('vscode');

    expect(result.status.status).toBe('not-configured');
    expect(result.backupPath).toMatch(/mcp\.json\.bak-20260615-080910-\d{6}$/);
    const parsed = JSON.parse(await readFile(vscodeMcp.configPath, 'utf-8')) as {
      inputs: unknown[];
      servers: Record<string, unknown>;
    };
    expect(parsed.inputs).toEqual([{ id: 'keep' }]);
    expect(parsed.servers).toEqual({ keep: { command: 'keep.exe' } });
    expect(await readFile(result.backupPath!, 'utf-8')).toBe(JSON.stringify(original, null, 2));
  });

  it('uninstalls Codex TOML linkterm config while preserving other MCP servers', async () => {
    const targets = makeCodexTargets(root);
    const codex = targets[0];
    await mkdir(path.dirname(codex.configPath), { recursive: true });
    await writeFile(
      codex.configPath,
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.linkterm]',
        'type = "stdio"',
        'command = "LinkTerm.exe"',
        'args = [ "." ]',
        '',
        '[mcp_servers.linkterm.env]',
        'LINKTERM_MCP_STDIO = "1"',
        '',
        '[mcp_servers.gitnexus]',
        'command = "gitnexus"',
        'args = [ "mcp" ]',
        '',
      ].join('\n'),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
    });

    const result = await manager.uninstall('codex');

    expect(result.status.status).toBe('not-configured');
    const written = await readFile(codex.configPath, 'utf-8');
    expect(written).toContain('model = "gpt-5"');
    expect(written).toContain('[mcp_servers.gitnexus]');
    expect(written).toContain('command = "gitnexus"');
    expect(written).not.toContain('[mcp_servers.linkterm]');
    expect(written).not.toContain('[mcp_servers.linkterm.env]');
  });

  it('uninstalls WSL Codex config through the WSL file bridge', async () => {
    const targets = makeWslCodexTargets(root);
    const files = new Map<string, string>([
      [
        '/home/jianyin/.codex/config.toml',
        [
          '[mcp_servers.linkterm]',
          'url = "http://localhost:57371/mcp"',
          'bearer_token_env_var = "LINKTERM_MCP_TOKEN"',
          '',
          '[mcp_servers.keep]',
          'command = "keep"',
          '',
        ].join('\n'),
      ],
    ]);
    const wslFiles = {
      readFile: vi.fn(async (target: AgentIntegrationTarget) => files.get(target.wslConfigPath!) ?? ''),
      writeFile: vi.fn(async (target: AgentIntegrationTarget, data: string) => {
        files.set(target.wslConfigPath!, data);
      }),
      writeBackup: vi.fn(async (target: AgentIntegrationTarget, data: string, backupName: string) => {
        files.set(`${target.wslConfigPath!}.${backupName}`, data);
        return `${target.wslConfigPath!}.${backupName}`;
      }),
    };

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeWslLaunchConfig(root),
      wslFiles,
    });

    const result = await manager.uninstall('codex:wsl:Ubuntu-24.04:jianyin');

    expect(wslFiles.writeBackup).toHaveBeenCalled();
    expect(wslFiles.writeFile).toHaveBeenCalledWith(targets[0], expect.not.stringContaining('linkterm'));
    expect(result.backupPath).toMatch(/^\/home\/jianyin\/\.codex\/config\.toml\.bak-/);
    expect(files.get('/home/jianyin/.codex/config.toml')).toContain('[mcp_servers.keep]');
  });

  it('persists the Codex HTTP bearer token environment variable during install', async () => {
    const targets = makeCodexTargets(root).map((target) => ({
      ...target,
      transport: {
        type: 'http' as const,
        url: 'http://localhost:57371/mcp',
        bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
      },
    }));
    const envWriter = {
      writeTokenEnv: vi.fn(async () => ({
        changed: true,
        restartRequired: true,
        message: 'Restart Codex to inherit LINKTERM_MCP_TOKEN',
      })),
    };

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      env: { LINKTERM_MCP_TOKEN: 'stable-token' },
      tokenEnvWriter: envWriter,
    });

    const result = await manager.install('codex');

    expect(envWriter.writeTokenEnv).toHaveBeenCalledWith(targets[0], {
      envVar: 'LINKTERM_MCP_TOKEN',
      token: 'stable-token',
    });
    expect(result.status.message).toBe('Restart Codex to inherit LINKTERM_MCP_TOKEN');
  });

  it('persists the WSL Codex HTTP bearer token environment variable during install', async () => {
    const targets = makeWslCodexTargets(root).map((target) => ({
      ...target,
      transport: {
        type: 'http' as const,
        url: 'http://localhost:57371/mcp',
        bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
      },
    }));
    const envWriter = {
      writeTokenEnv: vi.fn(async () => ({
        changed: false,
        restartRequired: false,
      })),
    };

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeWslLaunchConfig(root),
      env: { LINKTERM_MCP_TOKEN: 'stable-token' },
      tokenEnvWriter: envWriter,
    });

    await manager.install('codex:wsl:Ubuntu-24.04:jianyin');

    expect(envWriter.writeTokenEnv).toHaveBeenCalledWith(targets[0], {
      envVar: 'LINKTERM_MCP_TOKEN',
      token: 'stable-token',
    });
  });

  it('reports Codex HTTP config as needs-update when the token environment variable is missing', async () => {
    const targets = makeCodexTargets(root).map((target) => ({
      ...target,
      transport: {
        type: 'http' as const,
        url: 'http://localhost:57371/mcp',
        bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
      },
    }));
    const codex = targets[0];
    await mkdir(path.dirname(codex.configPath), { recursive: true });
    await writeFile(
      codex.configPath,
      [
        '[mcp_servers.linkterm]',
        'url = "http://localhost:57371/mcp"',
        'bearer_token_env_var = "LINKTERM_MCP_TOKEN"',
        '',
      ].join('\n'),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      env: {},
    });

    expect(await manager.getStatus('codex')).toMatchObject({
      status: 'needs-update',
      configured: false,
      canInstall: true,
      message: 'Set LINKTERM_MCP_TOKEN before starting Codex',
    });
  });

  it('diagnoses Codex HTTP config and token environment readiness', async () => {
    const targets = makeCodexTargets(root).map((target) => ({
      ...target,
      transport: {
        type: 'http' as const,
        url: 'http://localhost:57371/mcp',
        bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
      },
    }));
    const codex = targets[0];
    await mkdir(path.dirname(codex.configPath), { recursive: true });
    await writeFile(
      codex.configPath,
      [
        '[mcp_servers.linkterm]',
        'url = "http://localhost:57371/mcp"',
        'bearer_token_env_var = "LINKTERM_MCP_TOKEN"',
        '',
      ].join('\n'),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      env: {},
    });

    await expect(manager.diagnose('codex')).resolves.toMatchObject({
      targetId: 'codex',
      transport: 'HTTP',
      checks: [
        { id: 'config', status: 'pass' },
        {
          id: 'token-env',
          status: 'fail',
          message: 'LINKTERM_MCP_TOKEN is not visible to LinkTerm right now. Set it before starting LinkTerm and restart Codex so HTTP MCP authentication can inherit it.',
        },
      ],
    });
  });

  it('diagnoses available Codex HTTP token env with an explanatory pass message', async () => {
    const targets = makeCodexTargets(root).map((target) => ({
      ...target,
      transport: {
        type: 'http' as const,
        url: 'http://localhost:57371/mcp',
        bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
      },
    }));
    const codex = targets[0];
    await mkdir(path.dirname(codex.configPath), { recursive: true });
    await writeFile(
      codex.configPath,
      [
        '[mcp_servers.linkterm]',
        'url = "http://localhost:57371/mcp"',
        'bearer_token_env_var = "LINKTERM_MCP_TOKEN"',
        '',
      ].join('\n'),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      env: { LINKTERM_MCP_TOKEN: 'stable-token' },
    });

    await expect(manager.diagnose('codex')).resolves.toMatchObject({
      checks: [
        { id: 'config', status: 'pass' },
        {
          id: 'token-env',
          status: 'pass',
          message: 'LINKTERM_MCP_TOKEN is visible to LinkTerm. HTTP MCP authentication can use it after Codex inherits the environment.',
        },
      ],
    });
  });

  it('reports stale Codex TOML linkterm config as needs-update and repairs only that section', async () => {
    const targets = makeCodexTargets(root);
    const codex = targets[0];
    await mkdir(path.dirname(codex.configPath), { recursive: true });
    await writeFile(
      codex.configPath,
      [
        '[mcp_servers.linkterm]',
        'command = "old.exe"',
        'args = [ "old" ]',
        '',
        '[mcp_servers.linkterm.env]',
        'LINKTERM_MCP_STDIO = "0"',
        '',
        '[mcp_servers.other]',
        'command = "keep.exe"',
        '',
      ].join('\n'),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
    });

    const before = await manager.getStatus('codex');
    expect(before.status).toBe('needs-update');

    await manager.install('codex');

    const after = await manager.getStatus('codex');
    expect(after.status).toBe('configured');
    const written = await readFile(codex.configPath, 'utf-8');
    expect(written).toContain('[mcp_servers.other]');
    expect(written).toContain('command = "keep.exe"');
    expect(written).not.toContain('old.exe');
  });

  it('reports Codex TOML linkterm config without stdio type as needs-update', async () => {
    const targets = makeCodexTargets(root);
    const codex = targets[0];
    await mkdir(path.dirname(codex.configPath), { recursive: true });
    await writeFile(
      codex.configPath,
      [
        '[mcp_servers.linkterm]',
        `command = ${JSON.stringify(makeLaunchConfig(root).command)}`,
        `args = [ ${JSON.stringify(root)} ]`,
        '',
        '[mcp_servers.linkterm.env]',
        'LINKTERM_MCP_STDIO = "1"',
        'LINKTERM_FORCE_DIST = "1"',
        '',
      ].join('\n'),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
    });

    const status = await manager.getStatus('codex');

    expect(status.status).toBe('needs-update');
    expect(status.canInstall).toBe(true);
  });

  it('installs WSL Codex config through Windows cmd interop', async () => {
    const targets = makeWslCodexTargets(root);
    const codex = targets[0];

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeWslLaunchConfig(root),
    });

    await manager.install('codex:wsl:Ubuntu-24.04:jianyin');

    const written = await readFile(codex.configPath, 'utf-8');
    expect(written).toContain('[mcp_servers.linkterm]');
    expect(written).toContain('type = "stdio"');
    expect(written).toContain('command = "cmd.exe"');
    expect(written).toContain('/d');
    expect(written).toContain('/s');
    expect(written).toContain('/c');
    expect(written).toContain('LinkTerm.exe');
    expect(written).toContain('cwd = "/mnt/c/Users/Admin/Desktop/Code/link-terminal"');
    expect(written).toContain('[mcp_servers.linkterm.env]');
    expect(written).toContain('LINKTERM_MCP_STDIO = "1"');
  });

  it('reports WSL Codex config without cwd as needs-update to avoid UNC stdout pollution', async () => {
    const targets = makeWslCodexTargets(root);
    const codex = targets[0];
    await mkdir(path.dirname(codex.configPath), { recursive: true });
    const expected = makeWslLaunchConfig(root);
    await writeFile(
      codex.configPath,
      [
        '[mcp_servers.linkterm]',
        'type = "stdio"',
        `command = ${JSON.stringify(expected.command)}`,
        `args = [ ${expected.args.map((arg) => JSON.stringify(arg)).join(', ')} ]`,
        '',
        '[mcp_servers.linkterm.env]',
        'LINKTERM_MCP_STDIO = "1"',
        'LINKTERM_FORCE_DIST = "1"',
        '',
      ].join('\n'),
    );

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: expected,
    });

    const status = await manager.getStatus('codex:wsl:Ubuntu-24.04:jianyin');

    expect(status.status).toBe('needs-update');
    expect(status.canInstall).toBe(true);
  });

  it('reads and writes WSL Codex config through the WSL file bridge', async () => {
    const targets = makeWslCodexTargets(root);
    const files = new Map<string, string>([
      ['/home/jianyin/.codex/config.toml', 'model = "gpt-5"\n'],
    ]);
    const wslFiles = {
      readFile: vi.fn(async (target: AgentIntegrationTarget) => {
        const raw = files.get(target.wslConfigPath!);
        if (raw === undefined) {
          const err = new Error('missing') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return raw;
      }),
      writeFile: vi.fn(async (target: AgentIntegrationTarget, data: string) => {
        files.set(target.wslConfigPath!, data);
      }),
      writeBackup: vi.fn(async (target: AgentIntegrationTarget, data: string, backupName: string) => {
        files.set(`${target.wslConfigPath!}.${backupName}`, data);
        return `${target.wslConfigPath!}.${backupName}`;
      }),
    };

    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
      wslFiles,
    });

    const result = await manager.install('codex:wsl:Ubuntu-24.04:jianyin');

    expect(wslFiles.readFile).toHaveBeenCalledWith(targets[0]);
    expect(wslFiles.writeFile).toHaveBeenCalledWith(
      targets[0],
      expect.stringContaining('[mcp_servers.linkterm]'),
    );
    expect(result.backupPath).toMatch(/^\/home\/jianyin\/\.codex\/config\.toml\.bak-/);
    expect(files.get('/home/jianyin/.codex/config.toml')).toContain('command = "cmd.exe"');
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
    expectNoEmbeddedRuntimeGuide(JSON.stringify(parsed.mcpServers.linkterm));
  });

  it('installs Cursor mcpServers.linkterm without embedding runtime guidance', async () => {
    const targets = makeTargets(root);
    const cursor = targets[2];
    const manager = new AgentIntegrationManager({
      targets,
      launchConfig: makeLaunchConfig(root),
    });

    const result = await manager.install('cursor');

    expect(result.status.status).toBe('configured');
    const parsed = JSON.parse(await readFile(cursor.configPath, 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers.linkterm).toEqual(makeLaunchConfig(root));
    expectNoEmbeddedRuntimeGuide(JSON.stringify(parsed.mcpServers.linkterm));
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
