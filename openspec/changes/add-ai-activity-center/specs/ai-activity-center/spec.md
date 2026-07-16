## ADDED Requirements

### Requirement: Activity Center hydrates from the Main-owned display-safe activity bridge
LinkTerm SHALL build the renderer Activity Center from the Phase 1 preload activity namespace and display-safe DTOs only. The renderer MUST attach its pushed-event listener before subscribing, buffer events while the subscribe request is pending, replace local state from the returned snapshot cut, discard buffered events at or below that cursor, and apply only newer contiguous events. Runtime changes, invalid cursors, sequence gaps, malformed payloads, and subscription failures MUST produce a safe local diagnostic and resnapshot path rather than silent history corruption.

#### Scenario: Renderer subscribes without losing concurrent events
- **WHEN** the Activity Center initializes
- **THEN** it registers the pushed-event listener before invoking `activity.subscribe`
- **AND** any pushed events received before the subscription snapshot resolves are buffered
- **AND** events at or below the returned snapshot cursor are discarded
- **AND** newer contiguous events are applied exactly once

#### Scenario: Renderer reloads with a prior cursor
- **WHEN** the renderer recreates activity state after a reload
- **THEN** it requests a snapshot/read-since from the last known cursor when available
- **AND** it falls back to a fresh snapshot if Main reports reset, truncation, or cursor mismatch
- **AND** the UI marks history as truncated when the snapshot says the full retained window is not available

#### Scenario: A sequence gap is observed
- **WHEN** a pushed event sequence is not the next expected sequence for the current runtime
- **THEN** the reducer does not append it as if history were contiguous
- **AND** the hydration controller requests a fresh snapshot
- **AND** a bounded display diagnostic is available without exposing raw internal payloads

#### Scenario: Malformed preload data is received
- **WHEN** subscribe, snapshot, or event data fails the Phase 1 runtime parser
- **THEN** the Activity Center stores a safe local error state
- **AND** no subscriber event mutates the retained event list
- **AND** no `ipcRenderer`, raw event, stack, or unknown field is exposed to React state

### Requirement: Default activity presentation emphasizes active, attention, and task groups
LinkTerm SHALL present a default Activity Center view that highlights active work, attention-needed terminal states, pending approval states when present in display-safe data, and task/workflow groups. Ordinary read-only bursts MUST be folded by default, but every retained operation and call attempt MUST remain queryable within the retained Phase 1 window through history, filters, or detail expansion.

#### Scenario: Active operation appears in the default view
- **WHEN** an operation is running, queued, blocked, awaiting approval, or cancel-requested in the retained activity state
- **THEN** the default drawer view includes a top-level active or pending card for it
- **AND** the card shows actor, safe action label, phase, risk, safe target alias, and elapsed/started time when available

#### Scenario: Attention-needed terminal appears in the default view
- **WHEN** an operation ends as failed, rejected, denied, expired, superseded, interrupted, cancelled, or otherwise needs user attention
- **THEN** the default drawer view includes a safe attention card
- **AND** the card can expand to show display-safe error code/message code, phase, related calls, and suggested next action if present

#### Scenario: Read-only burst is folded
- **WHEN** several adjacent read-only operations share a compatible actor, surface/action family, target alias, and time window
- **THEN** the default view may show them as one folded group
- **AND** expanding or filtering the group reveals each retained operation/call attempt
- **AND** folding never changes operation/call identity, phase, or queryability

#### Scenario: History filter reveals retained calls
- **WHEN** the user switches to history or applies filters by actor, risk, phase, action, session, workspace, target, or search text
- **THEN** all retained matching operations and call attempts are reachable
- **AND** the UI does not require raw terminal output, raw paths, raw evidence, or Main-only objects to answer the query

### Requirement: Activity Center renders workflow steps and safe details without mirroring raw evidence
LinkTerm SHALL render workflow milestones, progress, and step summaries when they are present in display-safe activity events. Activity details MUST use allowlisted fields only and MUST NOT mirror terminal transcript, raw command/script text, raw file paths beyond approved aliases/basenames, screenshots, firmware/binary data, raw errors, stacks, credentials, tokens, internal policy diagnostics, or arbitrary evidence bodies.

#### Scenario: Workflow operation has milestones
- **WHEN** a workflow operation includes display-safe milestone/progress events
- **THEN** the drawer groups them under that operation
- **AND** step status/progress is shown from stable message codes and bounded summaries
- **AND** missing or unknown step data falls back to a safe unknown-state label

#### Scenario: Detail view is expanded
- **WHEN** a user expands an operation or call detail
- **THEN** LinkTerm shows only display-safe DTO fields and derived safe summaries
- **AND** unknown fields from malformed or future payloads are absent
- **AND** no raw evidence, raw terminal output, raw script, raw binary, raw stack, credential, token, or internal authorization object appears

### Requirement: AI status capsule and session origin entry open filtered Activity Center views
LinkTerm SHALL provide a compact AI status capsule and shall upgrade the session origin indicator into an accessible Activity Center entry. The capsule MUST summarize the highest-priority activity state without flickering for low-value read-only bursts. Clicking the capsule opens the Activity Center. Clicking a session origin entry opens the Activity Center filtered to that session while preserving existing origin-dot semantics.

#### Scenario: AI is idle
- **WHEN** there are no active, pending, or attention-needed AI activities
- **THEN** the capsule exposes an idle label and does not animate due to ordinary retained history

#### Scenario: AI has running or attention-needed activity
- **WHEN** AI activity is running or needs attention
- **THEN** the capsule exposes a distinct accessible status text
- **AND** clicking or keyboard-activating it opens the drawer
- **AND** read-only bursts do not repeatedly steal visual priority from the meaningful status

#### Scenario: User opens Activity Center from a session origin indicator
- **WHEN** a user activates the origin indicator for a session tab
- **THEN** the drawer opens with a session filter applied
- **AND** the origin indicator still renders AI/Human/System origin dots with improved accessible name

### Requirement: Phase 2 context actions are safe and explicit
LinkTerm SHALL provide `Go to session`, `Diagnose`, and `Copy summary` context actions for activity items when display-safe data supports them. Unavailable actions MUST be disabled with a reason. These actions MUST NOT add new hardware, flash, erase, reset, GDB-server, RTT, serial-write, approval, or rollback behavior in Phase 2.

#### Scenario: Go to session is available
- **WHEN** an activity item references a display-safe session target that still exists in the renderer session store
- **THEN** `Go to session` is enabled
- **AND** activating it focuses that existing session tab
- **AND** no new session is created by the action

#### Scenario: Diagnose is unavailable for an item
- **WHEN** no safe existing diagnostic route is available for an activity item
- **THEN** `Diagnose` is disabled with an explanatory reason
- **AND** activating or rendering the disabled action cannot trigger hardware/backend side effects

#### Scenario: Copy summary is used
- **WHEN** the user activates `Copy summary`
- **THEN** LinkTerm copies a bounded, redacted, display-safe summary
- **AND** the copied text excludes raw terminal output, raw paths beyond approved aliases/basenames, raw evidence, stacks, credentials, tokens, scripts, screenshots, firmware bytes, and binary data

### Requirement: Activity Center is accessible, bilingual, and bounded for large retained histories
LinkTerm SHALL provide English and Chinese UI copy for all new Phase 2 labels, statuses, filters, actions, disabled reasons, and errors. The Activity Center SHALL support keyboard operation, focus placement, Escape close, screen-reader-distinct status text, reduced-motion-safe indicators, and bounded rendering for large retained histories so xterm input and scrolling are not degraded.

#### Scenario: Drawer opens by keyboard
- **WHEN** the capsule or session origin entry is keyboard-activated
- **THEN** focus moves into the Activity Center drawer
- **AND** Escape closes the drawer and returns focus to the invoking control when possible

#### Scenario: Reduced motion is preferred
- **WHEN** reduced motion is enabled
- **THEN** the Activity Center avoids required animation for status comprehension
- **AND** status remains available through text, role, and stable visual state

#### Scenario: Large retained history is displayed
- **WHEN** the retained window contains thousands of events
- **THEN** LinkTerm renders a bounded or virtualized visible subset
- **AND** ordinary terminal UI remains responsive in automated performance-oriented tests
- **AND** the user can still query retained operations through filters/history/details

### Requirement: Phase 2 does not implement later-phase authority or persistence
LinkTerm SHALL keep Phase 2 read-only with respect to authority and durability. It MUST NOT implement Runtime Readiness/Start Center, Serial First Signal completion, Human Approval Broker, approval continuation, grants, Pause/Take Over, capability-aware Stop, durable JSONL audit, export/clear, cloud services, remote approval, default telemetry, databases, or hardware rollback promises.

#### Scenario: Phase 2 scope is inspected
- **WHEN** the Phase 2 implementation is complete
- **THEN** no `PreparedOperation`, `Grant`, `AuthorizationRecord`, `CallerPrincipalId`, `Lease`, `CompensationCandidate`, JSONL writer, export/clear implementation, database, cloud service, telemetry service, or hardware rollback mechanism is introduced into renderer activity state
- **AND** no real flash, erase, reset, J-Link, RTT, serial, GDB-server, or hardware-observe command is executed by Phase 2 validation
