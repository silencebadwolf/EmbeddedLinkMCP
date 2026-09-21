import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentIntegrationTarget } from '@linkterm/contracts/agent-integrations';

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => childProcessMock);

import {
  createCodexTokenEnvWriter,
  renderCodexTokenEnvScript,
  renderWslCodexTokenEnvInstallScript,
} from '../../src/main/ipc/codex-token-env.js';

function makeWindowsCodexTarget(): AgentIntegrationTarget {
  return {
    id: 'codex',
    label: 'Codex',
    configPath: 'C:\\Users\\A\\.codex\\config.toml',
    configKind: 'codex-config-toml',
    platform: 'windows',
  };
}

function makeWslCodexTarget(): AgentIntegrationTarget {
  return {
    id: 'codex:wsl:Ubuntu-24.04:jianyin',
    label: 'Codex (Ubuntu-24.04)',
    configPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin\\.codex\\config.toml',
    wslConfigPath: '/home/jianyin/.codex/config.toml',
    configKind: 'codex-config-toml',
    platform: 'wsl',
  };
}

function makeSpawnSuccess(): EventEmitter & {
  stderr: EventEmitter & { setEncoding: (encoding: string) => void };
  stdin: Writable;
  stdinChunks: string[];
} {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter & { setEncoding: (encoding: string) => void };
    stdin: Writable;
    stdinChunks: string[];
  };
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.stdinChunks = [];
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      child.stdinChunks.push(String(chunk));
      callback();
    },
  });
  return child;
}

describe('renderCodexTokenEnvScript', () => {
  beforeEach(() => {
    childProcessMock.execFile.mockReset();
    childProcessMock.spawn.mockReset();
  });

  it('renders a shell-safe PowerShell env assignment', () => {
    expect(renderCodexTokenEnvScript({
      envVar: 'LINKTERM_MCP_TOKEN',
      token: 'abc123_-.TOKEN',
    })).toContain('$env:LINKTERM_MCP_TOKEN = "abc123_-.TOKEN"');
  });

  it('escapes PowerShell backticks and double quotes in the token', () => {
    expect(renderCodexTokenEnvScript({
      envVar: 'LINKTERM_MCP_TOKEN',
      token: 'abc`"123',
    })).toContain('$env:LINKTERM_MCP_TOKEN = "abc```"123"');
  });

  it('renders a WSL profile installer that sources a dedicated env file', () => {
    const script = renderWslCodexTokenEnvInstallScript({
      envVar: 'LINKTERM_MCP_TOKEN',
      token: 'abc123_-.TOKEN',
    });

    expect(script).toContain('mkdir -p "$HOME/.config/linkterm"');
    expect(script).toContain('export LINKTERM_MCP_TOKEN=');
    expect(script).toContain('. \\"$HOME/.config/linkterm/mcp-env.sh\\"');
  });

  it('writes Windows user-level token env with setx', async () => {
    childProcessMock.execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(null, { stdout: 'SUCCESS', stderr: '' });
    });

    const result = await createCodexTokenEnvWriter().writeTokenEnv(
      makeWindowsCodexTarget(),
      { envVar: 'LINKTERM_MCP_TOKEN', token: 'stable-token' },
    );

    expect(childProcessMock.execFile).toHaveBeenCalledWith(
      'setx.exe',
      ['LINKTERM_MCP_TOKEN', 'stable-token'],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
    expect(result).toMatchObject({
      changed: true,
      restartRequired: true,
    });
  });

  it('writes WSL token env using the target distro', async () => {
    const child = makeSpawnSuccess();
    childProcessMock.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });

    const result = await createCodexTokenEnvWriter().writeTokenEnv(
      makeWslCodexTarget(),
      { envVar: 'LINKTERM_MCP_TOKEN', token: 'stable-token' },
    );

    expect(childProcessMock.spawn).toHaveBeenCalledWith(
      'wsl.exe',
      ['-d', 'Ubuntu-24.04', '-e', '/bin/sh', '-lc', 'cat > /tmp/linkterm-codex-token-env.sh && /bin/sh /tmp/linkterm-codex-token-env.sh'],
      expect.objectContaining({ windowsHide: true }),
    );
    expect(child.stdinChunks.join('')).toContain('export LINKTERM_MCP_TOKEN=');
    expect(result.restartRequired).toBe(true);
  });
});
