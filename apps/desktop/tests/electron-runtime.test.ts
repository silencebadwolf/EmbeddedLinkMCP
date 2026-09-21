import { describe, expect, it, vi } from 'vitest';
import { resolveElectronRuntime } from '../src/platform/electron-runtime.js';

declare global {
  var __linktermElectronMock: unknown;
}

describe('resolveElectronRuntime', () => {
  it('returns Electron API objects from an injected require function', () => {
    const electronApi = {
      app: { isPackaged: false },
      BrowserWindow: class BrowserWindow {},
    };

    expect(resolveElectronRuntime(() => electronApi)).toBe(electronApi);
  });

  it('rejects the npm electron wrapper executable path shape', () => {
    expect(() => resolveElectronRuntime(() => 'C:\\Electron\\electron.exe')).toThrow(
      /Electron runtime API is unavailable/u,
    );
  });

  it('accepts Electron preload API objects without main-process app APIs', () => {
    const preloadElectronApi = {
      contextBridge: { exposeInMainWorld: () => undefined },
      ipcRenderer: {
        invoke: async () => undefined,
        on: () => undefined,
        removeListener: () => undefined,
      },
    };

    expect(resolveElectronRuntime(() => preloadElectronApi)).toBe(preloadElectronApi);
  });

  it('uses the test override before resolving the npm electron wrapper', () => {
    const electronApi = {
      app: { isPackaged: false },
      ipcMain: {},
    };
    globalThis.__linktermElectronMock = electronApi;

    try {
      expect(resolveElectronRuntime(() => 'C:\\Electron\\electron.exe')).toBe(electronApi);
    } finally {
      delete globalThis.__linktermElectronMock;
    }
  });

  it('uses the Electron process global before touching the npm electron wrapper', () => {
    const electronApi = {
      app: { isPackaged: false },
      BrowserWindow: class BrowserWindow {},
    };
    const processWithElectronBinding = process as NodeJS.Process & {
      electron?: unknown;
    };
    const originalElectron = processWithElectronBinding.electron;
    processWithElectronBinding.electron = electronApi;

    try {
      expect(
        resolveElectronRuntime(() => {
          throw new Error('npm electron wrapper should not be required inside Electron runtime');
        }),
      ).toBe(electronApi);
    } finally {
      if (originalElectron === undefined) {
        delete processWithElectronBinding.electron;
      } else {
        processWithElectronBinding.electron = originalElectron;
      }
    }
  });

  it('allows preload to expose window.linkterm when Electron only provides preload APIs', async () => {
    const exposeInMainWorld = vi.fn();
    const preloadElectronApi = {
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        invoke: vi.fn(async () => undefined),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    globalThis.__linktermElectronMock = preloadElectronApi;

    try {
      vi.resetModules();
      await import('../src/preload/index.js');
    } finally {
      delete globalThis.__linktermElectronMock;
    }

    expect(exposeInMainWorld).toHaveBeenCalledWith(
      'linkterm',
      expect.objectContaining({
        activity: expect.objectContaining({
          subscribe: expect.any(Function),
          snapshot: expect.any(Function),
          unsubscribe: expect.any(Function),
          onEvent: expect.any(Function),
        }),
        agentIntegrations: expect.objectContaining({
          list: expect.any(Function),
          install: expect.any(Function),
          uninstall: expect.any(Function),
          diagnose: expect.any(Function),
        }),
      }),
    );
  });
});
