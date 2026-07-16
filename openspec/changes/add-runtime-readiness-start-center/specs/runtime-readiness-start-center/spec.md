## ADDED Requirements

### Requirement: Runtime Readiness aggregates safe read-only facts
LinkTerm SHALL provide a Main/core Runtime Readiness model that aggregates safe read-only runtime, serial, optional workspace/profile, reusable session, and agent-integration facts into a versioned display-safe snapshot. Provider failures, timeouts, aborts, and missing optional inputs MUST be represented as independent checks/diagnostics and MUST NOT erase unrelated provider results. Readiness MUST NOT perform connection, serial write, reset, flash, install, J-Link/RTT/GDB launch, workspace mutation, profile mutation, approval, pause, audit export, or rollback behavior.

#### Scenario: Providers return partial results
- **WHEN** serial discovery succeeds but optional workspace/profile inspection fails
- **THEN** the snapshot includes the serial facts and candidates
- **AND** the workspace/profile check reports an action-required or unavailable status with a safe diagnostic
- **AND** the failed provider does not force the whole snapshot to unavailable

#### Scenario: Readiness is refreshed while an older provider is still running
- **WHEN** refresh generation N+1 starts before generation N finishes
- **THEN** generation N+1 is the only generation that may update current readiness state
- **AND** late generation N results are ignored or recorded as stale diagnostics without replacing newer facts

#### Scenario: Readiness has no hardware side effects
- **WHEN** readiness get, subscribe, or refresh is invoked
- **THEN** LinkTerm does not create/open a session, reserve a port, write to a transport, toggle DTR/RTS, reset, flash, start J-Link/RTT/GDB, install tooling, or mutate workspace/profile files

#### Scenario: Optional workspace is absent
- **WHEN** no workspace root or saved profile is available
- **THEN** readiness still returns runtime and serial checks
- **AND** the workspace/profile check is optional rather than blocking serial observation

### Requirement: Device candidates and Serial ConnectionDrafts preserve evidence and do not auto-submit
LinkTerm SHALL resolve display-safe device candidates from live serial discovery, saved profile/workspace hints, reusable sessions, and manual input. Candidate confidence MUST distinguish `exact`, `likely`, and `unknown`; a single visible port MUST NOT by itself be treated as exact. Serial ConnectionDrafts MUST preserve parameter sources, candidate/manual origin, and connection side-effect metadata across Start Center, advanced form, and session creation handoff. LinkTerm MUST NOT silently select the first candidate or infer MCU target from a COM port name.

#### Scenario: Multiple candidates are present
- **WHEN** two or more serial candidates are detected
- **THEN** Start Center presents each candidate with safe evidence and confidence
- **AND** no candidate is auto-submitted
- **AND** the user must explicitly choose or enter a manual port before an existing connection action can run

#### Scenario: Saved profile conflicts with live evidence
- **WHEN** a saved profile references settings or device identity that conflict with current live discovery
- **THEN** the candidate is marked as requiring user confirmation
- **AND** the UI shows both facts using display-safe summaries
- **AND** LinkTerm does not silently apply the stale profile

#### Scenario: Manual port entry is used
- **WHEN** the user enters a port manually
- **THEN** the draft source is `manual`
- **AND** the draft records explicit source/default metadata for serial parameters
- **AND** the manual draft can be reviewed or passed to the existing advanced connection flow without losing non-sensitive values

#### Scenario: Connection side effects are described
- **WHEN** a serial draft is reviewed or used to prefill a connection flow
- **THEN** the draft includes display-safe metadata that connection reserves the port, sends no payload during connect, and may apply DTR/RTS/control-line behavior when configured or known

### Requirement: Readiness IPC and preload expose strict display-safe snapshots with generation semantics
LinkTerm SHALL expose readiness to Renderer through typed Main IPC and a narrow preload namespace. The renderer MUST attach the pushed-event listener before subscribing, hydrate from the returned snapshot, ignore stale generations, and reject malformed payloads with safe diagnostics. IPC/preload MUST expose only display-safe DTOs and MUST NOT expose `ipcRenderer`, raw provider objects, raw errors/stacks, full paths beyond approved aliases/basenames, credentials, scripts, firmware/binary data, terminal transcript, or Main-only approval/lease/compensation objects.

#### Scenario: Renderer subscribes to readiness
- **WHEN** the renderer initializes readiness state
- **THEN** it registers the local event listener before invoking readiness subscribe
- **AND** it hydrates from the returned snapshot
- **AND** pushed events with a newer generation are applied
- **AND** stale events are discarded without corrupting state

#### Scenario: Malformed readiness data is received
- **WHEN** an invoke response or pushed event fails the shared readiness schema
- **THEN** renderer readiness state records a bounded safe diagnostic
- **AND** the malformed data is not retained
- **AND** no raw internal payload, stack, or unknown field is exposed to React state

#### Scenario: Renderer unsubscribes or window is destroyed
- **WHEN** the renderer unsubscribes or its `webContents` is destroyed
- **THEN** Main stops sending readiness events to that subscriber
- **AND** repeated unsubscribe or send-race cleanup is idempotent

### Requirement: Start Center replaces the no-session empty state with a task-oriented readiness entry
LinkTerm SHALL show Start Center in the main canvas when there is no active session. Start Center MUST present one primary task intent, a compact readiness checklist, safe candidate/recent suggestions, manual entry and refresh options, and an `Advanced connection…` path to the existing ConnectionDialog. It MUST avoid flickering “no device” before discovery completes and MUST NOT take over the main canvas when an active session exists.

#### Scenario: App opens with no active session
- **WHEN** LinkTerm has no active session
- **THEN** the main canvas shows Start Center instead of a simple transport-oriented empty state
- **AND** Start Center begins in a loading/checking presentation until readiness facts arrive
- **AND** it does not show “no device” until serial discovery has actually completed empty

#### Scenario: User chooses advanced connection
- **WHEN** the user activates `Advanced connection…`
- **THEN** LinkTerm opens the existing ConnectionDialog
- **AND** the advanced/professional connection path remains available
- **AND** no readiness-only action creates a session without the user's explicit existing connection action

#### Scenario: Active session exists
- **WHEN** at least one active session exists
- **THEN** the terminal/session view remains the primary canvas
- **AND** Start Center is available only through an explicit entry point
- **AND** readiness updates do not steal focus from the terminal

#### Scenario: Phase 4 first-signal model is absent
- **WHEN** the user activates the Phase 3 primary observe-device intent
- **THEN** LinkTerm either opens/prefills the existing connection flow or keeps the intent behind a feature flag
- **AND** it does not display first-signal steps, waiting-for-signal states, signal-visible success, or journey-completed claims

### Requirement: Versioned readiness preferences are safe hints only
LinkTerm SHALL store Start Center/recent readiness preferences through a dedicated versioned adapter. Preferences MAY include recent workspace/profile aliases, dismissed hint ids, and non-sensitive draft hints. Corrupt, oversized, unknown-version, or unsafe preference payloads MUST fall back to safe defaults with diagnostics. Preferences MUST NOT prove readiness, auto-connect, block scanning, or store credentials/raw config/raw paths beyond approved aliases.

#### Scenario: Preferences are corrupt
- **WHEN** the readiness preferences file cannot be parsed or fails schema validation
- **THEN** LinkTerm returns safe default preferences
- **AND** readiness includes a bounded diagnostic
- **AND** Start Center still refreshes live readiness facts

#### Scenario: Preferences mention a recent profile
- **WHEN** a recent profile hint is available
- **THEN** Start Center may show a “continue” suggestion with display-safe parameters
- **AND** the suggestion is checked against current readiness facts before use
- **AND** it is not automatically connected

### Requirement: Phase 3 is accessible, bilingual, bounded, and limited to readiness/start-center scope
LinkTerm SHALL provide English and Chinese UI copy for all new Phase 3 labels, statuses, diagnostics, actions, disabled reasons, candidates, drafts, and errors. Start Center SHALL support keyboard operation, distinct status text, focus return for dialogs, reduced-motion-safe presentation, and bounded rendering for large candidate/check/recent lists. Phase 3 MUST NOT implement First Signal completion, Human Approval, J-Link/RTT-specific readiness, Pause/Take Over, durable audit/export/clear, cloud services, default telemetry, database storage, or rollback promises.

#### Scenario: Start Center is keyboard operated
- **WHEN** the user navigates Start Center by keyboard
- **THEN** the primary task, refresh, candidate controls, manual port entry, and advanced connection path are reachable
- **AND** loading, empty, error, blocked, and ready states have readable labels

#### Scenario: Large readiness lists are displayed
- **WHEN** readiness contains many checks, candidates, recent entries, or diagnostics
- **THEN** Start Center renders a bounded visible subset or virtualized list
- **AND** terminal-adjacent rendering remains responsive in focused tests

#### Scenario: Phase 3 scope is inspected
- **WHEN** the Phase 3 implementation is complete
- **THEN** no `firstSignal:*` monitor/status/completion, `PreparedOperation`, grant, authorization record, pause lease, J-Link/RTT download-observe readiness, durable JSONL writer, export/clear implementation, database, cloud service, telemetry service, or hardware rollback mechanism is introduced by this change
- **AND** no real flash, erase, reset, J-Link, RTT, GDB-server, serial-write, or hardware-observe command is executed by Phase 3 validation
