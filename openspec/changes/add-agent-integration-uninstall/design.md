## Decisions

### Decision 1: Uninstall removes only the external MCP registration

Uninstall means removing LinkTerm's `linkterm` MCP server from the selected external Agent config. It does not uninstall LinkTerm, delete backups, delete Codex itself, or erase token env files. This keeps the operation reversible and low surprise.

### Decision 2: Preserve existing install safety behavior

Before changing a config file, LinkTerm creates a timestamped sidecar backup using the same local/WSL write path as install. Malformed JSON remains protected: uninstall refuses to overwrite invalid JSON config.

### Decision 3: Reuse existing config parsers/renderers

JSON config removal uses the same config-kind switch as install:

- VS Code settings: remove `chat.mcpServers.linkterm`
- VS Code mcp.json: remove `servers.linkterm`
- Claude/Cursor/Windsurf/Cline/Roo style config: remove `mcpServers.linkterm`
- Codex TOML: remove `[mcp_servers.linkterm]` and `[mcp_servers.linkterm.env]`

### Decision 4: Renderer exposes install, diagnose, and uninstall as separate commands

Configured rows show a remove action. Non-configured rows can keep the remove button disabled so users understand why no uninstall action is available.

### Decision 5: Token diagnostic text explains the state

The diagnostic keeps the technical label `LINKTERM_MCP_TOKEN` but changes the message to explain whether LinkTerm's current process can see the env var and what that means for HTTP MCP auth.
