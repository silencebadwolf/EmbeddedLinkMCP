/** Control profile IPC handler tests. */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  handlers,
  ipcMainMock,
  showOpenDialogMock,
  execFileMock,
  execFileAsyncMock,
  readdirMock,
} = vi.hoisted(() => {
  const map = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const execFile = vi.fn();
  const execFileAsync = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = execFileAsync;
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
    showOpenDialogMock: vi.fn(),
    execFileMock: execFile,
    execFileAsyncMock: execFileAsync,
    readdirMock: vi.fn(),
  };
});

const electronMock = {
  app: {},
  ipcMain: ipcMainMock,
  dialog: { showOpenDialog: showOpenDialogMock },
};
globalThis.__linktermElectronMock = electronMock;

vi.mock('electron', () => ({ default: electronMock, ...electronMock }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('node:fs/promises', () => ({ readdir: readdirMock }));

import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';
import type { ControlProfileManager } from '../../../../src/core/workspace/index.js';
import type { registerControlProfileIpc as RegisterControlProfileIpc } from '../../../../src/main/ipc/control-profile-ipc.js';

let registerControlProfileIpc: typeof RegisterControlProfileIpc;
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  });
}

function installWslExecFileMock(): void {
  execFileAsyncMock.mockImplementation(async (
    _file: string,
    args: string[],
  ) => {
    if (args[0] === '--list') {
      return {
        stdout: 'U\u0000b\u0000u\u0000n\u0000t\u0000u\u0000-\u00002\u00004\u0000.\u00000\u00004\u0000\r\u0000\n\u0000',
        stderr: '',
      };
    }
    return { stdout: 'jianyin\n/home/jianyin\n', stderr: '' };
  });
}

describe('registerControlProfileIpc', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ registerControlProfileIpc } = await import('../../../../src/main/ipc/control-profile-ipc.js'));
    setPlatform('win32');
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
    showOpenDialogMock.mockReset();
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    execFileMock.mockReset();
    execFileAsyncMock.mockReset();
    readdirMock.mockReset();
    installWslExecFileMock();
  });

  afterAll(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('opens the workspace directory picker at the discovered WSL home on Windows', async () => {
    registerControlProfileIpc({} as ControlProfileManager);

    const handler = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT)!;
    const result = await handler({}, undefined);

    expect(result).toEqual({ success: true, data: { root: null } });
    expect(showOpenDialogMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Select workspace folder',
      properties: ['openDirectory'],
      defaultPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin',
    }));
  });

  it('opens the workspace directory picker without a default path when WSL is unavailable', async () => {
    execFileAsyncMock.mockRejectedValueOnce(new Error('wsl.exe not found'));
    readdirMock.mockRejectedValue(new Error('share unavailable'));
    registerControlProfileIpc({} as ControlProfileManager);

    const handler = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT)!;
    const result = await handler({}, undefined);

    expect(result).toEqual({ success: true, data: { root: null } });
    expect(showOpenDialogMock).toHaveBeenCalledWith({
      title: 'Select workspace folder',
      properties: ['openDirectory'],
    });
  });
});
