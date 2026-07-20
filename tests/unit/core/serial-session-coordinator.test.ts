import { describe, expect, it, vi } from 'vitest';
import type { SerialSessionConfig, SessionState } from '@/shared/types.js';
import {
  SerialSessionConflictError,
  SerialSessionCoordinator,
} from '@/core/session/serial-session-coordinator.js';

interface SessionStateView {
  state: SessionState;
}

function config(overrides: Partial<SerialSessionConfig> = {}): SerialSessionConfig {
  return {
    type: 'serial',
    port: 'COM7',
    baudRate: 115_200,
    mode: 'terminal',
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness(): {
  coordinator: SerialSessionCoordinator;
  states: Map<string, SessionStateView>;
} {
  const states = new Map<string, SessionStateView>();
  const coordinator = new SerialSessionCoordinator({ get: (id) => states.get(id) });
  return { coordinator, states };
}

describe('SerialSessionCoordinator', () => {
  it('reuses an active session for the same normalized complete configuration', async () => {
    const { coordinator, states } = harness();
    const open = vi.fn(async () => {
      states.set('sess_1', { state: 'open' });
      return { sessionId: 'sess_1', state: 'open' as const };
    });

    const first = await coordinator.openOrReuse(config({ port: ' COM7 ' }), open);
    const second = await coordinator.openOrReuse(
      config({
        port: 'com7',
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        rtscts: false,
        xon: false,
        xoff: false,
      }),
      open,
    );

    expect(first).toEqual({ sessionId: 'sess_1', state: 'open', reused: false });
    expect(second).toEqual({ sessionId: 'sess_1', state: 'open', reused: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['baudRate', { baudRate: 9_600 }],
    ['mode', { mode: 'normal' as const }],
    ['dataBits', { dataBits: 7 as const }],
    ['stopBits', { stopBits: 2 as const }],
    ['parity', { parity: 'even' as const }],
    ['rtscts', { rtscts: true }],
    ['xon', { xon: true }],
    ['xoff', { xoff: true }],
  ])('rejects the same physical port with different %s without invoking another opener', async (_field, override) => {
    const { coordinator, states } = harness();
    states.set('sess_existing', { state: 'open' });
    await coordinator.openOrReuse(config(), async () => ({
      sessionId: 'sess_existing',
      state: 'open',
    }));
    const conflictingOpen = vi.fn();

    await expect(
      coordinator.openOrReuse(config(override), conflictingOpen),
    ).rejects.toMatchObject({
      name: 'SerialSessionConflictError',
      code: 'SERIAL_SESSION_CONFLICT',
      port: 'COM7',
    } satisfies Partial<SerialSessionConflictError>);
    expect(conflictingOpen).not.toHaveBeenCalled();
  });

  it.each(['closed', 'errored'] as const)('does not reuse a %s session', async (terminalState) => {
    const { coordinator, states } = harness();
    states.set('sess_old', { state: 'open' });
    await coordinator.openOrReuse(config(), async () => ({ sessionId: 'sess_old', state: 'open' }));
    states.set('sess_old', { state: terminalState });
    const open = vi.fn(async () => {
      states.set('sess_new', { state: 'open' });
      return { sessionId: 'sess_new', state: 'open' as const };
    });

    await expect(coordinator.openOrReuse(config(), open)).resolves.toEqual({
      sessionId: 'sess_new',
      state: 'open',
      reused: false,
    });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('joins equivalent overlapping requests and waits for the owner open promise', async () => {
    const { coordinator, states } = harness();
    const gate = deferred<{ sessionId: string; state: 'open' }>();
    const open = vi.fn(() => gate.promise);

    const owner = coordinator.openOrReuse(config(), open);
    const joiner = coordinator.openOrReuse(config({ port: 'com7' }), open);
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);

    states.set('sess_shared', { state: 'open' });
    gate.resolve({ sessionId: 'sess_shared', state: 'open' });

    await expect(owner).resolves.toEqual({ sessionId: 'sess_shared', state: 'open', reused: false });
    await expect(joiner).resolves.toEqual({ sessionId: 'sess_shared', state: 'open', reused: true });
  });

  it('rejects a conflicting overlapping request before a second opener runs', async () => {
    const { coordinator, states } = harness();
    const gate = deferred<{ sessionId: string; state: 'open' }>();
    const ownerOpen = vi.fn(() => gate.promise);
    const conflictingOpen = vi.fn();

    const owner = coordinator.openOrReuse(config(), ownerOpen);
    await expect(
      coordinator.openOrReuse(config({ baudRate: 9_600 }), conflictingOpen),
    ).rejects.toBeInstanceOf(SerialSessionConflictError);
    expect(conflictingOpen).not.toHaveBeenCalled();

    states.set('sess_owner', { state: 'open' });
    gate.resolve({ sessionId: 'sess_owner', state: 'open' });
    await owner;
  });

  it('clears a failed in-flight reservation so a later request can retry', async () => {
    const { coordinator, states } = harness();
    const failure = new Error('port open failed');
    await expect(coordinator.openOrReuse(config(), async () => Promise.reject(failure))).rejects.toBe(
      failure,
    );

    states.set('sess_retry', { state: 'open' });
    await expect(
      coordinator.openOrReuse(config(), async () => ({ sessionId: 'sess_retry', state: 'open' })),
    ).resolves.toEqual({ sessionId: 'sess_retry', state: 'open', reused: false });
  });

  it('allows different physical ports to open concurrently', async () => {
    const { coordinator, states } = harness();
    const firstGate = deferred<{ sessionId: string; state: 'open' }>();
    const secondGate = deferred<{ sessionId: string; state: 'open' }>();
    const firstOpen = vi.fn(() => firstGate.promise);
    const secondOpen = vi.fn(() => secondGate.promise);

    const first = coordinator.openOrReuse(config({ port: 'COM7' }), firstOpen);
    const second = coordinator.openOrReuse(config({ port: 'COM8' }), secondOpen);
    await Promise.resolve();
    expect(firstOpen).toHaveBeenCalledTimes(1);
    expect(secondOpen).toHaveBeenCalledTimes(1);

    states.set('sess_7', { state: 'open' });
    states.set('sess_8', { state: 'open' });
    firstGate.resolve({ sessionId: 'sess_7', state: 'open' });
    secondGate.resolve({ sessionId: 'sess_8', state: 'open' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { sessionId: 'sess_7', state: 'open', reused: false },
      { sessionId: 'sess_8', state: 'open', reused: false },
    ]);
  });
});
