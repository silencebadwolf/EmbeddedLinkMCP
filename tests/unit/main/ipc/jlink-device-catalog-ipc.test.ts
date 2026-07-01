import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, ipcMainMock } = vi.hoisted(() => {
  const map = new Map<string, (event: unknown, payload: unknown) => unknown>();
  return {
    handlers: map,
    ipcMainMock: {
      handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => map.set(channel, fn)),
      removeHandler: vi.fn((channel: string) => map.delete(channel)),
    },
  };
});

const electronMock = { app: {}, ipcMain: ipcMainMock };
globalThis.__linktermElectronMock = electronMock;
vi.mock('electron', () => ({ default: electronMock, ...electronMock }));

import type { JLinkDeviceCatalog } from '../../../../src/jlink/device-catalog.js';
import type { registerJLinkDeviceCatalogIpc as RegisterJLinkDeviceCatalogIpc } from '../../../../src/main/ipc/jlink-device-catalog-ipc.js';
import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';

let registerJLinkDeviceCatalogIpc: typeof RegisterJLinkDeviceCatalogIpc;

function makeCatalog(): JLinkDeviceCatalog {
  return {
    search: vi.fn(async () => ({
      available: true,
      devices: [{ name: '-AT32F435RGT7', vendor: 'ArteryTek', sourceFile: 'JLinkDevices.xml', flashBanks: [] }],
      sourceFiles: ['JLinkDevices.xml'],
    })),
    get: vi.fn(async (name: string) =>
      name === '-AT32F435RGT7'
        ? { name, vendor: 'ArteryTek', sourceFile: 'JLinkDevices.xml', flashBanks: [] }
        : undefined,
    ),
    has: vi.fn(async (name: string) => name === '-AT32F435RGT7'),
    refresh: vi.fn(async () => undefined),
  };
}

describe('registerJLinkDeviceCatalogIpc', () => {
  beforeEach(async () => {
    ({ registerJLinkDeviceCatalogIpc } = await import('../../../../src/main/ipc/jlink-device-catalog-ipc.js'));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('searches catalog devices', async () => {
    const catalog = makeCatalog();
    registerJLinkDeviceCatalogIpc(catalog);

    const handler = handlers.get(IPC_CHANNELS.JLINK_DEVICES_SEARCH)!;
    const result = (await handler({}, { query: 'AT32F435', limit: 5 })) as { success: boolean; data?: { devices: unknown[] } };

    expect(result.success).toBe(true);
    expect(result.data?.devices).toHaveLength(1);
    expect(catalog.search).toHaveBeenCalledWith({ query: 'AT32F435', limit: 5 });
  });

  it('gets a catalog device by exact registered name', async () => {
    const catalog = makeCatalog();
    registerJLinkDeviceCatalogIpc(catalog);

    const handler = handlers.get(IPC_CHANNELS.JLINK_DEVICES_GET)!;
    const result = (await handler({}, { name: '-AT32F435RGT7' })) as { success: boolean; data?: { device?: { name: string } } };

    expect(result.success).toBe(true);
    expect(result.data?.device?.name).toBe('-AT32F435RGT7');
  });

  it('refreshes the catalog cache', async () => {
    const catalog = makeCatalog();
    registerJLinkDeviceCatalogIpc(catalog);

    const handler = handlers.get(IPC_CHANNELS.JLINK_DEVICES_REFRESH)!;
    const result = (await handler({}, undefined)) as { success: boolean };

    expect(result.success).toBe(true);
    expect(catalog.refresh).toHaveBeenCalled();
  });

  it('rejects invalid search payloads', async () => {
    const catalog = makeCatalog();
    registerJLinkDeviceCatalogIpc(catalog);

    const handler = handlers.get(IPC_CHANNELS.JLINK_DEVICES_SEARCH)!;
    const result = (await handler({}, { limit: -1 })) as { success: boolean; error?: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PAYLOAD');
  });

  it('dispose unregisters handlers', () => {
    const dispose = registerJLinkDeviceCatalogIpc(makeCatalog());
    dispose();

    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.JLINK_DEVICES_SEARCH);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.JLINK_DEVICES_GET);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.JLINK_DEVICES_REFRESH);
  });
});
