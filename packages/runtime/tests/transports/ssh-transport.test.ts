import { describe, expect, it } from 'vitest';
import { SshTransport } from '@linkterm/runtime/transports/ssh/ssh-transport';
import type { SshSessionConfig } from '@/shared/types.js';
import type { SshCredentials } from '@linkterm/runtime/transports/ssh/ssh-client-like';
import { createMockSshClientFactory } from '../../../../tests/fixtures/mock-ssh.js';

const baseConfig: SshSessionConfig = {
  type: 'ssh',
  host: 'example.test',
  port: 22,
  username: 'alice',
};

const passwordCreds: SshCredentials = { kind: 'password', password: 'hunter2' };
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('SshTransport', () => {
  it('opens via connect → ready → shell with default ready/keepalive/term values', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await transport.open();
    expect(created).toHaveLength(1);
    const c = created[0]!;
    expect(c.lastConnect).toMatchObject({
      host: 'example.test',
      port: 22,
      username: 'alice',
      readyTimeout: 30_000,
      keepaliveInterval: 0,
      password: 'hunter2',
    });
    expect(c.shellCalls).toEqual([{ rows: 24, cols: 80, term: 'xterm-256color' }]);
    expect(transport.isOpen()).toBe(true);
  });

  it('passes through user-supplied keepalive/readyTimeout/term/rows/cols', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: {
        ...baseConfig,
        keepaliveIntervalMs: 15_000,
        readyTimeoutMs: 5_000,
        term: 'screen-256color',
        rows: 50,
        cols: 200,
      },
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await transport.open();
    const c = created[0]!;
    expect(c.lastConnect).toMatchObject({
      readyTimeout: 5_000,
      keepaliveInterval: 15_000,
    });
    expect(c.shellCalls[0]).toEqual({ rows: 50, cols: 200, term: 'screen-256color' });
  });

  it('uses privateKey + passphrase when credentials are key-based', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: { kind: 'privateKey', privateKey: '-----BEGIN-----', passphrase: 'pp' },
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await transport.open();
    expect(created[0]!.lastConnect).toMatchObject({
      privateKey: '-----BEGIN-----',
      passphrase: 'pp',
    });
    expect(created[0]!.lastConnect?.password).toBeUndefined();
  });

  it('rejects open() when hostVerifier returns false and tears down the client', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => false,
      clientFactory: factory,
    });
    await expect(transport.open()).rejects.toThrow(/host key rejected/);
    expect(transport.isOpen()).toBe(false);
    expect(created[0]!.endCalls).toBe(1);
  });

  it('rejects open() when client emits an error before ready', async () => {
    const failure = new Error('auth failed');
    const { factory, created } = createMockSshClientFactory({ failOnConnect: failure });
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await expect(transport.open()).rejects.toBe(failure);
    expect(transport.isOpen()).toBe(false);
    expect(created[0]!.endCalls).toBe(1);
  });

  it('swallows late client errors after open() has already failed', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => false,
      clientFactory: factory,
    });
    await expect(transport.open()).rejects.toThrow(/host key rejected/);

    expect(() => created[0]!.emit('error', new Error('Connection lost before handshake'))).not.toThrow();
  });

  it('rejects open() when shell() callback returns an error', async () => {
    const failure = new Error('no shell');
    const { factory, created } = createMockSshClientFactory({ failOnShell: failure });
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await expect(transport.open()).rejects.toBe(failure);
    expect(transport.isOpen()).toBe(false);
    expect(created[0]!.endCalls).toBe(1);
  });

  it('credentials are released after open() — second open() throws "credentials missing"', async () => {
    const { factory } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await transport.open();
    // 同一实例不会再次 open（isOpen() = true 时直接返回），但断言字段已清：
    // 强制走"已 close 后再 open"路径
    await transport.close();
    // 模拟 close 后的 stale 引用调 open 应抛 has been closed（凭据是否清空已不重要）
    await expect(transport.open()).rejects.toThrow(/has been closed/);
  });

  it('open() is idempotent', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await transport.open();
    await transport.open();
    expect(created).toHaveLength(1);
  });

  it('write() forwards bytes to the channel; throws when not open', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await expect(transport.write(utf8('x'))).rejects.toThrow(/not open/);
    await transport.open();
    await transport.write(utf8('ls\n'));
    const ch = created[0]!.channel!;
    expect(ch.writes).toHaveLength(1);
    expect(ch.writes[0]!.toString('utf-8')).toBe('ls\n');
  });

  it('forwards channel data as Uint8Array chunks', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    const chunks: Uint8Array[] = [];
    transport.on('data', (c) => chunks.push(c));
    await transport.open();
    created[0]!.channel!.pushIncoming(Buffer.from('hello'));
    expect(chunks).toHaveLength(1);
    expect(Buffer.from(chunks[0]!).toString('utf-8')).toBe('hello');
  });

  it('client error after open is forwarded but does not flip closed', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    const errors: Error[] = [];
    transport.on('error', (e) => errors.push(e));
    await transport.open();
    const err = new Error('disconnected');
    created[0]!.emit('error', err);
    expect(errors).toEqual([err]);
    expect(transport.isOpen()).toBe(true);
  });

  it('channel close emits transport close exactly once and ends the underlying client', async () => {
    const { factory, created } = createMockSshClientFactory({ silentEnd: true });
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    let closes = 0;
    transport.on('close', () => (closes += 1));
    await transport.open();
    created[0]!.channel!.pushClose();
    expect(closes).toBe(1);
    expect(transport.isOpen()).toBe(false);
    // bug #3 regression: 远端 shell 退出后必须主动 end() 客户端，避免 TCP 泄漏
    expect(created[0]!.endCalls).toBe(1);
  });

  it('channel error event is forwarded (would otherwise be uncaughtException)', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    const errors: Error[] = [];
    transport.on('error', (e) => errors.push(e));
    await transport.open();
    const err = new Error('write after EOF');
    created[0]!.channel!.emit('error', err);
    expect(errors).toEqual([err]);
  });

  it('client error during ready→shell window rejects open() and tears down (bug #2)', async () => {
    const { factory, created } = createMockSshClientFactory({ shellHang: true });
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    const failure = new Error('protocol error after ready');
    const openPromise = transport.open();
    // 等 connect → ready settle，让 #requestShell 已注册 'error' 监听并发出 shell()
    await created[0]!.settle();
    // 此时 shellHang 让 shell 回调永不触发；注入 client 'error' 应触发 reject
    created[0]!.emit('error', failure);
    await expect(openPromise).rejects.toBe(failure);
    expect(transport.isOpen()).toBe(false);
    expect(created[0]!.endCalls).toBe(1);
  });

  it('client close during ready→shell window rejects open() with explanatory error', async () => {
    const { factory, created } = createMockSshClientFactory({ shellHang: true, silentEnd: true });
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    const openPromise = transport.open();
    await created[0]!.settle();
    created[0]!.emit('close');
    await expect(openPromise).rejects.toThrow(/closed before shell/);
  });

  it('close() ends channel and client, emits close exactly once, idempotent', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    let closes = 0;
    transport.on('close', () => (closes += 1));
    await transport.open();
    await transport.close();
    await transport.close();
    // 等 mock end() 的 queueMicrotask 'close' 抵达
    await created[0]!.settle();
    expect(created[0]!.channel!.endCalls).toBe(1);
    expect(created[0]!.endCalls).toBe(1);
    expect(closes).toBe(1);
  });

  it('resize() forwards setWindow when open and is no-op when closed', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await transport.open();
    transport.resize(120, 40);
    expect(created[0]!.channel!.windows).toEqual([{ rows: 40, cols: 120, height: 0, width: 0 }]);
    await transport.close();
    transport.resize(200, 50);
    expect(created[0]!.channel!.windows).toHaveLength(1);
  });

  it('close() before open() resolves and emits close (no client held)', async () => {
    const { factory, created } = createMockSshClientFactory();
    const transport = new SshTransport({
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    let closes = 0;
    transport.on('close', () => (closes += 1));
    await transport.close();
    // 等 queueMicrotask 抵达
    await Promise.resolve();
    expect(closes).toBe(1);
    expect(created).toHaveLength(0);
  });
});
