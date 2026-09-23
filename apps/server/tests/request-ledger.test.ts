import { expect, it, vi } from 'vitest';
import { CLIENT_CHANNELS } from '@linkterm/contracts/client-protocol';
import { RequestLedger } from '../src/request-ledger.js';

it('drains an accepted request, rejects new work, and retains the original result', async () => {
  const ledger = new RequestLedger();
  const request = {
    id: 'shutdown-request-001', issuedAt: Date.now(), method: CLIENT_CHANNELS.SESSION_LIST,
  };
  let finish!: (result: unknown) => void;
  const operation = new Promise<unknown>(resolve => { finish = resolve; });
  const invoke = vi.fn(() => operation);
  const running = ledger.execute('browser-session', request, invoke);
  const duplicate = ledger.execute('browser-session', request, invoke);
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledOnce();
  expect(ledger.status('browser-session', request.id)).toEqual({ state: 'pending' });

  ledger.stopAccepting();
  expect(() => ledger.execute('browser-session', {
    ...request, id: 'shutdown-request-002',
  }, invoke)).toThrow('SERVER_STOPPING');
  let drained = false;
  const shutdown = ledger.settle().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);

  const result = { success: true, data: { sessions: [] } };
  finish(result);
  await expect(running).resolves.toEqual(result);
  await expect(duplicate).resolves.toEqual(result);
  await shutdown;
  expect(drained).toBe(true);
  expect(ledger.status('browser-session', request.id)).toEqual({ state: 'completed', result });
});
