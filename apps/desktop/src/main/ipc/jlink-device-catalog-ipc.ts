/** Electron transport adapter for shared runtime client services. */
import { registerJLinkDeviceCatalogIpc as registerService } from '@linkterm/runtime/services/client/jlink-device-catalog-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/jlink-device-catalog-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerJLinkDeviceCatalogIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
