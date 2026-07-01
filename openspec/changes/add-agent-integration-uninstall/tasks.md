## 1. Core Behavior

- [x] 1.1 Add failing tests for uninstalling JSON agent configs while preserving unrelated entries and creating a backup.
- [x] 1.2 Add failing tests for uninstalling Codex TOML config and removing only LinkTerm TOML tables.
- [x] 1.3 Add failing tests for WSL Codex uninstall through the WSL file bridge.
- [x] 1.4 Implement `AgentIntegrationManager.uninstall()`.

## 2. Diagnostics

- [x] 2.1 Add failing tests for clearer HTTP token diagnostic pass/fail messages.
- [x] 2.2 Update diagnostic messages.

## 3. IPC, Preload, and UI

- [x] 3.1 Add failing IPC tests for `agentIntegrations:uninstall`.
- [x] 3.2 Add shared/preload contracts and preload invocation for uninstall.
- [x] 3.3 Add renderer tests for the remove action and result status update.
- [x] 3.4 Implement the renderer remove action and translations.

## 4. Verification

- [x] 4.1 Run targeted unit tests for core, IPC, preload/runtime, and renderer Agent integrations.
- [x] 4.2 Run OpenSpec validation for this change and all specs.
- [x] 4.3 Run `pnpm test`, `pnpm run build:main`, and `pnpm run lint`.
- [x] 4.4 Run GitNexus `detect_changes`.
