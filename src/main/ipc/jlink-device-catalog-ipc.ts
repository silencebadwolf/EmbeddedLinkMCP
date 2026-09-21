import type { JLinkDeviceCatalog, JLinkDeviceSearchRequest } from '@linkterm/runtime/jlink/device-catalog';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type {
  JLinkDeviceInfoPayload,
  JLinkDeviceSearchResultPayload,
  PreloadResult,
} from '../../shared/preload-api.js';
import { electron } from '../electron-runtime.js';

const { ipcMain } = electron;

/** Register IPC handlers for the installed SEGGER/J-Link device catalog. */
export function registerJLinkDeviceCatalogIpc(catalog: JLinkDeviceCatalog): () => void {
  ipcMain.handle(
    IPC_CHANNELS.JLINK_DEVICES_SEARCH,
    async (_event, raw: unknown): Promise<PreloadResult<JLinkDeviceSearchResultPayload>> => {
      try {
        const request = parseSearchPayload(raw);
        const result = await catalog.search(request);
        return { success: true, data: result };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.JLINK_DEVICES_GET,
    async (_event, raw: unknown): Promise<PreloadResult<{ device?: JLinkDeviceInfoPayload }>> => {
      try {
        const name = parseNamePayload(raw);
        const device = await catalog.get(name);
        return { success: true, data: { device } };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.JLINK_DEVICES_REFRESH,
    async (): Promise<PreloadResult<{ refreshed: true }>> => {
      try {
        await catalog.refresh();
        return { success: true, data: { refreshed: true } };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.JLINK_DEVICES_SEARCH);
    ipcMain.removeHandler(IPC_CHANNELS.JLINK_DEVICES_GET);
    ipcMain.removeHandler(IPC_CHANNELS.JLINK_DEVICES_REFRESH);
  };
}

function parseSearchPayload(raw: unknown): JLinkDeviceSearchRequest {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const payload = raw as { query?: unknown; vendor?: unknown; limit?: unknown };
  const request: JLinkDeviceSearchRequest = {};
  if (payload.query !== undefined) {
    if (typeof payload.query !== 'string') throw new Error('query must be a string');
    request.query = payload.query;
  }
  if (payload.vendor !== undefined) {
    if (typeof payload.vendor !== 'string') throw new Error('vendor must be a string');
    request.vendor = payload.vendor;
  }
  const limit = payload.limit;
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100');
    }
    request.limit = limit;
  }
  return request;
}

function parseNamePayload(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const name = (raw as { name?: unknown }).name;
  if (typeof name !== 'string' || name.trim() === '') throw new Error('name is required');
  return name;
}

function toIpcError<T>(err: unknown): PreloadResult<T> {
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: 'INVALID_PAYLOAD', message } };
}
