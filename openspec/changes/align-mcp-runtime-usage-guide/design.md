## Context

LinkTerm has three runtime guidance surfaces and one configuration surface that are easy to confuse:

1. `createAgentRunbookInstructions()` produces MCP initialize instructions.
2. `get_agent_runbook` returns detailed Markdown plus structured runtime/profile guidance.
3. `tools/list` exposes per-tool descriptions used directly by MCP hosts for tool selection.
4. Agent integration installation writes connection/launch/auth configuration; it is not a prompt store.

Recent runtime changes are implemented and tested. The detailed serial workflow and packaged
guidance now describe reuse, and the main specs have been synchronized with the accepted
`observe-only-ai-execution` automatic-execution policy. This change aligns guidance without altering
execution policy.

### Current execution facts

| Fact | Authoritative evidence | Guidance consequence |
| --- | --- | --- |
| Direct MCP and stdio proxy call the same instruction generator | `createMcpServer`, `startMcpStdioProxy` → `createAgentRunbookInstructions` | Test both delivery paths; keep one packaged source |
| `get_agent_runbook` builds Markdown and structured data from runtime code | `registerAgentRunbookTools` → `createAgentRunbook` → `renderRunbookMarkdown` | No repository manual is required at runtime |
| Agent integration JSON/TOML writes only connection shapes | `mergeLinkTermConfig`, `buildElectronMcpLaunchConfig`, Codex HTTP config tests | Do not inject duplicated client system prompts |
| `get_app_status` lists sessions, serial ports, sanitized profile/probe/UI/tool facts | `registerAgentRunbookTools`, `buildSerialStatus`, `buildJLinkStatus` | Call it first, but describe one-shot enumeration truthfully |
| `get_app_status` calls `listPorts()` and `probeDetect()` | `buildSerialStatus`, `buildJLinkStatus` | Say “read-only discovery/no connection or mutation,” not “never touches hardware” |
| One coordinator owns serial reuse across Main/MCP entry points | `SerialSessionCoordinator` incoming call/import graph and `unify-serial-session-reuse` evidence | Prompt preference supplements rather than replaces Main enforcement |
| Serial identity includes port/framing/flow-control defaults | `normalizeSerialSessionIdentity` and coordinator tests | `open_session` is create-or-reuse; incompatible same-port config conflicts |
| Active `idle/opening/open` sessions can be reused; `closed/errored` cannot | `SerialSessionCoordinator.openOrReuse` and unit tests | Inspect current state before reopening |
| Human and AI writes share the same queue and transcript | `session:write` IPC, terminal MCP tools, `SessionManager.write`, `ai-human-coop.test.ts` | Both may operate; no exclusive ownership or focus seizure |
| Human Ctrl-C has the existing high-priority lane | `TerminalView`, `session-ipc`, `WriteQueue` | Shared operation does not eliminate explicit human interrupt priority |
| `send_and_wait` writes once, observes until `settleMs`, and never returns early for a marker | `sendAndWait`, settle tests | Markers are metadata, not completion gates |
| Empty settle output is successful and does not block later writes | `settle-read-send-and-wait` delta and terminal tests | Silence is not crash proof; no automatic resend |
| `DEVICE_UNRESPONSIVE` remains a defensive/legacy translation, but empty settle no longer marks it | no product caller of `markAiUnresponsive`; terminal tests allow subsequent writes | Do not teach the old timeout latch as normal behavior |
| Validated high-impact calls execute without human approval | `registerTool`, observe-only change, registry/runbook/tool-description tests | Describe immediate automatic execution and evidence observation |
| Legacy `confirm` fields are accepted and ignored | debug/runtime/workflow schemas and observe-only design | Do not present `confirm=true` as authorization |
| Background workflow jobs survive beyond the creation response and expose poll/read/cancel/cleanup | `ControlWorkflowJobManager`, control-workflow tools/spec/tests | Recover evidence instead of repeating hardware actions |
| Hardware truth comes from `IJLinkBackend` and structured evidence | debug/workflow surfaces and `enforce-jlink-hardware-truth` | Host acceptance/progress text alone is not hardware success |
| Activity/Audit are observation surfaces | observe-only design and Activity renderer tests | No approve/deny/pause/take-over actions in guidance |

### Specification synchronization record

- Current runtime code, tests, the accepted product decision, and
  `openspec/changes/observe-only-ai-execution/` establish automatic execution after validation.
- Main specs, README, the development-plan current-policy note, and active control-workflow tests now
  describe the same behavior; legacy `confirm` fields remain ignored compatibility metadata.
- Historical archived changes and dated phase evidence retain their original wording as history and
  are not authoritative for current runtime policy.

## Goals / Non-Goals

**Goals:**

- Make all AI-visible guidance truthful, layered, actionable, and consistent.
- Teach reuse-first serial use, shared ownership, bounded settle reads, and safe recovery.
- Keep automatic execution and evidence requirements unmistakable without promising hardware success.
- Give maintainers a durable map of source, injection, configuration, specs, and tests.
- Prove instructions through MCP clients and prove tool descriptions through `tools/list`.

**Non-Goals:**

- Change SessionManager, WriteQueue, Transport, serial framing, or coordinator behavior.
- Change automatic execution, admission, legacy schema compatibility, Activity, or audit behavior.
- Add approval, pause, resume-AI, take-over, or origin-based mutual exclusion.
- Add cloud state, telemetry, databases, remote approval, or rollback promises.
- Open real serial ports or perform real J-Link/RTT/flash/reset/debug operations during verification.

## Decisions

### Keep one packaged guidance source, not client-specific prompts

Initialize guidance and the detailed runbook remain generated from `runbook.ts`. Agent integration
files continue to hold only launch/connection/auth facts. Client-specific prompt injection was
rejected because it would drift across VS Code, Cursor, Claude Desktop, and Codex and would not cover
HTTP/direct clients.

### Make initialize instructions concise but operational

Initialize text will contain only startup, reuse/shared terminal, bounded settle, automatic execution,
background recovery, ownership, firmware, and fresh-evidence rules. Deep RTT diagnosis and the full
workflow matrix remain in `get_agent_runbook`. A minimal but incomplete initializer was rejected
because MCP hosts do not always call the detailed tool before first use.

### Preserve structured compatibility while making automatic execution explicit

Existing `requiresConfirmation: false` and `backendInvokedWithoutConfirmation: true` fields remain
for consumers. Text and structured workflows will consistently describe execution as automatic after
validation. Removing fields was rejected as an unnecessary response-shape break.

### Treat terminal discovery as conditional

The serial workflow order becomes: inspect status/sessions → use known profile/config facts → discover
only if unknown → create-or-reuse. This prevents needless device rediscovery and avoids implying that
UI-saved records are directly listable through MCP when no such tool exists.

### Add a narrow stdio-proxy construction seam for initialize testing

The proxy server construction will be separated from real HTTP/stdin transport startup so an
in-memory MCP client can verify initialize instructions and forwarding registration. Production
transport and ownership behavior remain unchanged. Static source assertions were rejected as weaker
than protocol-level evidence.

### Test descriptions as user-facing contracts

`tools/list` tests will assert the important semantic clauses rather than full exact strings. This
allows editorial improvements while preventing regression to “always create,” mandatory discovery,
approval, or blind retry guidance.

## Risks / Trade-offs

- [Initialize instructions become too long] → Keep workflow detail in `get_agent_runbook`; test only
  essential clauses and document the layer boundary.
- [Text and structured metadata drift] → Reuse stable guidance constants where practical and add
  cross-layer assertions.
- [Legacy fields confuse clients] → Retain them for compatibility but explicitly label them ignored
  metadata and expose automatic execution in prose/workflow rendering.
- [A client ignores server instructions] → Main-owned coordinator/admission/backend boundaries remain
  authoritative; prompt compliance is never a correctness requirement.
- [Read-only discovery is mistaken for zero hardware interaction] → State exactly that enumeration may
  occur but no connect/mutation is performed.
- [Historical artifacts can be mistaken for current policy] → Keep current main specs and README
  explicit, label the development-plan override, and treat dated/archived artifacts as history.

## Migration Plan

No persisted user data or Agent configuration migration is required. Rebuild/restart is sufficient
for MCP clients to receive new packaged instructions and descriptions. Rollback restores the previous
text/test seam without rewriting configs or touching hardware.

## Open Questions

None. The product decisions—automatic execution, shared human/AI terminal access, Main-owned reuse,
and no approval/pause/take-over mechanism—are already confirmed.
