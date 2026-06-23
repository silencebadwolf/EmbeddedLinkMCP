import { describe, expect, it, vi, afterEach } from 'vitest';
import type { IJLinkBackend, RttReadResult } from '@/jlink/types.js';
import { RttLogSession } from '@/core/session/rtt-log-session.js';
import { openRttLogSession } from '@/core/session/rtt-log-session-open.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SessionNotWritableError } from '@/core/session/types.js';

class ScriptedRttBackend {
  readonly readCalls: Array<{ probeId: string; channelIndex: number; maxBytes: number }> = [];
  readonly chunks: Array<Buffer | Error>;

  constructor(chunks: Array<Buffer | Error>) {
    this.chunks = [...chunks];
  }

  async rttRead(
    probeId: string,
    channelIndex: number,
    maxBytes: number,
  ): Promise<RttReadResult> {
    this.readCalls.push({ probeId, channelIndex, maxBytes });
    const next = this.chunks.shift() ?? Buffer.alloc(0);
    if (next instanceof Error) throw next;
    return {
      channelIndex,
      data: next.subarray(0, maxBytes),
      truncated: next.byteLength > maxBytes,
    };
  }
}

class DeferredRttBackend {
  readonly readCalls: Array<{ probeId: string; channelIndex: number; maxBytes: number }> = [];
  #resolve:
    | ((result: RttReadResult) => void)
    | undefined;
  #reject:
    | ((err: Error) => void)
    | undefined;

  async rttRead(
    probeId: string,
    channelIndex: number,
    maxBytes: number,
  ): Promise<RttReadResult> {
    this.readCalls.push({ probeId, channelIndex, maxBytes });
    return new Promise<RttReadResult>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  resolveWith(data: Buffer): void {
    this.#resolve?.({
      channelIndex: this.readCalls.at(-1)?.channelIndex ?? 0,
      data,
      truncated: false,
    });
  }

  rejectWith(error: Error): void {
    this.#reject?.(error);
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('RttLogSession', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls RTT bytes into device transcript events and stops after close', async () => {
    vi.useFakeTimers();
    const backend = new ScriptedRttBackend([
      Buffer.from('abc'),
      Buffer.alloc(0),
      Buffer.from('def'),
      Buffer.from('ignored'),
    ]);
    const session = new RttLogSession({
      id: 'sess_rtt',
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
    });

    await session.open();
    await flushMicrotasks();

    expect(session.state).toBe('open');
    expect(readText(session)).toContain('abc');

    await vi.advanceTimersByTimeAsync(50);
    await flushMicrotasks();
    expect(readDataEvents(session).map((event) => Buffer.from(event.data ?? []).toString('utf8'))).toEqual(['abc']);

    await vi.advanceTimersByTimeAsync(50);
    await flushMicrotasks();
    expect(readText(session)).toContain('abcdef');

    await session.close();
    const callsAfterClose = backend.readCalls.length;
    await vi.advanceTimersByTimeAsync(200);
    await flushMicrotasks();

    expect(session.state).toBe('closed');
    expect(backend.readCalls).toHaveLength(callsAfterClose);
  });

  it('records one fatal error and enters errored state when polling fails', async () => {
    vi.useFakeTimers();
    const backend = new ScriptedRttBackend([
      Buffer.from('ok'),
      new Error('rtt socket lost'),
      Buffer.from('ignored'),
    ]);
    const session = new RttLogSession({
      id: 'sess_rtt',
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
    });

    await session.open();
    await vi.advanceTimersByTimeAsync(50);
    await flushMicrotasks();

    const errors = session.read(0).events.filter((event) => event.type === 'error');
    expect(session.state).toBe('errored');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.meta).toMatchObject({
      source: 'rtt',
      fatal: true,
      message: 'rtt socket lost',
    });

    const callsAfterError = backend.readCalls.length;
    await vi.advanceTimersByTimeAsync(200);
    await flushMicrotasks();

    expect(backend.readCalls).toHaveLength(callsAfterError);
  });

  it('rejects writes as a non-writable read-only session', async () => {
    const backend = new ScriptedRttBackend([Buffer.alloc(0)]);
    const session = new RttLogSession({
      id: 'sess_rtt',
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
    });

    await session.open();

    await expect(session.write(Buffer.from('x'), { origin: 'human' })).rejects.toBeInstanceOf(
      SessionNotWritableError,
    );
  });

  it('does not append RTT data after close wins a pending poll', async () => {
    vi.useFakeTimers();
    const backend = new DeferredRttBackend();
    const session = new RttLogSession({
      id: 'sess_rtt',
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
    });

    const opening = session.open();
    await flushMicrotasks();

    expect(backend.readCalls).toHaveLength(1);
    await session.close();
    backend.resolveWith(Buffer.from('late'));
    await opening;
    await flushMicrotasks();

    expect(session.state).toBe('closed');
    expect(readDataEvents(session)).toEqual([]);
  });

  it('does not turn closed RTT log sessions into errored after a pending poll rejects', async () => {
    vi.useFakeTimers();
    const backend = new DeferredRttBackend();
    const session = new RttLogSession({
      id: 'sess_rtt',
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
    });

    const opening = session.open();
    await flushMicrotasks();

    await session.close();
    backend.rejectWith(new Error('late socket error'));
    await opening;
    await flushMicrotasks();

    expect(session.state).toBe('closed');
    expect(session.read(0).events.filter((event) => event.type === 'error')).toEqual([]);
  });

  it('reuses an existing active RTT log session for the same probe and channel', async () => {
    vi.useFakeTimers();
    const manager = new SessionManager();
    const backend = new ScriptedRttBackend([Buffer.alloc(0), Buffer.alloc(0)]);

    const first = await openRttLogSession({
      sessionManager: manager,
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
      label: 'RTT channel 0',
    });
    const second = await openRttLogSession({
      sessionManager: manager,
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
      label: 'RTT channel 0 duplicate',
    });

    expect(second.session.id).toBe(first.session.id);
    expect(second.reused).toBe(true);
    expect(manager.list()).toEqual([first.session.id]);
  });

  it('destroys the transient session when the initial RTT read fails during open', async () => {
    vi.useFakeTimers();
    const manager = new SessionManager();
    const backend = new ScriptedRttBackend([new Error('RTT is not connected')]);

    await expect(openRttLogSession({
      sessionManager: manager,
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
      label: 'RTT channel 0',
    })).rejects.toThrow('RTT is not connected');

    expect(manager.list()).toEqual([]);
  });

  it('opens independent RTT log sessions for different channels on the same probe', async () => {
    vi.useFakeTimers();
    const manager = new SessionManager();
    const backend = new ScriptedRttBackend([Buffer.alloc(0), Buffer.alloc(0)]);

    const first = await openRttLogSession({
      sessionManager: manager,
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
      label: 'RTT channel 0',
    });
    const second = await openRttLogSession({
      sessionManager: manager,
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 1,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
      label: 'RTT channel 1',
    });

    expect(second.session.id).not.toBe(first.session.id);
    expect(second.reused).toBe(false);
    expect(manager.listSummaries()).toEqual([
      expect.objectContaining({ rttLog: { probeId: 'probe-1', channelIndex: 0 } }),
      expect.objectContaining({ rttLog: { probeId: 'probe-1', channelIndex: 1 } }),
    ]);
    expect(backend.readCalls.map((call) => call.channelIndex)).toEqual([0, 1]);
  });
});

function readDataEvents(session: RttLogSession): ReturnType<RttLogSession['read']>['events'] {
  return session.read(0).events.filter((event) => event.type === 'data');
}

function readText(session: RttLogSession): string {
  return readDataEvents(session)
    .map((event) => Buffer.from(event.data ?? []).toString('utf8'))
    .join('');
}
