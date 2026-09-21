import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditStore } from '@linkterm/runtime/core/activity/audit-store';
import { IPC_CHANNELS } from '../../src/ipc/channels.js';

const { handlers, ipcMainMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMainMock: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
});

const electronMock = { app: {}, ipcMain: ipcMainMock };
globalThis.__linktermElectronMock = electronMock;
vi.mock('electron', () => ({ default: electronMock, ...electronMock }));

class SenderMock extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return false;
  }
}

describe('registerAuditIpc', () => {
  beforeEach(() => {
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('returns safe status/export results and requires trusted sender for clear', async () => {
    const store = new AuditStore({ directory: 'C:\\audit-test', enabled: false });
    await store.initialize();
    const { registerAuditIpc } = await import('../../src/main/ipc/audit-ipc.js');
    const dispose = registerAuditIpc({
      auditStore: store,
      isTrustedSender: (senderId) => senderId === 1,
    });
    const trusted = new SenderMock(1);
    const untrusted = new SenderMock(2);
    const status = await handlers.get(IPC_CHANNELS.ACTIVITY_STATUS)?.({ sender: trusted }, {});
    expect(status).toMatchObject({ success: true, data: { status: { enabled: false } } });
    const exported = await handlers.get(IPC_CHANNELS.ACTIVITY_EXPORT)?.(
      { sender: trusted },
      { format: 'jsonl', pathMode: 'basename' },
    );
    expect(exported).toMatchObject({ success: true, data: { redacted: true, eventCount: 0 } });
    const denied = await handlers.get(IPC_CHANNELS.ACTIVITY_CLEAR)?.(
      { sender: untrusted },
      { confirm: true },
    );
    expect(denied).toMatchObject({ success: false, error: { code: 'UNTRUSTED_SENDER' } });
    const malformed = await handlers.get(IPC_CHANNELS.ACTIVITY_CLEAR)?.({ sender: trusted }, {});
    expect(malformed).toMatchObject({ success: false, error: { code: 'INVALID_AUDIT_REQUEST' } });
    dispose();
    expect(handlers.has(IPC_CHANNELS.ACTIVITY_STATUS)).toBe(false);
  });

  it('fails closed when the Main trust predicate is omitted', async () => {
    const store = new AuditStore({ directory: 'C:\\audit-test', enabled: false });
    await store.initialize();
    const { registerAuditIpc } = await import('../../src/main/ipc/audit-ipc.js');
    const dispose = registerAuditIpc({ auditStore: store });
    const denied = await handlers.get(IPC_CHANNELS.ACTIVITY_STATUS)?.({ sender: new SenderMock(3) }, {});
    expect(denied).toMatchObject({ success: false, error: { code: 'UNTRUSTED_SENDER' } });
    dispose();
  });
});
