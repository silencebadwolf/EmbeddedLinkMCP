import { describe, expect, it, vi } from 'vitest';
import { sendAndWait } from '@/core/terminal-rules/send-and-wait.js';
import type {
  SendAndWaitArgs,
  SessionManagerLike,
} from '@/core/terminal-rules/types.js';
import { WriteQueueFullError } from '@/core/write-queue/types.js';
import type { TranscriptEvent } from '@/core/transcript/types.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

interface MockState {
  cursor: number;
  writeArgs: Array<{ data: Uint8Array; opts: { origin: 'ai'; correlationId?: string } }>;
  markAiUnresponsive?: { sessionId: string; cursorBefore: number; cursorAfter: number };
  pendingResolve?: (
    outcome:
      | { kind: 'match'; event: TranscriptEvent }
      | { kind: 'timeout'; lastCursor: number }
      | { kind: 'closed'; lastCursor: number; state: 'closed' | 'errored' },
  ) => void;
  capturedPredicate?: (event: TranscriptEvent) => boolean;
  capturedOptions?: { timeoutMs?: number; replayHistorySince?: number };
  writeBehavior: 'ok' | 'queueFull' | 'throw-other';
  throwError?: Error;
}

function makeMock(): { manager: SessionManagerLike; state: MockState } {
  const state: MockState = {
    cursor: 0,
    writeArgs: [],
    writeBehavior: 'ok',
  };
  const manager: SessionManagerLike = {
    write: async (_id, data, opts) => {
      if (state.writeBehavior === 'queueFull') {
        throw new WriteQueueFullError(1024, 1024);
      }
      if (state.writeBehavior === 'throw-other') {
        throw state.throwError ?? new Error('boom');
      }
      state.writeArgs.push({ data: new Uint8Array(data), opts });
      state.cursor += 1; // simulate audit appending an event
    },
    waitFor: (_id, predicate, options) => {
      state.capturedPredicate = predicate;
      state.capturedOptions = options;
      return new Promise((resolve) => {
        state.pendingResolve = resolve;
      });
    },
    read: (_id, _cursor) => ({ cursor: state.cursor }),
    markAiUnresponsive: (sessionId, details) => {
      state.markAiUnresponsive = { sessionId, ...details };
    },
  };
  return { manager, state };
}

function makeDataEvent(s: string, sequence = 1): TranscriptEvent {
  return {
    type: 'data',
    origin: 'device',
    sequence,
    timestamp: Date.now(),
    data: utf8(s),
    evidenceKind: 'raw_bytes',
  };
}

describe('sendAndWait orchestrator', () => {
  const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('settled: returns device output even when the completion marker is not required', async () => {
    const { manager, state } = makeMock();
    const args: SendAndWaitArgs = {
      sessionId: 'sess_1',
      payload: utf8('ls'),
      rules: { completionMarkers: ['# '], lineEnding: '\r\n' },
      timeoutMs: 1000,
      settleMs: 123,
    };

    const promise = sendAndWait({ sessionManager: manager }, args);

    await flushMicrotasks();

    expect(state.capturedOptions?.timeoutMs).toBe(123);

    expect(state.writeArgs).toHaveLength(1);
    expect(decode(state.writeArgs[0]!.data)).toBe('ls\r\n');
    expect(state.writeArgs[0]!.opts.origin).toBe('ai');

    // Drive a device output event through the captured predicate manually
    // simulating SessionManager.waitFor's behaviour: it calls predicate for
    // each device event and resolves only at the settle boundary.
    const predicate = state.capturedPredicate!;
    // Echo first (simulating device echoing 'ls\r\n')
    expect(predicate(makeDataEvent('ls\r\n'))).toBe(false); // echo stripped
    // A marker is metadata only; it must not resolve the wait early.
    const replyEvent = makeDataEvent('result\r\n# ', 5);
    expect(predicate(replyEvent)).toBe(false);

    state.pendingResolve!({ kind: 'timeout', lastCursor: 6 });

    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.reason).toBe('settled');
    expect(result.matchedMarkerIndex).toBe(0);
    expect(result.hasDeviceOutput).toBe(true);
    expect(result.bytesWritten).toBe(utf8('ls\r\n').byteLength);
    expect(result.cursorBefore).toBe(0);
    expect(result.cursorAfter).toBeGreaterThanOrEqual(1);
    expect(decode(result.received)).toContain('# ');
  });

  it('settled with no output: returns an observation without latching the session', async () => {
    const { manager, state } = makeMock();
    const promise = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_2',
        payload: utf8('cmd'),
        rules: { completionMarkers: ['NEVER'] },
        timeoutMs: 50,
      },
    );

    await flushMicrotasks();

    // feed some partial output before timeout
    const predicate = state.capturedPredicate!;
    predicate(makeDataEvent('partial output here', 2));

    state.cursor = 7;
    state.pendingResolve!({ kind: 'timeout', lastCursor: 7 });

    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.reason).toBe('settled');
    expect(decode(result.received)).toContain('partial output here');
    expect(result.hasDeviceOutput).toBe(true);
    expect(result.bytesWritten).toBeGreaterThan(0);
    expect(state.markAiUnresponsive).toBeUndefined();
  });

  it('settled with no device bytes: returns empty observation and leaves AI writes unlatched', async () => {
    const { manager, state } = makeMock();
    const promise = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_2b',
        payload: utf8('cmd'),
        timeoutMs: 25,
      },
    );

    await flushMicrotasks();

    state.pendingResolve!({ kind: 'timeout', lastCursor: 1 });

    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.reason).toBe('settled');
    expect(result.hasDeviceOutput).toBe(false);
    expect(result.received).toHaveLength(0);
    expect(state.markAiUnresponsive).toBeUndefined();
  });

  it('keeps large observed output independent from the marker detector buffer', async () => {
    const { manager, state } = makeMock();
    const largeOutput = `${'x'.repeat(70 * 1024)}DONE`;
    const promise = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_large',
        payload: utf8('cmd'),
        rules: { completionMarkers: [/DONE/] },
        timeoutMs: 25,
      },
    );

    await flushMicrotasks();
    state.capturedPredicate!(makeDataEvent(largeOutput, 2));
    state.pendingResolve!({ kind: 'timeout', lastCursor: 2 });

    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.received.byteLength).toBe(largeOutput.length);
    expect(result.receivedTotalBytes).toBe(largeOutput.length);
    expect(result.receivedTruncated).toBe(false);
    expect(result.matchedMarkerIndex).toBe(0);
  });

  it('session-closed: returns sessionState in result', async () => {
    const { manager, state } = makeMock();
    const promise = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_3',
        payload: utf8('cmd'),
        rules: { completionMarkers: ['# '] },
      },
    );
    await flushMicrotasks();
    state.pendingResolve!({ kind: 'closed', lastCursor: 9, state: 'errored' });
    const result = await promise;
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.reason).toBe('session-closed');
    expect(result.sessionState).toBe('errored');
  });

  it('queue-full: returns reason and never invokes waitFor', async () => {
    const { manager, state } = makeMock();
    state.writeBehavior = 'queueFull';
    const result = await sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_4',
        payload: utf8('cmd'),
      },
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.reason).toBe('queue-full');
    expect(result.bytesWritten).toBe(0);
    // waitFor should not have been entered
    expect(state.capturedPredicate).toBeUndefined();
  });

  it('aborted: AbortSignal pre-aborted before write returns aborted result and never writes', async () => {
    const { manager, state } = makeMock();
    const ac = new AbortController();
    ac.abort();
    const result = await sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_5',
        payload: utf8('cmd'),
        signal: ac.signal,
      },
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.reason).toBe('aborted');
    // pre-abort 必须短路：不能进入 write，也不能进入 waitFor
    expect(state.writeArgs).toHaveLength(0);
    expect(result.bytesWritten).toBe(0);
    expect(state.capturedPredicate).toBeUndefined();
  });

  it('aborted: AbortSignal triggered while waiting resolves abort path', async () => {
    const { manager } = makeMock();
    const ac = new AbortController();
    const promise = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_6',
        payload: utf8('cmd'),
        signal: ac.signal,
        timeoutMs: 5000,
      },
    );
    await flushMicrotasks();
    ac.abort();
    const result = await promise;
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.reason).toBe('aborted');
  });

  it('replayHistorySince is forwarded equal to cursorBefore', async () => {
    const { manager, state } = makeMock();
    state.cursor = 42;
    const promise = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_7',
        payload: utf8('cmd'),
        rules: { completionMarkers: ['x'] },
      },
    );
    await flushMicrotasks();
    expect(state.capturedOptions?.replayHistorySince).toBe(42);

    state.pendingResolve!({ kind: 'timeout', lastCursor: 50 });
    await promise;
  });

  it('appendLineEnding=false: payload is written verbatim', async () => {
    const { manager, state } = makeMock();
    const promise = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_8',
        payload: utf8('raw'),
        appendLineEnding: false,
        rules: { completionMarkers: ['ok'] },
      },
    );
    await flushMicrotasks();
    expect(decode(state.writeArgs[0]!.data)).toBe('raw');
    state.pendingResolve!({ kind: 'timeout', lastCursor: 0 });
    await promise;
  });

  it('non-WriteQueue write errors propagate (e.g., SessionNotOpenError)', async () => {
    const { manager, state } = makeMock();
    state.writeBehavior = 'throw-other';
    state.throwError = new Error('not open');
    await expect(
      sendAndWait(
        { sessionManager: manager },
        {
          sessionId: 'sess_9',
          payload: utf8('cmd'),
        },
      ),
    ).rejects.toThrow('not open');
  });

  it('does not resolve early when completionMarkers is empty', async () => {
    const { manager, state } = makeMock();
    const promise = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_10',
        payload: utf8('cmd'),
        // no completionMarkers => still wait for the settle boundary
      },
    );
    await flushMicrotasks();

    const predicate = state.capturedPredicate!;
    // simulate echo first
    expect(predicate(makeDataEvent('cmd\r\n'))).toBe(false);
    const reply = makeDataEvent('hello', 4);
    expect(predicate(reply)).toBe(false);
    state.pendingResolve!({ kind: 'timeout', lastCursor: 2 });
    const result = await promise;
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.reason).toBe('settled');
    expect(result.hasDeviceOutput).toBe(true);
  });

  it('correlationId is forwarded to write options', async () => {
    const { manager, state } = makeMock();
    const promise = sendAndWait(
      { sessionManager: manager },
      {
        sessionId: 'sess_11',
        payload: utf8('cmd'),
        correlationId: 'corr-42',
      },
    );
    await flushMicrotasks();
    expect(state.writeArgs[0]!.opts.correlationId).toBe('corr-42');
    state.pendingResolve!({ kind: 'timeout', lastCursor: 0 });
    await promise;
  });
});

// keep vitest mock type happy
void vi;
