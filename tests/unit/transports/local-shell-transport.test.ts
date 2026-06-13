import { describe, expect, it } from 'vitest';
import { LocalShellTransport } from '@/transports/local-shell/local-shell-transport.js';
import type { LocalShellSessionConfig } from '@/shared/types.js';
import { createMockPtyFactory } from '../../fixtures/mock-pty.js';

const baseConfig: LocalShellSessionConfig = {
  type: 'local-shell',
  shell: '/bin/echo-shell',
  args: ['-l'],
  cwd: '/tmp',
  env: { FOO: 'bar' },
  cols: 100,
  rows: 30,
  term: 'xterm-test',
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('LocalShellTransport', () => {
  it('spawns pty with the resolved shell/args/cwd/env/term/dimensions', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    await transport.open();
    expect(created).toHaveLength(1);
    expect(created[0]!.options).toMatchObject({
      file: '/bin/echo-shell',
      args: ['-l'],
      cwd: '/tmp',
      env: { FOO: 'bar' },
      cols: 100,
      rows: 30,
      name: 'xterm-test',
    });
    expect(transport.isOpen()).toBe(true);
  });

  it('falls back to platform defaults when shell/cols/rows/term are omitted', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({
      config: { type: 'local-shell' },
      ptyFactory: factory,
    });
    await transport.open();
    const opts = created[0]!.options;
    // shell 在不同平台分别为 SHELL ?? /bin/bash 或 COMSPEC ?? cmd.exe；任一非空字符串即可
    expect(typeof opts.file).toBe('string');
    expect(opts.file.length).toBeGreaterThan(0);
    expect(opts.cols).toBe(80);
    expect(opts.rows).toBe(24);
    expect(opts.name).toBe('xterm-256color');
    expect(opts.args).toEqual([]);
  });

  it('inherits process.env when env is not provided, and replaces fully when it is', async () => {
    const { factory: f1, created: c1 } = createMockPtyFactory();
    const inherit = new LocalShellTransport({
      config: { type: 'local-shell' },
      ptyFactory: f1,
    });
    await inherit.open();
    // process.env 必有 PATH（测试环境），继承时应可见
    expect(typeof c1[0]!.options.env.PATH).toBe('string');

    const { factory: f2, created: c2 } = createMockPtyFactory();
    const replace = new LocalShellTransport({
      config: { type: 'local-shell', env: { ONLY: '1' } },
      ptyFactory: f2,
    });
    await replace.open();
    expect(c2[0]!.options.env).toEqual({ ONLY: '1' });
    expect(c2[0]!.options.env.PATH).toBeUndefined();
  });

  it('open() rejects with the underlying error and does not retain the half-spawned pty', async () => {
    const failure = new Error('ENOENT shell not found');
    const { factory } = createMockPtyFactory({ failOnSpawn: failure });
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    await expect(transport.open()).rejects.toBe(failure);
    expect(transport.isOpen()).toBe(false);
  });

  it('open() is idempotent', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    await transport.open();
    await transport.open();
    expect(created).toHaveLength(1);
  });

  it('write() decodes utf8 bytes and forwards to pty.write', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    await transport.open();
    await transport.write(utf8('echo hi\n'));
    expect(created[0]!.writes).toEqual(['echo hi\n']);
  });

  it('write() throws when transport is not open', async () => {
    const { factory } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    await expect(transport.write(utf8('x'))).rejects.toThrow(/not open/);
  });

  it('forwards pty data as Uint8Array chunks (utf8 round-trip)', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    const chunks: Uint8Array[] = [];
    transport.on('data', (c) => chunks.push(c));
    await transport.open();
    created[0]!.pushIncoming('hello');
    expect(chunks).toHaveLength(1);
    expect(new TextDecoder().decode(chunks[0]!)).toBe('hello');
  });

  it('resize() forwards to pty when open and is a no-op when closed', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    await transport.open();
    transport.resize(120, 40);
    expect(created[0]!.resizes).toEqual([{ cols: 120, rows: 40 }]);
    await transport.close();
    transport.resize(200, 50); // 静默
    expect(created[0]!.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('pty exit emits exit event then close exactly once', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    let closes = 0;
    const exits: { exitCode: number; signal?: number }[] = [];
    transport.on('close', () => (closes += 1));
    transport.on('exit', (e: { exitCode: number; signal?: number }) => exits.push(e));
    await transport.open();
    created[0]!.triggerExit(0);
    expect(exits).toEqual([{ exitCode: 0 }]);
    expect(closes).toBe(1);
    expect(transport.isOpen()).toBe(false);
  });

  it('non-zero exit (with signal) is forwarded but does not raise an error event', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    const errors: Error[] = [];
    const exits: { exitCode: number; signal?: number }[] = [];
    transport.on('error', (e) => errors.push(e));
    transport.on('exit', (e: { exitCode: number; signal?: number }) => exits.push(e));
    await transport.open();
    created[0]!.triggerExit(137, 9);
    expect(exits).toEqual([{ exitCode: 137, signal: 9 }]);
    expect(errors).toHaveLength(0);
  });

  it('close() kills the underlying pty, emits close exactly once, idempotent', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    let closes = 0;
    transport.on('close', () => (closes += 1));
    await transport.open();
    await transport.close();
    await transport.close();
    // 等 close() 内部的 queueMicrotask emit 抵达
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0]!.killCalls).toBe(1);
    expect(closes).toBe(1);
  });

  it('close() detaches data listener — bytes after close are dropped', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    const chunks: Uint8Array[] = [];
    transport.on('data', (c) => chunks.push(c));
    await transport.open();
    created[0]!.pushIncoming('before');
    await transport.close();
    // 子进程收到 SIGHUP 到真正退出之间仍可能输出；transport 应已 dispose 监听
    created[0]!.pushIncoming('after');
    expect(chunks).toHaveLength(1);
    expect(new TextDecoder().decode(chunks[0]!)).toBe('before');
  });

  it('close() before open() resolves and emits close (no pty held)', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    let closes = 0;
    transport.on('close', () => (closes += 1));
    await transport.close();
    await Promise.resolve();
    expect(closes).toBe(1);
    expect(created).toHaveLength(0);
  });

  it('does not allow re-opening after close', async () => {
    const { factory, created } = createMockPtyFactory();
    const transport = new LocalShellTransport({ config: baseConfig, ptyFactory: factory });
    await transport.open();
    created[0]!.triggerExit(0); // 让 transport 进入 closed
    await expect(transport.open()).rejects.toThrow(/has been closed/);
  });
});
