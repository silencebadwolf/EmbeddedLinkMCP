/** Electron transport adapter for shared runtime client services. */
import { registerConnectionProfilesIpc as registerService } from '@linkterm/runtime/services/client/connection-profiles-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/connection-profiles-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerConnectionProfilesIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
