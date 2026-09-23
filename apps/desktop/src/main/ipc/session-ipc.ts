/** Electron transport adapter for shared runtime client services. */
import { registerSessionIpc as registerService } from '@linkterm/runtime/services/client/session-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/session-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerSessionIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
