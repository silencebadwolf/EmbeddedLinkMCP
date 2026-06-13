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

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

// node-pty 在测试环境通常未编译；session-factory import LocalShellSession 路径会拉到它
vi.mock('node-pty', () => ({
  default: { spawn: vi.fn() },
  spawn: vi.fn(),
}));

// 也避免 serialport 真加载
vi.mock('serialport', () => ({ SerialPort: class {} }));
vi.mock('ssh2', () => ({ Client: class {} }));

import { registerSessionCreate } from '../../../../src/main/ipc/session-create-handler.js';
import { SessionManager } from '../../../../src/core/session/session-manager.js';
import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';

describe('registerSessionCreate', () => {
  beforeEach(() => {
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
});
