## Why

The Agent integrations dialog reports `LinkTerm preload API is unavailable` even when LinkTerm is launched through Electron. The renderer only reaches that message when `window.linkterm` was never exposed by the preload script.

Recent Electron runtime hardening added a shared resolver that rejects `require('electron')` results unless they contain main-process APIs such as `app`. Preload scripts run in the renderer process and receive a narrower Electron API shape with `contextBridge` and `ipcRenderer`, so the resolver can reject the valid preload runtime before `contextBridge.exposeInMainWorld('linkterm', api)` runs.

## What Changes

- Teach the Electron runtime resolver to accept both main-process and preload-process Electron API shapes.
- Preserve rejection of the npm Electron wrapper string returned outside the Electron runtime.
- Add a regression test for the preload API shape so the Agent integrations panel cannot regress into a missing `window.linkterm` state through this path.

## Impact

- Affected code areas:
  - `src/main/electron-runtime.ts`
  - `tests/unit/main/electron-runtime.test.ts`
- Behavior impact:
  - Additive for preload. Main-process runtime resolution remains unchanged.
  - No renderer UI behavior changes are required; the panel should receive the already-defined preload API.
