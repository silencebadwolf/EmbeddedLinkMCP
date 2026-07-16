## ADDED Requirements

### Requirement: Approval mode is immutable and cannot be downgraded by caller, transport, renderer, or window state
LinkTerm SHALL freeze the approval mode in Main at startup. Desktop mode SHALL default to `interactive-required`; true headless mode SHALL default to `headless-deny`; `automation-allowlisted` SHALL NOT be enabled in this first version. Request arguments, `confirm=true`, `approvalId`, headers, client capability, Renderer reload, window hidden/minimized/closed state, transport, socket, stdio proxy, or reconnect MUST NOT downgrade or change the frozen mode.

#### Scenario: Confirm-only request in desktop mode
- **WHEN** an approval-required operation is invoked with `confirm=true` in `interactive-required` mode
- **THEN** LinkTerm creates or reuses a pending approval request
- **AND** no effectful backend call is made
- **AND** the result indicates human approval is required

#### Scenario: Window is unavailable
- **WHEN** a human-once request is prepared while no Renderer window can safely present approval
- **THEN** LinkTerm keeps the frozen approval mode unchanged
- **AND** it either keeps the request pending until TTL or returns a stable approval-unavailable error according to the operation contract
- **AND** it does not fall back to caller acknowledgement

#### Scenario: Headless denies human-once operation
- **WHEN** LinkTerm runs in true `headless-deny` mode
- **AND** a human-once operation is requested
- **THEN** the request fails closed
- **AND** no approval grant or effectful backend call is created

### Requirement: Main assigns stable principals for approval and rate limiting
LinkTerm SHALL use Main-assigned `CallerPrincipalId` values for grant binding, dedupe, and rate limiting. Shared local MCP HTTP/stdio/proxy calls using the same runtime credential SHALL map to one stable local MCP principal. Trusted Renderer IPC SHALL map to a distinct desktop principal. Client-supplied ids, display names, correlation ids, socket ids, IPs, headers, or request bodies MUST NOT serve as grant subjects or unique rate-limit identities.

#### Scenario: MCP reconnect preserves principal
- **WHEN** an MCP client reconnects over a new socket or stdio proxy loop using the same runtime credential
- **THEN** LinkTerm maps it to the same Main-owned local MCP principal
- **AND** pending dedupe, rate limits, and grant binding are unchanged

#### Scenario: Renderer self-declares a principal
- **WHEN** Renderer IPC includes a principal-like field
- **THEN** LinkTerm ignores that field for authorization
- **AND** uses the Main-verified sender principal instead

### Requirement: Prepared operations bind exact effect and remain Main-only
LinkTerm SHALL prepare approval-required effects in Main before requesting human approval. Preparation SHALL be side-effect-free except for explicit read-only facades. `PreparedOperation` MUST include an effect fingerprint covering semantic arguments, expanded defaults, continuation kind/surface/execution mode, profile revision, artifact content metadata, target binding, and exact plan steps where applicable. Internal prepared data MUST NOT cross preload or Renderer.

#### Scenario: Prepare uses only read-only facades
- **WHEN** an approval-required operation is prepared
- **THEN** read-only status, detect, catalog, profile read, path metadata, and artifact hash facades may be called
- **AND** connect, halt, run, reset, write, erase, flash, GDB/J-Link/RTT server start, session open, workspace/profile mutation, and job start call counts are zero

#### Scenario: Non-semantic fields do not authorize
- **WHEN** only `confirm`, `approvalId`, correlation id, request id, display label, or transport metadata changes
- **THEN** those fields are excluded from the effect fingerprint
- **AND** they do not create authorization by themselves

#### Scenario: Semantic effect changes
- **WHEN** artifact content, symlink target, profile/default value, target/probe binding, continuation kind, surface, mode, or plan step changes after approval
- **THEN** the old grant does not authorize the new effect
- **AND** no effectful backend call is made for the changed effect without a new approval

### Requirement: Approval Broker issues short-lived one-time grants with mandatory authorization records
LinkTerm SHALL own approval requests, grants, denials, expiry, supersede, and consumption in a Main/core Approval Broker. The Broker MUST serialize transitions and write a mandatory `AuthorizationRecord` before publishing authority changes. Best-effort Activity Ledger or Renderer state MUST NOT grant, consume, revoke, or resurrect authorization.

#### Scenario: Human approves once
- **WHEN** a pending request is approved by a verified Renderer human action
- **THEN** the Broker issues a grant bound to the prepared operation, principal, continuation kind, surface, mode, runtime, and expiry
- **AND** one matching consumer can consume it exactly once

#### Scenario: Consumed approval is replayed
- **WHEN** the same approval continuation is replayed after consumption
- **THEN** LinkTerm reports a consumed or already-used result
- **AND** no effectful backend call is made

#### Scenario: Wrong consumer tries to use a grant
- **WHEN** principal, continuation kind, surface, or execution mode does not match the grant
- **THEN** LinkTerm rejects that consumer
- **AND** no effectful backend call is made
- **AND** the original grant remains available until TTL for the correct consumer

#### Scenario: Authorization record cannot be committed
- **WHEN** the Broker cannot validate, serialize, reserve, or append the mandatory authorization transition
- **THEN** the transition fails closed
- **AND** no partial grant/consume state is published

### Requirement: Broker limits and resource release fail closed
LinkTerm SHALL enforce bounded pending requests, per-principal and global rate limits, single-artifact bytes, and total prepared bytes. Limit failures MUST be stable, display-safe, and effectful-backend-free. Approved-unconsumed grants MUST NOT be evicted only to make room for new requests.

#### Scenario: Queue is full
- **WHEN** a new request exceeds runtime or principal pending limits
- **THEN** LinkTerm returns a stable queue-full error
- **AND** no prepared effect is executed
- **AND** existing approved-unconsumed grants remain intact

#### Scenario: Prepared artifact is too large
- **WHEN** a prepared artifact exceeds the configured size limit
- **THEN** preparation fails with `PREPARE_TOO_LARGE` or equivalent safe code
- **AND** no effectful backend method is called
- **AND** any partial bytes or handles are released

### Requirement: Approval IPC and preload expose only display-safe projections
LinkTerm SHALL expose approval capabilities, snapshots, events, and resolve through typed Main IPC and a narrow preload namespace. Renderer MUST attach event listeners before snapshot hydration, ignore stale revisions, and reject malformed payloads with bounded diagnostics. IPC/preload MUST NOT expose internal authority objects or raw payloads.

#### Scenario: Renderer hydrates approval queue
- **WHEN** Renderer subscribes to approval state
- **THEN** it registers the pushed-event listener before requesting snapshot data
- **AND** applies only latest revisions
- **AND** keeps one active approval sheet with additional requests queued

#### Scenario: Malformed approval payload
- **WHEN** Main, preload, or a test fixture sends a malformed approval payload
- **THEN** Renderer records a bounded safe diagnostic
- **AND** raw payloads, stacks, prepared bytes, internal ids, or unknown fields are not retained

#### Scenario: MCP cannot resolve approval
- **WHEN** an MCP client attempts to approve or resolve a request
- **THEN** no approval resolve tool exists
- **AND** only verified Renderer approval IPC can record a human decision

### Requirement: Approval Sheet presents exact safe consequences and does not execute
LinkTerm SHALL provide an accessible Approval Sheet for pending human approval. The sheet SHALL display the requester label, action, risk, approval policy, caller acknowledgement status, target refs, argument/parameter summaries, impact summary, plan steps, artifact metadata when safe, expiry, and Approve once/Deny actions. The sheet MUST NOT expose internal fingerprints or promise rollback. Resolving the sheet MUST NOT execute the operation.

#### Scenario: User denies approval
- **WHEN** the user denies a pending request
- **THEN** LinkTerm records a denial
- **AND** the requested effect is not executed
- **AND** Activity Center can show the denial using display-safe data

#### Scenario: User approves and Renderer reloads
- **WHEN** the user approves a direct operation and Renderer reloads before continuing
- **THEN** LinkTerm shows approved-ready-to-continue state after hydration
- **AND** execution still requires the explicit continuation invocation

### Requirement: Activity distinguishes acknowledgement, human approval, and automation authorization
LinkTerm SHALL render distinct display-safe authorization labels for approval not required, client acknowledgement required, client acknowledged but not authorized, approved once by the user, and future local automation authorization. These labels MUST be distinct in visible text and screen-reader output and MUST NOT leak internal principal ids, rule ids, prepared ids, nonces, or effect fingerprints.

#### Scenario: Client acknowledged but not authorized
- **WHEN** a caller supplied `confirm=true` but no human grant has been consumed
- **THEN** Activity shows client acknowledgement separately from human approval
- **AND** it does not label the operation as approved by the user

### Requirement: MCP high-impact operations require human approval before execution in interactive mode
LinkTerm SHALL migrate existing high-impact approval-required MCP operations so `confirm=true` alone cannot execute them in `interactive-required` mode. Missing legacy acknowledgement MAY keep existing confirmation-required behavior. A valid matching approval continuation SHALL execute at most once through the existing backend boundary.

#### Scenario: High-impact debug tool is confirm-only
- **WHEN** a high-impact debug MCP tool receives `confirm=true` without a valid approval grant
- **THEN** LinkTerm returns approval-required evidence
- **AND** no `IJLinkBackend` effectful method is called

#### Scenario: Valid MCP approval continuation
- **WHEN** the correct MCP principal retries with a valid approval continuation matching the prepared effect
- **THEN** LinkTerm consumes the grant once
- **AND** calls the existing backend path exactly once

#### Scenario: Legacy client lacks approval capability
- **WHEN** a legacy client can provide `confirm=true` but not an approval continuation
- **THEN** approval-required operations fail closed with upgrade guidance or remain pending until expiry
- **AND** they do not execute from caller acknowledgement alone

### Requirement: Control Profile direct RUN/START_DOWNLOAD uses the same Broker with two-invocation continuation
LinkTerm SHALL migrate direct `CONTROL_PROFILE_RUN_DOWNLOAD` and `CONTROL_PROFILE_START_DOWNLOAD` IPC paths to the same prepared-operation Broker. Initial Download click or hard-coded `confirm:true` SHALL only prepare/request approval. `approval:resolve` SHALL NOT execute. Approved continuation MUST use the same original channel with `{ kind: 'continue-approved', approvalId }`, with RUN fixed to sync mode and START fixed to background mode.

#### Scenario: Direct download button is confirm-only
- **WHEN** the user clicks Download and the path hard-codes `confirm:true`
- **THEN** LinkTerm prepares or reuses an approval request
- **AND** does not run or start the download job

#### Scenario: Approved RUN continues explicitly
- **WHEN** the user approves a direct RUN request
- **AND** Renderer invokes the original RUN channel with `continue-approved`
- **THEN** LinkTerm consumes the matching sync grant once
- **AND** executes the existing direct RUN path once

#### Scenario: Approved START continues explicitly
- **WHEN** the user approves a direct START request
- **AND** Renderer invokes the original START channel with `continue-approved`
- **THEN** LinkTerm consumes the matching background grant once
- **AND** starts the existing background job once

#### Scenario: MCP and IPC cross-consume attempt
- **WHEN** an MCP approval id is used against the direct IPC surface or a direct IPC approval id is used against MCP
- **THEN** LinkTerm rejects the consumer
- **AND** no effectful backend call is made
- **AND** the original correct-consumer grant is preserved until TTL

### Requirement: Phase 5 is accessible, bilingual, bounded, and limited to Human Approval
LinkTerm SHALL provide English and Chinese copy for every new approval label, status, diagnostic, action, disabled reason, authorization label, plan-step message, expiry/deny/supersede text, and safe error. Approval UI SHALL support keyboard operation, distinct screen-reader text, non-color-only status, reduced-motion-safe presentation, and bounded rendering. Phase 5 MUST NOT implement J-Link/RTT journey expansion, Pause/Take Over, durable audit/export/clear, remote approval, cloud services, telemetry, database storage, generic chat UI, compensation/reflash UI, or hardware rollback promises.

#### Scenario: Approval UI is keyboard operated
- **WHEN** the user navigates pending approval by keyboard
- **THEN** queued request selection, Approve once, Deny, details expansion, and Close/return-focus controls are reachable
- **AND** each state has a readable label

#### Scenario: Phase 5 scope is inspected
- **WHEN** the Phase 5 implementation is complete
- **THEN** no new J-Link/RTT first-signal flow, Pause/Take Over lease, durable JSONL writer/export/clear implementation, database, cloud service, telemetry service, compensation/reflash UI, generic chat UI, or hardware rollback mechanism is introduced by this change
- **AND** no real flash, erase, reset, J-Link, RTT, GDB-server, serial payload write, or other hardware side-effect command is executed by Phase 5 validation
