## 1. Contracts and tests

- [x] 1.1 Add runbook tests proving initialize instructions and Markdown explicitly identify `write_to_session`, `send_and_wait`, and `read_from_session` as the terminal command path.
- [x] 1.2 Add `get_app_status` tests proving `terminalCommandTools` reports canonical send/read tools and availability when the core tool set is complete.
- [x] 1.3 Add a negative status test proving missing terminal command tools make `terminalCommandTools.available` false and list missing tool names.

## 2. Implementation

- [x] 2.1 Add a small typed terminal command capability summary builder in the agent-runbook status surface.
- [x] 2.2 Include `terminalCommandTools` in `get_app_status` evidence without adding side effects.
- [x] 2.3 Update initialize instructions and runbook Markdown with explicit terminal command-send guidance.

## 3. Validation

- [x] 3.1 Run targeted runbook/tool-description tests.
- [x] 3.2 Run `openspec validate harden-terminal-command-capability-guidance --strict`.
- [x] 3.3 Run `pnpm run lint`, `pnpm run build`, and `pnpm test`.
