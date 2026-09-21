import { describe, expect, it, vi } from 'vitest';

declare global {
  var __linktermElectronMock: unknown;
}

describe('createMainWindow', () => {
  it('uses a roomier default desktop window size', async () => {
    const createdOptions: unknown[] = [];

    class BrowserWindow {
      readonly webContents = {
        on: vi.fn(),
        openDevTools: vi.fn(),
      };

      constructor(options: unknown) {
        createdOptions.push(options);
      }

      loadFile = vi.fn();
      loadURL = vi.fn(async () => undefined);
    }

    globalThis.__linktermElectronMock = {
      app: { isPackaged: true },
      BrowserWindow,
      session: {
        defaultSession: {
          webRequest: {
            onHeadersReceived: vi.fn(),
          },
        },
      },
    };

    try {
      vi.resetModules();
      const { createMainWindow } = await import('../src/main/app-lifecycle.js');

      createMainWindow();
    } finally {
      delete globalThis.__linktermElectronMock;
    }

    expect(createdOptions).toHaveLength(1);
    expect(createdOptions[0]).toEqual(
      expect.objectContaining({
        width: 1440,
        height: 900,
      }),
    );
  });
});
