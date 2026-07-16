# Design: Phase 5 Human Approval

## Goals

- Make every `human-once` approval-required operation require a Main-owned one-time human
  grant in `interactive-required` mode.
- Keep legacy `confirm=true` as caller acknowledgement only; it can unlock preparation, not
  execution.
- Bind grants to the exact prepared effect, stable principal, continuation kind, consumer
  surface, execution mode, runtime, and expiry.
- Preserve at-most-once authorization even when the Activity Ledger, Renderer, preload, or
  best-effort stores fail.
- Migrate both MCP and direct Control Profile download paths so a button click or hard-coded
  `confirm:true` cannot execute high-impact work.

## Non-goals

- J-Link/RTT first signal, new download-and-observe UX, probe/firmware readiness expansion, or
  compensation/reflash suggestions.
- Pause/Take Over, admission leases, cancellation controls, durable audit/export/clear, cloud
  accounts, remote approval, default telemetry, databases, or generic chat UI.
- Hardware rollback, checkpoint claims, or undo semantics for flash/reset/erase.
- Per-vendor Agent identity. The first version maps local MCP transports sharing the runtime
  credential to one stable local MCP principal.

## Ownership model

```text
MCP / Renderer direct caller
  -> existing legacy acknowledgement gate, if any
    -> prepare approval-required operation in Main
      -> Main-only PreparedOperation + ApprovalRequest
        -> display-safe ApprovalRequestView
          -> Renderer Approval Sheet human decision
            -> approval:resolve decision only
              -> one-time ApprovalGrant
                -> second invocation / retry with approvalId continuation
                  -> verifyAndConsume
                    -> existing backend/session/manager path
```

Main owns mode, principal mapping, preparation, request/grant state, mandatory
`AuthorizationRecord`, resource limits, expiry, and consumption. Renderer owns only
displaying requests and sending a human decision. MCP cannot resolve approval. Activity is
observable projection only.

## ApprovalModePolicy

`ApprovalMode` is frozen once in Main composition:

- desktop: `interactive-required`;
- true headless: `headless-deny`;
- `automation-allowlisted`: disabled in Phase 5 unless a later change adds an explicit
  trusted startup path.

Request args, `confirm`, `approvalId`, headers, MCP transport, HTTP socket, stdio proxy,
Renderer reload, window hidden/minimized/closed, or no active BrowserWindow cannot downgrade
the mode. In `interactive-required`, lack of an approvable UI keeps the request pending until
TTL or returns a stable not-available error for flows that cannot present a sheet safely. In
`headless-deny`, `human-once` requests fail closed with effectful backend call count 0.

## Stable principals

`CallerPrincipalId` is Main-assigned and internal:

- local MCP HTTP/stdio/proxy calls sharing the runtime credential map to one stable
  `local-mcp-principal:<runtimeCredentialId>` without exposing the raw credential;
- trusted desktop Renderer IPC maps to `local-desktop-principal:<runtimeId>`;
- per-request socket, IP, connection id, display name, client correlation id, and self-declared
  principal are diagnostics only and cannot bind grants or reset rate limits.

Renderer never receives the internal principal id. Display-safe copy uses labels such as
`Local MCP agent` or `This desktop window`.

## PreparedOperation and effect fingerprint

Preparation is side-effect-free. It may call only explicit read-only facades, such as status,
catalog, detect, profile read, path metadata, and artifact hashing. The following must be 0
during prepare: connect, halt, run, reset, write, erase, flash, start GDB/J-Link/RTT server,
open sessions, mutate workspace/profile, or schedule jobs.

The effect fingerprint covers at least:

- tool/action and normalized semantic arguments, excluding `confirm`, `approvalId`,
  correlation ids, request ids, display hints, and other non-semantic client metadata;
- continuation kind, consumer surface, and execution mode;
- expanded defaults and profile/control-profile revision;
- host realpath and symlink-resolved artifact/source path metadata where relevant;
- artifact/content SHA-256 and size where relevant, with bounded streaming and cancellation;
- target binding digest for probe/device/session/workspace where relevant;
- immutable plan manifest steps with per-step risk, display-safe summary code, parameter
  summary, target refs, and step effect fingerprints.

Prepared bytes, handles, source refs, target binding digests, and raw internal fingerprints
remain Main-only. Renderer sees only summaries, display names, sizes, content hash when safe,
and target refs.

## Broker state machine

Core states:

- `pending`: awaiting human decision;
- `approved`: grant issued, not consumed;
- `denied`: human denied;
- `expired`: TTL elapsed or runtime shutdown;
- `superseded`: correct consumer presented a different effect/new intent;
- `consumed`: correct consumer consumed the grant exactly once.

The dedupe key is:

```text
runtimeId + approvalMode + authorizedPrincipalId
  + continuation.kind + continuation.surface + continuation.executionMode
  + effectFingerprint
```

Same pending key returns the same `approvalId`; it does not stack modals or assertive
notifications. New semantic effect for the correct consumer supersedes the old request/grant
and creates a new pending request. Wrong principal, continuation kind, surface, or execution
mode is rejected without consuming, superseding, or invalidating the original grant.

`resolve` and `verifyAndConsume` run under a serialized transaction. Each transition prepares
and validates the next state and `AuthorizationRecord`, reserves mandatory record capacity,
then publishes atomically. Schema, serialization, or capacity failure fails closed and leaves
the prior authority state intact.

## Limits and resource release

Default limits:

- max pending per runtime: 16;
- max pending per principal: 8;
- max single artifact bytes: 64 MiB;
- max total prepared bytes per runtime: 256 MiB;
- max prepares per principal per minute: 20;
- max prepares global per minute: 100.

Limit failures return stable codes such as `APPROVAL_QUEUE_FULL`, `APPROVAL_RATE_LIMITED`, or
`PREPARE_TOO_LARGE`; effectful backend calls remain 0 and approved-unconsumed grants are not
evicted to make room. Deny, expiry, supersede, consume, explicit stop, and runtime shutdown
release prepared bytes/handles according to their terminal semantics.

## IPC and preload

Phase 5 adds approval channels:

```text
approval:capabilities
approval:snapshot
approval:subscribe
approval:unsubscribe
approval:resolve
approval:event
```

The preload namespace exposes a narrow API:

```ts
window.linkterm.approval.capabilities()
window.linkterm.approval.snapshot()
window.linkterm.approval.subscribe()
window.linkterm.approval.unsubscribe()
window.linkterm.approval.resolve({ approvalId, decision })
window.linkterm.approval.onEvent(handler, onInvalidPayload?)
```

Renderer must attach the local event listener before subscribe/snapshot hydration and ignore
stale revisions. Main validates sender identity for `resolve`; MCP has no resolve tool.
Malformed requests/events become bounded diagnostics without raw payload retention.

## Renderer Approval Sheet

The sheet shows one active pending request at a time and queues the rest. It displays:

- who is requesting, using display-safe actor/principal labels;
- action, risk, approval policy, and caller acknowledgement status;
- target refs and argument/parameter summaries;
- effect/impact summary code, never internal fingerprint;
- plan steps and artifact metadata when present;
- expiry state and clear consequences;
- Approve once and Deny buttons.

It does not claim rollback/undo. Pending approval uses assertive announcement without stealing
focus from active terminal input; the header/capsule remains visible. Denied, expired,
approved-ready-to-continue, and consumed states remain queryable through Activity Center.

## Migrated execution paths

MCP registry and high-impact tools:

- missing legacy acknowledgement still returns the existing acknowledgement error where
  applicable and effectful backend calls remain 0;
- `confirm=true` in `interactive-required` prepares or retrieves a pending request and returns
  an approval-required result; backend calls remain 0;
- a retry or second invocation with matching `approvalId` consumes exactly once, then calls the
  existing handler/backend.

Control Profile direct IPC:

- initial RUN/START download click creates or retrieves a prepared request; hard-coded
  `confirm:true` is only caller acknowledgement;
- `approval:resolve` does not execute;
- approved RUN uses the same original channel with `{ kind: 'continue-approved', approvalId }`
  and fixed sync execution mode;
- approved START uses the same original channel with `{ kind: 'continue-approved',
  approvalId }` and fixed background execution mode;
- duplicate or replayed continuation does not execute again;
- MCP and IPC cannot cross-consume the same grant because surface/mode/principal binding
  differs.

## Activity and authorization labels

Activity display distinguishes:

- approval not required;
- client acknowledgement required;
- client acknowledged but not authorized;
- approved once by you;
- future local automation rule authorization.

`AuthorizationDisplay` contains safe labels only. It never contains internal principal ids,
prepared operation ids, grant ids beyond display request ids, raw rule ids, config paths,
nonces, or effect fingerprints.

## Risks and mitigations

- **AI self-approval**: no MCP resolve tool; Main validates Renderer sender for resolve.
- **TOCTOU after approval**: execute uses prepared snapshot or rechecks effect fingerprint at
  the final boundary.
- **Wrong consumer attack**: principal/kind/surface/mode mismatch rejects but preserves the
  original grant.
- **Double execution**: consume is atomic and one-time; replayed approval ids return consumed
  without backend invocation.
- **Window-state downgrade**: Main freezes approval mode; no window state participates in
  mode decisions.
- **Approval fatigue**: dedupe identical pending requests and use plan-scoped approvals.
- **Prepared artifact DoS**: quotas, rate limits, streaming hash, cancellation, and TTL release.
- **Authority/projection split**: `AuthorizationRecord` is mandatory authority; ledger/display
  failure cannot grant authorization.

## Migration plan

1. Add shared display-safe approval DTO schemas and internal-only core approval schemas.
2. Add pure ApprovalModePolicy, principal mapping, effect fingerprint, limits, and Broker
   state-machine tests.
3. Implement core approval preparation/broker services without product execution integration.
4. Add Main IPC/preload/mock bridge and Renderer Approval Sheet over display-safe DTOs.
5. Integrate Activity labels and approval projections.
6. Migrate MCP high-impact/debug/runtime/control-workflow paths behind prepare/consume.
7. Migrate Control Profile direct RUN/START_DOWNLOAD behind two-invocation continuation.
8. Run focused tests after each slice, then full quality, GitNexus, review, and evidence
   closeout.
