import { describe, expect, it, vi, afterEach } from 'vitest';
import type { IJLinkBackend, RttReadResult } from '@linkterm/runtime/jlink/types';
import { RttLogSession } from '@linkterm/runtime/core/session/rtt-log-session';
import { openRttLogSession } from '@linkterm/runtime/core/session/rtt-log-session-open';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { JLinkInvalidStateError } from '@linkterm/runtime/jlink/errors';

class ScriptedRttBackend {
  readonly readCalls: Array<{ probeId: string; channelIndex: number; maxBytes: number }> = [];
  readonly writeCalls: Array<{ probeId: string; channelIndex: number; data: Buffer }> = [];
  readonly chunks: Array<Buffer | Error>;
  writeError: Error | undefined;

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

  async rttWrite(probeId: string, channelIndex: number, data: Buffer): Promise<void> {
    this.writeCalls.push({ probeId, channelIndex, data: Buffer.from(data) });
    if (this.writeError !== undefined) throw this.writeError;
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

  it('writes terminal input to the RTT down-channel and records human audit bytes', async () => {
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
    await session.write(Buffer.from('help\r'), { origin: 'human' });
    await flushMicrotasks();

    expect(backend.writeCalls).toEqual([
      { probeId: 'probe-1', channelIndex: 0, data: Buffer.from('help\r') },
    ]);
    expect(
      session.read(0).events
        .filter((event) => event.type === 'data' && event.origin === 'human')
        .map((event) => Buffer.from(event.data ?? []).toString('utf8')),
    ).toEqual(['help\r']);
  });

  it('keeps the attempted human input visible and records a writer error when RTT write is rejected', async () => {
    const backend = new ScriptedRttBackend([Buffer.alloc(0)]);
    backend.writeError = new JLinkInvalidStateError(
      'RTT down-channel 0 is not available; connected RTT channels are read-only',
      {
        expected: 'RTT down channel 0',
        actual: 'up channel 0 only',
      },
    );
    const session = new RttLogSession({
      id: 'sess_rtt',
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 16,
    });

    await session.open();
    await expect(
      session.write(Buffer.from('help\r\n'), { origin: 'human' }),
    ).rejects.toThrow(/down-channel 0 is not available/);
    await flushMicrotasks();

    expect(
      session.read(0).events
        .filter((event) => event.type === 'data' && event.origin === 'human')
        .map((event) => Buffer.from(event.data ?? []).toString('utf8')),
    ).toEqual(['help\r\n']);
    expect(
      session.read(0).events
        .filter((event) => event.type === 'error')
        .map((event) => event.meta),
    ).toContainEqual(expect.objectContaining({
      source: 'writer',
      fatal: false,
      message: expect.stringContaining('down-channel 0 is not available'),
    }));
  });

  it('records visible system guidance when the RTT channel opens but has no device bytes yet', async () => {
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

    const systemText = readSystemText(session);
    expect(systemText).toContain('RTT log connected');
    expect(systemText).toContain('channel 0');
    expect(systemText).toContain('waiting for target output');
    expect(systemText).toContain('do not repeat flash solely because RTT is silent');
  });

  it('records one App-visible diagnostic when only the SEGGER RTT transport banner appears', async () => {
    vi.useFakeTimers();
    const banner =
      'SEGGER J-Link V7.92 - Real time terminal output\r\n' +
      'SEGGER J-Link V11.0, SN=123456789\r\n' +
      'Process: JLinkGDBServerCL.exe\r\n';
    const backend = new ScriptedRttBackend([
      Buffer.from(banner),
      Buffer.from(banner),
      Buffer.alloc(0),
    ]);
    const session = new RttLogSession({
      id: 'sess_rtt',
      jlinkBackend: backend as unknown as IJLinkBackend,
      probeId: 'probe-1',
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 256,
    });

    await session.open();
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();

    const bannerHints = session.read(0).events
      .filter((event) => event.type === 'data' && event.origin === 'system')
      .map((event) => Buffer.from(event.data ?? []).toString('utf8'))
      .filter((text) => text.includes('SEGGER RTT transport banner'));

    expect(bannerHints).toHaveLength(1);
    expect(bannerHints[0]).toContain('not firmware log output');
    expect(bannerHints[0]).toContain('do not repeat flash solely because RTT is silent');
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
  return session.read(0).events.filter((event) => event.type === 'data' && event.origin === 'device');
}

function readText(session: RttLogSession): string {
  return readDataEvents(session)
    .map((event) => Buffer.from(event.data ?? []).toString('utf8'))
    .join('');
}

function readSystemText(session: RttLogSession): string {
  return session.read(0).events
    .filter((event) => event.type === 'data' && event.origin === 'system')
    .map((event) => Buffer.from(event.data ?? []).toString('utf8'))
    .join('');
}
