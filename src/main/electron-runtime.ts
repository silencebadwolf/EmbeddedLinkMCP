import { createRequire } from 'node:module';

export type ElectronRuntime = typeof import('electron');
export type ElectronRequire = (specifier: 'electron') => unknown;

const requireElectron = createRequire(import.meta.url) as ElectronRequire;
let cachedElectron: ElectronRuntime | null = null;

export function resolveElectronRuntime(requireFn: ElectronRequire = requireElectron): ElectronRuntime {
  const electron = electronProcessGlobal()
    ?? (globalThis as { __linktermElectronMock?: unknown }).__linktermElectronMock
    ?? requireFn('electron') as Partial<ElectronRuntime> | string | null | undefined;
  if (!isElectronRuntimeApi(electron)) {
    throw new Error(
      'Electron runtime API is unavailable. Start LinkTerm with the Electron runtime instead of the npm electron wrapper.',
    );
  }
  return electron as ElectronRuntime;
}

function isElectronRuntimeApi(value: unknown): value is Partial<ElectronRuntime> {
  if (!value || typeof value !== 'object') return false;
  return 'app' in value || ('contextBridge' in value && 'ipcRenderer' in value);
}

function electronProcessGlobal(): unknown {
  return (process as NodeJS.Process & { electron?: unknown }).electron;
}

export const electron = new Proxy({} as ElectronRuntime, {
  get(_target, property, receiver) {
    cachedElectron ??= resolveElectronRuntime();
    return Reflect.get(cachedElectron, property, receiver);
  },
});
