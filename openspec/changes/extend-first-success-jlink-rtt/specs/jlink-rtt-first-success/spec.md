## ADDED Requirements

### Requirement: J-Link/firmware/RTT readiness uses read-only display-safe providers
LinkTerm SHALL extend Runtime Readiness with J-Link, firmware, and RTT-specific checks using
read-only Main/core providers. These checks SHALL isolate provider failures, preserve the
generation/latest-wins readiness model, and publish only display-safe facts. Readiness MUST
NOT connect probes, reset/halt/run targets, flash/erase/write memory, start GDB servers,
connect/read RTT, open terminal sessions, mutate workspace/profile files, install tools, or
execute external tasks.

#### Scenario: J-Link backend is unavailable
- **WHEN** readiness refresh runs without an injected usable J-Link backend
- **THEN** the snapshot includes a J-Link check with an unavailable or action-required status
- **AND** serial/runtime/workspace checks remain present if their providers succeeded
- **AND** no J-Link, RTT, GDB, session, flash, erase, reset, or workspace mutation method is called

#### Scenario: Probe and target facts are partial
- **WHEN** probe discovery or target catalog evidence is missing, ambiguous, or conflicting with the workspace profile
- **THEN** LinkTerm marks the candidate as requiring user confirmation
- **AND** shows safe evidence and confidence
- **AND** it does not auto-select a probe or infer target identity from list position, COM name, or prior unrelated sessions

#### Scenario: Firmware facts are unsafe or unavailable
- **WHEN** firmware is missing, outside the allowed workspace boundary, oversized, unparseable, or has unsupported format metadata
- **THEN** readiness reports a firmware-specific diagnostic and recovery action
- **AND** no approval request or hardware effect is created by readiness alone

### Requirement: J-Link/RTT download-and-observe drafts preserve provenance without authorizing effects
LinkTerm SHALL create display-safe J-Link/RTT download-and-observe drafts that preserve the
source and current revision of workspace/profile, target/interface/speed, probe binding
evidence, firmware basename/hash/size/format/base address/verify intent, and RTT observation
configuration. Drafts are reviewable planning data only and MUST NOT grant authorization.

#### Scenario: User reviews a download-and-observe plan
- **WHEN** a user chooses a J-Link/RTT candidate or workspace profile
- **THEN** LinkTerm displays a plan with safe target, firmware, flash/verify, reset, and RTT observation steps
- **AND** the plan identifies which values came from workspace profile, live discovery, device catalog, request input, or defaults
- **AND** it does not expose firmware bytes, J-Link serial numbers, private paths, scripts, credentials, raw SEGGER output, or internal fingerprints

#### Scenario: Draft facts change before execution
- **WHEN** target binding, probe binding, firmware source/hash/size/format/base address, profile revision/defaults, workflow mode, or RTT configuration changes after a draft is shown
- **THEN** the previous draft cannot authorize execution
- **AND** LinkTerm requires revalidation and a fresh approval-bound prepared operation

### Requirement: New guided Download, Flash, and Reflash entry points use the Human Approval Broker
LinkTerm SHALL route every new Phase 6 guided Download, Flash, and Reflash entry point
through the Phase 5 `PreparedOperation` and Approval Broker model. A Renderer button click,
legacy `confirm=true`, Activity action, job retry, profile suggestion, or compensation summary
MUST NOT execute a high-impact operation without a valid matching one-time grant. Approved
execution MUST consume the grant through the original execution surface and existing backend
path exactly once.

#### Scenario: Guided download is clicked in desktop mode
- **WHEN** the user activates a new guided J-Link/RTT Download or Flash CTA in `interactive-required` mode
- **THEN** LinkTerm prepares or reuses a pending approval request
- **AND** no `IJLinkBackend`, RTT, GDB, flash, reset, session-open, or job-start effectful method is called
- **AND** Approval Sheet shows the display-safe plan and consequences

#### Scenario: Approved continuation executes once
- **WHEN** the verified human approves the pending operation
- **AND** the original execution surface retries with the matching approval continuation
- **THEN** LinkTerm consumes the grant once
- **AND** invokes the existing workflow or backend path once
- **AND** replaying the same continuation does not reexecute the effect

#### Scenario: Wrong consumer or changed effect retries
- **WHEN** principal, continuation kind, surface, execution mode, target/probe binding, firmware source/hash, profile/defaults, manifest digest, or RTT plan differs from the approved operation
- **THEN** LinkTerm rejects or supersedes according to the Broker contract
- **AND** no effectful backend call is made for the mismatched attempt
- **AND** a wrong consumer does not destroy the correct consumer's still-valid grant

### Requirement: Download-and-observe execution reuses existing control workflow and J-Link boundaries
LinkTerm SHALL execute J-Link/RTT download-and-observe through existing control workflow,
job manager, manager, session, and `IJLinkBackend` boundaries. Phase 6 MUST NOT spawn SEGGER
processes, run VS Code tasks, call shell flash tools, parse arbitrary task-terminal output, or
operate on serial/J-Link resources outside existing LinkTerm abstractions.

#### Scenario: Workflow runs after approval
- **WHEN** a matching approval continuation starts a download-and-observe workflow
- **THEN** LinkTerm records structured connect, flash, verify, reset, RTT observe, and diagnostic steps through existing job/activity projections
- **AND** each J-Link/RTT hardware action is invoked through `IJLinkBackend`
- **AND** existing `ControlWorkflowJobManager` lifecycle and AbortSignal handling remain authoritative

#### Scenario: Hardware-facing step fails
- **WHEN** connect, flash, verify, reset, GDB server, RTT connect, RTT read/search, or diagnostic capture fails
- **THEN** the workflow records the failed step, safe error code, and specialized next action
- **AND** does not update known-good compensation evidence for that failed deployment

### Requirement: RTT first signal uses specialized diagnostics and is not confused with serial first signal
LinkTerm SHALL represent RTT observation as a J-Link/RTT-specific first-success path. RTT
silent, RTT connect failure, RTT read/search failure, and no RTT channel MUST use specialized
diagnostics and recovery actions. Serial-first-signal copy, COM-port assumptions, and xterm
serial visibility rules MUST NOT be reused as proof of RTT success unless the RTT output is
actually surfaced through the existing RTT log/terminal display path with display-safe
evidence.

#### Scenario: RTT output is observed
- **WHEN** the approved workflow observes non-empty RTT output or a configured RTT marker for the current target binding
- **THEN** LinkTerm records an RTT-specific signal-visible milestone
- **AND** Activity/first-success UI can show that the signal came from RTT rather than serial

#### Scenario: RTT remains silent
- **WHEN** RTT observation reaches its configured silence window without output
- **THEN** LinkTerm reports `rtt-silent` or equivalent specialized state
- **AND** offers keep-waiting, diagnose, edit RTT config, or open RTT log guidance as applicable
- **AND** it does not claim workflow success solely because flash or reset completed

### Requirement: Verified success creates Main-only known-good CompensationCandidate summaries
LinkTerm SHALL create or update a Main-only known-good `CompensationCandidate` only after a
download-and-observe workflow has verified the deployment for the exact target binding. A new
deployment in progress MUST NOT erase the previous known-good candidate. Failed, skipped,
unknown, or unverified results MUST NOT overwrite known-good evidence. Renderer receives only
display-safe summaries and MUST NOT receive rollback-capable objects.

#### Scenario: Flash and verify succeed
- **WHEN** a workflow completes flash and verify for a target binding and observation mode according to the plan
- **THEN** Main records a known-good candidate bound to target/probe evidence, profile revision/defaults, firmware source/hash/size/format/base address, workflow mode, and manifest digest
- **AND** Renderer receives only a safe summary with no internal digests, firmware bytes, J-Link serial numbers, backend handles, or rollback promise

#### Scenario: New deployment fails
- **WHEN** a later deployment attempt fails before verified success
- **THEN** LinkTerm keeps the previous known-good candidate if it has not expired or been invalidated
- **AND** it does not replace that candidate with failed or unknown evidence

#### Scenario: Reflash summary is stale
- **WHEN** the current firmware source/hash, target binding, profile revision/defaults, workflow mode, or manifest digest no longer matches the known-good candidate
- **THEN** LinkTerm hides or disables the reflash CTA with a safe reason
- **AND** clicking cannot execute or prepare a stale reflash effect

### Requirement: Reflash recovery is a new approval-bound operation, not rollback
LinkTerm SHALL treat any reflash recovery CTA as a new high-impact operation prepared from a
currently matching known-good candidate. Reflash MUST require human approval, bind a fresh
effect fingerprint, consume a one-time grant, and execute only through existing workflow and
`IJLinkBackend` boundaries. UI copy MUST avoid promising rollback or guaranteed recovery.

#### Scenario: Matching known-good candidate offers reflash
- **WHEN** a known-good candidate still matches current source/hash/target/profile/workflow evidence
- **AND** the user activates Reflash
- **THEN** LinkTerm prepares a new approval request with the reflash plan
- **AND** no backend effect executes until a matching approved continuation consumes the grant

#### Scenario: Reflash is approved and replayed
- **WHEN** a matching reflash grant is consumed successfully once
- **THEN** the existing workflow/backend path runs once
- **AND** replaying the same continuation produces a consumed/already-used result with zero effectful backend calls

### Requirement: Verified J-Link/RTT success can suggest profile updates without auto-saving or proving identity
LinkTerm SHALL ensure any workspace/control profile suggestion created after verified
J-Link/RTT success uses existing profile/workspace managers, requires user confirmation,
stores only supported non-sensitive fields, and is not required for first-success completion
or future authorization.

#### Scenario: Profile suggestion is shown
- **WHEN** verified success provides useful target, firmware, RTT, or workflow defaults
- **THEN** LinkTerm shows a display-safe suggestion with provenance
- **AND** the user can save or skip it
- **AND** skipping does not invalidate the completed journey

#### Scenario: Profile save fails
- **WHEN** the user confirms a profile suggestion but the save fails
- **THEN** LinkTerm reports a safe save failure
- **AND** does not roll back first-success completion, approval state, or known-good evidence

### Requirement: Phase 6 UI is accessible, bilingual, bounded, and limited to J-Link/RTT scope
LinkTerm SHALL provide English and Chinese copy for every new J-Link/RTT readiness label,
diagnostic, plan step, approval action, recovery action, Activity label, compensation summary,
profile suggestion, disabled reason, and safe error. Phase 6 UI SHALL support keyboard
operation, readable status labels, non-color-only state, reduced-motion-safe progress, focus
return, non-stealing late updates, and bounded rendering for large probe/step/diagnostic lists.
Phase 6 MUST NOT implement Pause/Take Over, durable audit/export/clear, cloud services,
telemetry, database storage, generic chat UI, external installer flows, or hardware rollback
promises.

#### Scenario: User navigates J-Link/RTT flow by keyboard
- **WHEN** the user navigates readiness, plan review, approval-required states, workflow progress, RTT silent recovery, reflash summary, and profile suggestion by keyboard
- **THEN** all controls are reachable and have readable labels
- **AND** RTT silent is distinguishable from serial silent in visible and screen-reader text

#### Scenario: Phase 6 scope is inspected
- **WHEN** the Phase 6 implementation is complete
- **THEN** no Pause/Take Over lease, durable JSONL writer/export/clear, database, cloud service, telemetry service, generic chat UI, external installer, arbitrary script repair, or rollback guarantee is introduced by this change
- **AND** no real flash, erase, reset, J-Link, RTT, GDB server, serial payload write, or other hardware side-effect command is executed by Phase 6 validation
