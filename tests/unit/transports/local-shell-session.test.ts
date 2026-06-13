import { describe, expect, it } from 'vitest';
import { LocalShellSession } from '@/transports/local-shell/local-shell-session.js';
import type { LocalShellSessionConfig } from '@/shared/types.js';
import { createMockPtyFactory } from '../../fixtures/mock-pty.js';

const baseConfig: LocalShellSessionConfig = {
  type: 'local-shell',
  shell: '/bin/fake',
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('LocalShellSession', () => {
  it('integrates with SessionBase: open → write audit → device data → close', async () => {
    const { factory, created } = createMockPtyFactory();
    const session = new LocalShellSession({
      id: 'sess_int',
      config: baseConfig,
      ptyFactory: factory,
    });
    const states: string[] = [];
    session.on('state', (s) => states.push(s));

    await session.open();
    expect(session.state).toBe('open');
    expect(created).toHaveLength(1);

    await session.write(utf8('echo hi\n'), { origin: 'human' });
    const pty = created[0]!;
    expect(pty.writes).toEqual(['echo hi\n']);

    pty.pushIncoming('hi\n');
    const dataEvents = session.read(0).events.filter((e) => e.type === 'data');
    expect(dataEvents).toHaveLength(2);
    expect(dataEvents[0]!.origin).toBe('human');
    expect(dataEvents[1]!.origin).toBe('device');

    await session.close();
    expect(states).toContain('opening');
    expect(states).toContain('open');
  });

  it('records pty exit as a system state event with kind=pty-exit and exitCode', async () => {
    const { factory, created } = createMockPtyFactory();
    const session = new LocalShellSession({
      id: 'sess_exit',
      config: baseConfig,
      ptyFactory: factory,
    });
    await session.open();
    created[0]!.triggerExit(137, 9);
    // 事件链路是同步（mock onExit 同步派发），但 SessionBase 在拿到 close 后通过 #setState
    // 推到 'closed' 也是同步；保险起见多 settle 一次微任务。
    await Promise.resolve();
    const events = session.read(0).events;
    const ptyExit = events.find(
      (e) => e.type === 'state' && (e.meta as Record<string, unknown> | undefined)?.kind === 'pty-exit',
    );
    expect(ptyExit).toBeDefined();
    expect(ptyExit!.meta).toMatchObject({ kind: 'pty-exit', exitCode: 137, signal: 9 });
    // 非 0 退出**不**升级为 errored（按 F5 决策）
    expect(session.state).toBe('closed');
  });

  it('zero exit code does not flip state to errored either', async () => {
    const { factory, created } = createMockPtyFactory();
    const session = new LocalShellSession({
      id: 'sess_ok',
      config: baseConfig,
      ptyFactory: factory,
    });
    await session.open();
    created[0]!.triggerExit(0);
    await Promise.resolve();
    expect(session.state).toBe('closed');
  });

  it('resize() forwards to transport when open and is silent when not open', async () => {
    const { factory, created } = createMockPtyFactory();
    const session = new LocalShellSession({
      id: 'sess_rsz',
      config: baseConfig,
      ptyFactory: factory,
    });
    await session.resize(80, 24); // not open yet
    expect(created).toHaveLength(0); // resize before open MUST NOT spawn
    await session.open();
    await session.resize(120, 40);
    expect(created[0]!.resizes).toEqual([{ cols: 120, rows: 40 }]);
    await session.close();
    await session.resize(200, 50); // closed, no-op
    expect(created[0]!.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });
});
