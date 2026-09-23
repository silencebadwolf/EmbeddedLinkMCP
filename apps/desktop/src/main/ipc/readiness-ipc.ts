/** Electron transport adapter for shared runtime client services. */
import { registerReadinessIpc as registerService } from '@linkterm/runtime/services/client/readiness-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/readiness-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerReadinessIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
