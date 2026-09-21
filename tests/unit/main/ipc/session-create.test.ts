/**
 * session:create IPC handler 单测。
 *
 * 不在 Electron 进程内运行 —— 通过 mock `electron.ipcMain` 验证 handler 注册与行为。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock electron.ipcMain：捕获 handle/removeHandler 的调用，并提供同步 invoke
// 使用 vi.hoisted 让 mock 工厂在 hoist 后仍能访问这些变量
const { handlers, ipcMainMock } = vi.hoisted(() => {
  const map = new Map<string, (event: unknown, payload: unknown) => unknown>();
  return {
    handlers: map,
    ipcMainMock: {
      handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
        map.set(channel, fn);
      }),
      removeHandler: vi.fn((channel: string) => {
        map.delete(channel);
      }),
    },
  };
});

const electronMock = { app: {}, ipcMain: ipcMainMock };
globalThis.__linktermElectronMock = electronMock;

vi.mock('electron', () => ({
  default: electronMock,
  ...electronMock,
}));

// node-pty 在测试环境通常未编译；session-factory import LocalShellSession 路径会拉到它
vi.mock('node-pty', () => ({
  default: { spawn: vi.fn() },
  spawn: vi.fn(),
}));

// 也避免 serialport 真加载
vi.mock('serialport', () => ({ SerialPort: class {} }));
vi.mock('ssh2', () => ({ Client: class {} }));

import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { SessionBase } from '@linkterm/runtime/core/session/session-base';
import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';
import type { SessionId } from '../../../../src/shared/types.js';
import type { registerSessionCreate as RegisterSessionCreate } from '../../../../src/main/ipc/session-create-handler.js';
import { MockTransport } from '../../../fixtures/mock-transport.js';

class CharacterizationSession extends SessionBase {
  constructor(id: SessionId, transport: MockTransport) {
    super({ id, transport });
  }
}

const validSerialRequest = {
  config: {
    type: 'serial',
    port: 'COM7',
    baudRate: 115200,
    mode: 'terminal',
  },
} as const;

let registerSessionCreate: typeof RegisterSessionCreate;

describe('registerSessionCreate', () => {
  beforeEach(async () => {
    ({ registerSessionCreate } =
      await import('../../../../src/main/ipc/session-create-handler.js'));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('registers session:create channel', () => {
    const sm = new SessionManager();
    registerSessionCreate(sm);
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.SESSION_CREATE,
      expect.any(Function),
    );
  });

  it('returns INVALID_PAYLOAD on schema failure', async () => {
    const sm = new SessionManager();
    registerSessionCreate(sm);
    const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;
    const result = (await handler({}, { config: { type: 'unknown' } })) as {
      success: boolean;
      error?: { code: string };
    };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAYLOAD');
  });

  it('returns INVALID_PAYLOAD when config missing', async () => {
    const sm = new SessionManager();
    registerSessionCreate(sm);
    const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;
    const result = (await handler({}, {})) as { success: boolean; error?: { code: string } };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAYLOAD');
  });

  it('dispose unregisters the handler', () => {
    const sm = new SessionManager();
    const dispose = registerSessionCreate(sm);
    dispose();
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.SESSION_CREATE);
  });

  it('returns success with a registered open session', async () => {
    const sm = new SessionManager();
    const realCreate = sm.create.bind(sm);
    vi.spyOn(sm, 'create').mockImplementation((_factory, metadata) =>
      realCreate((id) => new CharacterizationSession(id, new MockTransport()), metadata),
    );
    registerSessionCreate(sm);

    const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;
    const result = (await handler({}, validSerialRequest)) as {
      success: true;
      data: { sessionId: SessionId; state: string };
    };

    expect(result).toMatchObject({ success: true, data: { state: 'open' } });
    expect(sm.has(result.data.sessionId)).toBe(true);
    expect(sm.summaryOf(result.data.sessionId)).toMatchObject({ state: 'open' });
  });

  it('reuses the same active serial session on repeated create requests', async () => {
    const sm = new SessionManager();
    const realCreate = sm.create.bind(sm);
    const create = vi.spyOn(sm, 'create').mockImplementation((_factory, metadata) =>
      realCreate((id) => new CharacterizationSession(id, new MockTransport()), metadata),
    );
    registerSessionCreate(sm);
    const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;

    const first = (await handler({}, validSerialRequest)) as {
      success: true;
      data: { sessionId: SessionId; state: string };
    };
    const second = (await handler({}, validSerialRequest)) as {
      success: true;
      data: { sessionId: SessionId; state: string };
    };

    expect(second.data.sessionId).toBe(first.data.sessionId);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sm.listSummaries()).toHaveLength(1);
  });

  it('returns SERIAL_SESSION_CONFLICT without creating an errored tab for different parameters', async () => {
    const sm = new SessionManager();
    const realCreate = sm.create.bind(sm);
    const create = vi.spyOn(sm, 'create').mockImplementation((_factory, metadata) =>
      realCreate((id) => new CharacterizationSession(id, new MockTransport()), metadata),
    );
    registerSessionCreate(sm);
    const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;
    const first = (await handler({}, validSerialRequest)) as {
      success: true;
      data: { sessionId: SessionId };
    };

    const conflict = await handler({}, {
      config: { ...validSerialRequest.config, baudRate: 9_600 },
    });

    expect(conflict).toMatchObject({
      success: false,
      error: { code: 'SERIAL_SESSION_CONFLICT' },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(sm.listSummaries()).toEqual([
      expect.objectContaining({ sessionId: first.data.sessionId, state: 'open' }),
    ]);
  });

  it('returns success with a retained errored session after transport open fails', async () => {
    const sm = new SessionManager();
    const realCreate = sm.create.bind(sm);
    vi.spyOn(sm, 'create').mockImplementation((_factory, metadata) =>
      realCreate(
        (id) =>
          new CharacterizationSession(
            id,
            new MockTransport({ failOnOpen: new Error('port busy') }),
          ),
        metadata,
      ),
    );
    registerSessionCreate(sm);

    const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;
    const result = (await handler({}, validSerialRequest)) as {
      success: true;
      data: { sessionId: SessionId; state: string };
    };

    expect(result).toMatchObject({ success: true, data: { state: 'errored' } });
    expect(sm.has(result.data.sessionId)).toBe(true);
    expect(sm.listSummaries()).toContainEqual(
      expect.objectContaining({
        sessionId: result.data.sessionId,
        state: 'errored',
        connectionType: 'serial',
      }),
    );
  });

  it('returns INTERNAL without registering a session when construction fails', async () => {
    const sm = new SessionManager();
    vi.spyOn(sm, 'create').mockImplementationOnce(() => {
      throw new Error('manager create failed');
    });
    registerSessionCreate(sm);

    const handler = handlers.get(IPC_CHANNELS.SESSION_CREATE)!;
    const result = await handler({}, validSerialRequest);

    expect(result).toEqual({
      success: false,
      error: { code: 'INTERNAL', message: 'manager create failed' },
    });
    expect(sm.list()).toEqual([]);
  });
});
