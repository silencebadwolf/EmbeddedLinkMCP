import { describe, expect, it } from 'vitest';
import { resolveElectronRuntime } from '../../../src/main/electron-runtime.js';

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
      expect(resolveElectronRuntime(() => {
        throw new Error('npm electron wrapper should not be required inside Electron runtime');
      })).toBe(electronApi);
    } finally {
      if (originalElectron === undefined) {
        delete processWithElectronBinding.electron;
      } else {
        processWithElectronBinding.electron = originalElectron;
      }
    }
  });
});
