/** Electron transport adapter for shared runtime client services. */
import { registerActivityIpc as registerService } from '@linkterm/runtime/services/client/activity-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/activity-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerActivityIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
