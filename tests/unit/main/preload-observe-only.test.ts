import { describe, expect, it, vi } from 'vitest';
import type { PreloadAPI } from '../../../src/shared/preload-api.js';

declare global {
  var __linktermElectronMock: unknown;
}

interface PreloadElectronMock {
  readonly contextBridge: {
    readonly exposeInMainWorld: ReturnType<typeof vi.fn>;
  };
  readonly ipcRenderer: {
    readonly invoke: ReturnType<typeof vi.fn>;
    readonly on: ReturnType<typeof vi.fn>;
    readonly removeListener: ReturnType<typeof vi.fn>;
  };
}

function createElectronMock(): PreloadElectronMock {
  return {
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  };
}

async function loadPreload(mock: PreloadElectronMock): Promise<PreloadAPI> {
  globalThis.__linktermElectronMock = mock;
  vi.resetModules();
  await import('../../../src/main/preload.js');
  return mock.contextBridge.exposeInMainWorld.mock.calls[0]?.[1] as PreloadAPI;
}

describe('preload observe-only boundary', () => {
  it('does not expose an approval namespace or approval IPC channels', async () => {
    const mock = createElectronMock();
    const api = await loadPreload(mock);

    expect(api).not.toHaveProperty('approval');
    expect(Object.keys(api)).not.toContain('approval');
    expect(JSON.stringify(api)).not.toMatch(/approval|approve|deny/i);
  });
});
