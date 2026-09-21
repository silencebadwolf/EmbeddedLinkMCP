import { describe, expect, it } from 'vitest';
import { SshSession } from '@linkterm/runtime/transports/ssh/ssh-session';
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

describe('SshSession', () => {
  it('integrates with SessionBase: open → write audit → device data → close', async () => {
    const { factory, created } = createMockSshClientFactory();
    const session = new SshSession({
      id: 'sess_ssh',
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    const states: string[] = [];
    session.on('state', (s) => states.push(s));

    await session.open();
    expect(session.state).toBe('open');

    await session.write(utf8('ls\n'), { origin: 'human' });
    const ch = created[0]!.channel!;
    expect(ch.writes).toHaveLength(1);
    expect(ch.writes[0]!.toString('utf-8')).toBe('ls\n');

    ch.pushIncoming(Buffer.from('file.txt\n'));
    const events = session.read(0).events.filter((e) => e.type === 'data');
    expect(events).toHaveLength(2);
    expect(events[0]!.origin).toBe('human');
    expect(events[1]!.origin).toBe('device');

    await session.close();
    expect(states).toContain('opening');
    expect(states).toContain('open');
  });

  it('host key rejected → open() throws and state goes to errored', async () => {
    const { factory } = createMockSshClientFactory();
    const session = new SshSession({
      id: 'sess_reject',
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => false,
      clientFactory: factory,
    });
    await expect(session.open()).rejects.toThrow(/host key rejected/);
    expect(session.state).toBe('errored');
    const errors = session.read(0).events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
  });

  it('credentials from options never reach transcript even on auth failure', async () => {
    const { factory } = createMockSshClientFactory({ failOnConnect: new Error('auth failed') });
    const session = new SshSession({
      id: 'sess_auth',
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await expect(session.open()).rejects.toThrow(/auth failed/);
    const all = session.read(0).events;
    const serialized = JSON.stringify(all);
    expect(serialized).not.toContain('hunter2');
  });

  it('resize() forwards setWindow on the channel when open', async () => {
    const { factory, created } = createMockSshClientFactory();
    const session = new SshSession({
      id: 'sess_rsz',
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await session.resize(80, 24); // not open
    expect(created).toHaveLength(0);
    await session.open();
    await session.resize(120, 40);
    expect(created[0]!.channel!.windows).toEqual([
      { rows: 40, cols: 120, height: 0, width: 0 },
    ]);
  });

  it('channel close after open transitions session to closed', async () => {
    const { factory, created } = createMockSshClientFactory();
    const session = new SshSession({
      id: 'sess_chclose',
      config: baseConfig,
      credentials: passwordCreds,
      hostVerifier: () => true,
      clientFactory: factory,
    });
    await session.open();
    created[0]!.channel!.pushClose();
    expect(session.state).toBe('closed');
  });
});
