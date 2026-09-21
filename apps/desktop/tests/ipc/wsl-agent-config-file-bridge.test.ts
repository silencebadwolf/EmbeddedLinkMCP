/** WSL agent config file bridge tests. */

import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentIntegrationTarget } from '@linkterm/contracts/agent-integrations';

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => childProcessMock);

import { createWslAgentConfigFileBridge } from '../../src/main/ipc/wsl-agent-config-file-bridge.js';

function makeWslTarget(): AgentIntegrationTarget {
  return {
    id: 'codex:wsl:Ubuntu-24.04:jianyin',
    label: 'Codex (Ubuntu-24.04)',
    configPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin\\.codex\\config.toml',
    wslConfigPath: '/home/jianyin/.codex/config.toml',
    configKind: 'codex-config-toml',
    platform: 'wsl',
  };
}

describe('createWslAgentConfigFileBridge', () => {
  beforeEach(() => {
    childProcessMock.execFile.mockReset();
    childProcessMock.spawn.mockReset();
  });

  it('maps missing WSL config reads to ENOENT', async () => {
    const missing = Object.assign(
      new Error('cat: /home/jianyin/.codex/config.toml: No such file or directory'),
      { code: 1, stderr: 'No such file or directory' },
    );
    childProcessMock.execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(missing);
    });

    await expect(createWslAgentConfigFileBridge().readFile(makeWslTarget())).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('passes the WSL config path as a shell argument when reading', async () => {
    childProcessMock.execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(null, { stdout: 'model = "gpt-5"\n' });
    });

    await expect(createWslAgentConfigFileBridge().readFile(makeWslTarget())).resolves.toBe('model = "gpt-5"\n');

    expect(childProcessMock.execFile).toHaveBeenCalled();
    const [file, args, options] = childProcessMock.execFile.mock.calls[0] as [
      string,
      string[],
      { windowsHide?: boolean },
    ];
    expect(file).toBe('wsl.exe');
    expect(args).toEqual(
      [
        '-d',
        'Ubuntu-24.04',
        '-e',
        '/bin/sh',
        '-lc',
        expect.any(String),
        'sh',
        '/home/jianyin/.codex/config.toml',
      ],
    );
    expect(options).toEqual(expect.objectContaining({ windowsHide: true }));
  });

  it('passes the WSL config path as a shell argument when writing', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdin: Writable;
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    childProcessMock.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });

    await createWslAgentConfigFileBridge().writeFile(makeWslTarget(), 'model = "gpt-5"\n');

    expect(childProcessMock.spawn).toHaveBeenCalledWith(
      'wsl.exe',
      [
        '-d',
        'Ubuntu-24.04',
        '-e',
        '/bin/sh',
        '-lc',
        expect.any(String),
        'sh',
        '/home/jianyin/.codex/config.toml',
      ],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it('uses shell positional parameters so cat never redirects into an empty path', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter & { setEncoding: (encoding: string) => void };
      stdin: Writable;
    };
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    childProcessMock.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });

    await createWslAgentConfigFileBridge().writeFile(makeWslTarget(), 'model = "gpt-5"\n');

    const [, args] = childProcessMock.spawn.mock.calls[0] as [string, string[]];
    const scriptIndex = args.indexOf('-lc') + 1;
    expect(args[scriptIndex]).toBe('mkdir -p "$(dirname "$1")" && cat > "$1"');
    expect(args[scriptIndex + 1]).toBe('sh');
    expect(args[scriptIndex + 2]).toBe('/home/jianyin/.codex/config.toml');
  });
});
