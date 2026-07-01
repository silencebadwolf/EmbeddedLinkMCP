## Root Cause

`src/main/preload.ts` imports the shared `electron` proxy from `src/main/electron-runtime.ts`. The proxy calls `resolveElectronRuntime()`, which currently accepts only Electron objects with an `app` property.

That check is valid for main-process modules but too strict for preload modules. In preload, Electron exposes `contextBridge` and `ipcRenderer`; `app` is not part of the preload API. The resolver therefore throws before `contextBridge.exposeInMainWorld('linkterm', api)` runs, and the renderer sees `window.linkterm` as missing.

## Approach

- Replace the single `app`-property check with an explicit Electron API shape predicate.
- Accept either:
  - main process shape: contains `app`
  - preload shape: contains both `contextBridge` and `ipcRenderer`
- Continue rejecting missing/null/string Electron wrapper results.

## Non-Goals

- Do not change the preload API contract or renderer Agent integrations UI.
- Do not alter the Codex/WSL MCP configuration logic.
- Do not weaken Electron security settings such as `contextIsolation` or `nodeIntegration`.
