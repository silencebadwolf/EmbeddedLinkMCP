## Why

Agent integrations currently expose install/repair and diagnose actions, but no way to remove LinkTerm from an external AI tool configuration. Users can end up with a LinkTerm MCP entry in Codex, VS Code, Claude Desktop, or WSL Codex config and must manually edit JSON/TOML to remove it.

The HTTP MCP token diagnostic also reports `LINKTERM_MCP_TOKEN is available in the current process environment`, which is technically correct but unclear. Users need to know that this is a pass condition for LinkTerm's current process, not a command to run or a new secret to paste.

## What Changes

- Add an uninstall/remove action for Agent integrations that removes only the LinkTerm-managed `linkterm` MCP server entry.
- Preserve unrelated agent configuration and create a backup before writing.
- Support JSON-based agents, Codex TOML, and WSL Codex targets through the same config bridge used by install.
- Add renderer UI action and preload/IPC contracts for uninstall.
- Clarify token diagnostics so pass/fail messages explain the meaning of `LINKTERM_MCP_TOKEN`.

## Impact

- Affected code areas:
  - `src/core/agent-integrations/`
  - `src/main/ipc/agent-integrations-ipc.ts`
  - `src/main/preload.ts`
  - `src/shared/agent-integrations.ts`, `src/shared/preload-api.ts`, `src/shared/ipc-protocol.ts`
  - `src/renderer/components/AgentIntegrationsPanel.tsx`
  - renderer translations and tests
- Behavior impact:
  - Additive IPC/preload API.
  - Uninstall only edits the specific `linkterm` MCP config block/key and keeps other config intact.
  - No LinkTerm app files or tokens are deleted.
