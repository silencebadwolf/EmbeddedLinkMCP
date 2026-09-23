/** Electron transport adapter for shared runtime client services. */
import { registerControlProfileIpc as registerService } from '@linkterm/runtime/services/client/control-profile-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/control-profile-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerControlProfileIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
