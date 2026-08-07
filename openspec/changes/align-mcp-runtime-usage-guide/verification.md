# Verification — align-mcp-runtime-usage-guide

Date: 2026-07-21
Worktree: repository root (Windows)
Base and current committed HEAD: `3bbe374259e72ab9c22c51d684e0df85899b9f8f`

## Scope verified

This change aligns packaged MCP guidance with the current Main-owned runtime. It changes initialize
instructions, the structured/Markdown Agent Runbook, selected `tools/list` descriptions, protocol
tests, Agent integration characterization, and maintainer documentation. The only production
structural change is the transport-independent `createMcpProxyServer()` construction seam used by
the existing stdio startup path and in-memory protocol tests.

No SessionManager, WriteQueue, transport, serial coordinator, terminal send/read implementation,
execution policy, tool schema/handler, Agent integration persistence implementation, J-Link backend,
RTT backend, or hardware workflow implementation was changed.

## Requirement and protocol evidence

| Requirement surface | Fresh evidence |
| --- | --- |
| Direct initialize instructions | `tests/unit/mcp/agent-runbook.test.ts` connects an in-memory MCP client to the direct server and reads `client.getInstructions()`; it checks startup status, conditional serial discovery, create-or-reuse, shared human/AI ownership, bounded settle, automatic execution, background recovery, firmware handling, and no approval/pause/take-over workflow. |
| Detailed `get_agent_runbook` | The same protocol client calls the tool and checks structured workflows plus Markdown for session reuse/conflict, shared closure, terminal evidence, RTT diagnosis, automatic high-impact execution, profile firmware, and error recovery. |
| `tools/list` descriptions | `tests/unit/mcp/tool-descriptions.test.ts` obtains descriptions through `client.listTools()` and checks terminal, status/runbook, profile/workflow, debug/RTT, firmware, timeout, and conditional-discovery semantics. The discovery assertion requires the full `neither ... nor ...` condition. |
| Stdio proxy initialize and forwarding | `tests/unit/mcp/stdio-proxy.test.ts` uses an in-memory MCP client/server transport to verify packaged initialize instructions, `tools/list`, `tools/call` parameter/result forwarding, result-schema validation, and transport-failure shutdown. |
| Agent integration boundary | `tests/unit/core/agent-integrations/agent-integration-manager.test.ts` and `launch-config.test.ts` characterize VS Code, Cursor, Claude Desktop, Codex stdio TOML, and Codex HTTP configuration. Managed entries contain connection/launch/auth facts and no embedded initialize/runbook/system-prompt fields. |
| Runtime behavior remains characterized | Terminal and control-workflow focused tests stayed in the verification set; the full suite covers serial create-or-reuse, shared queue/transcript, bounded settle, background jobs, execution admission, and fake/null hardware backends. |
| Maintainer manual | `docs/mcp-usage-guide.md` records the operating model, source/injection map, direct/proxy behavior, session/workspace/config choice, errors, evidence, host limitations, synchronization checklist, and no-hardware verification path. |

## Review evidence

An independent reviewer separated specification compliance from code quality. Initial findings were:

- no Critical issue;
- one Important wording bug: conditional discovery used an incorrect `or` relation;
- three Minor gaps: no protocol-level proxy `tools/call` coverage, no direct Cursor prompt-free
  characterization, and an ambiguous `observe-only` high-impact heading.

All four findings were addressed. The reviewer re-read the stable final diff and returned
Critical=0 and Important=0, confirming that the four fixes were complete and the change could enter
final verification.

## Fresh quality gates

All commands below ran after the review fixes:

| Gate | Command | Result |
| --- | --- | --- |
| Full tests and coverage | `pnpm run test:coverage` | PASS: 164 files, 1,985 passed, 17 existing skipped. Statements 82.27%, branches 73.83%, functions 84.66%, lines 84.84%. |
| Lint | `pnpm run lint` | PASS: 0 errors, 0 warnings. |
| TypeScript and production build | `pnpm run build` | PASS. Vite retained the existing 865.23 kB chunk-size warning; it is not introduced by this guidance change. |
| License inventory | `pnpm run validate:licenses` | PASS: 19 runtime dependencies and 29 packages in one audited dev-tooling production closure. |
| OpenSpec | `pnpm exec openspec validate align-mcp-runtime-usage-guide --strict --json` | PASS: 1/1 item valid, 0 issues. |
| Diff hygiene | `git diff --check` | PASS: no whitespace errors. Git reported only future CRLF-to-LF normalization notices for three existing working-copy files. |

The first post-review coverage attempt was blocked before config loading by sandbox `spawn EPERM`.
The final command ran with the required process-spawn permission and passed; the blocked attempt is
not counted as verification evidence.

## GitNexus, PDG, and taint evidence

The final `node .gitnexus/run.cjs analyze --pdg` completed successfully with 39,774 nodes, 72,509
edges, 573 clusters, and 300 flows. Analyzer-only AGENTS/CLAUDE statistic rewrites were removed from
the product diff.

`detect_changes({scope: "all"})` reported:

- 15 changed indexed symbols in 9 tracked source/test files;
- 8 affected execution flows;
- aggregate risk `high`.

The aggregate HIGH is retained as a review note. GitNexus maps a description string change inside a
large `register*Tools` function to the whole registration symbol and therefore to downstream control
workflow/session construction flows. Diff review confirms that the registration-function changes are
description strings only; handlers and schemas are unchanged. The proxy construction seam is covered
through direct protocol tests and the entire suite. This evidence narrows the aggregate warning but
does not erase it.

Final unified PDG upstream impact was run for:

- `createMcpProxyServer`: 1 direct caller, 5 interprocedural symbols;
- `startMcpStdioProxy`: 2 direct callers, 5 interprocedural symbols;
- `createAgentRunbookInstructions`: 2 direct callers, 10 interprocedural symbols;
- `renderRunbookMarkdown`: 1 direct caller, 2 interprocedural symbols;
- `registerAgentRunbookTools`: 1 direct caller, 6 interprocedural symbols;
- `registerControlWorkflowTools`: 1 direct caller, 6 interprocedural symbols;
- `registerTerminalTools`: 1 direct caller, 6 interprocedural symbols.

All seven unified PDG reports returned risk `UNKNOWN`, not LOW: whole-symbol prompt/description edits
do not form a distinct statement-level upstream slice. No report was truncated. Directed control
queries completed for all seven targets (0/2/0/0/14/17/59 control edges respectively).

Directed taint review returned zero persisted findings for:

- `src/mcp/stdio-proxy.ts`;
- `src/mcp/surfaces/agent-runbook/runbook.ts`;
- `src/mcp/surfaces/agent-runbook/tools.ts`;
- `src/mcp/surfaces/terminal/tools.ts`;
- `src/mcp/surfaces/control-workflow/tools.ts`.

Zero findings are **not proof of safety**. GitNexus explicitly does not model closure/callback,
property/field, or implicit flows, and cross-function findings are context-insensitive. Safety claims
therefore rely on scoped diff review, unchanged Main enforcement, protocol/full tests, and evidence
boundaries in addition to taint output.

## No-hardware and repository-state record

This change and its verification did not:

- open a real serial/SSH/local-shell/RTT session;
- connect a J-Link probe or target;
- flash, erase, verify, reset, halt, attach, or execute a debug command;
- start a real GDB server or launch the LinkTerm App;
- treat probe enumeration, mock responses, planned percentages, or `bytesWritten` as hardware
  success;
- commit, push, create a PR, reset, checkout, clean, or otherwise discard worktree content.

All hardware-facing tests used Mock/Fake/Null dependencies or in-memory MCP transports. At final
verification, committed `HEAD` and `origin/main` both remained
`3bbe374259e72ab9c22c51d684e0df85899b9f8f`; all work for this change remained uncommitted in the
worktree as required.

## Conclusion

The independent OpenSpec change, implementation plan, layered runtime guide, protocol contracts,
maintainer manual, review feedback, quality gates, GitNexus/PDG/taint review, and no-hardware record
are complete for `align-mcp-runtime-usage-guide`. This conclusion applies only to MCP usage-guide
alignment and does not claim that real hardware operations were exercised or that the wider LinkTerm
A+D product scope is complete.
