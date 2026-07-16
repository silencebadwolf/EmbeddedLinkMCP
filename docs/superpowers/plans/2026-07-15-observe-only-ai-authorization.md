# Observe-only authorization implementation plan

1. Add failing tests proving formerly approval-gated AI and human operations execute immediately while activity/audit recording remains present.
2. Remove approval-gate decisions and continuation-only branches from MCP registry and Main control-profile IPC, retaining validation and admission serialization.
3. Remove approval-only renderer/IPC expectations and update fixtures/translations without removing activity or audit surfaces.
4. Run focused tests, full tests, build, lint, license validation, coverage, GitNexus impact/taint checks, and detect_changes.
