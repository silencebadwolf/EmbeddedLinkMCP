## ADDED Requirements

### Requirement: Redacted durable activity

The Main process SHALL persist only schema-valid, display-safe `ActivityEventView` envelopes
that have passed the existing allowlist-first redaction boundary.

#### Scenario: protected values never reach JSONL

- **WHEN** an activity event contains protected argument keys, binary/base64 data, a script,
  or a workspace path
- **THEN** the durable line contains only the existing omitted item or size/hash/basename
  metadata, and contains no credential, content body, token, absolute path, or script text.

### Requirement: Default retention and rotation

The AuditStore SHALL be enabled by default, retain records for 30 days, and rotate before an
active JSONL file exceeds 10 MiB. Configuration MAY disable persistence or lower the limits.

#### Scenario: rotation preserves both records

- **WHEN** appending events would cross the configured byte limit
- **THEN** the current file is closed/rotated before the next line and both records remain
  readable through recovery and export.

### Requirement: Non-blocking serial writes

The store SHALL enqueue writes on an independent serial queue and SHALL NOT delay the ledger,
transport, MCP response, or renderer event listener while filesystem I/O is pending.

#### Scenario: filesystem failure is best effort

- **WHEN** one append fails
- **THEN** the original in-memory activity append remains successful, a bounded safe diagnostic
  is recorded, and later appends can still be attempted.

### Requirement: Restart recovery

At startup the store SHALL read only a bounded recent set, preserve valid records, ignore a
damaged trailing JSONL line with a warning, and never invent or mutate an operation terminal
state from recovered data.

#### Scenario: torn final line

- **WHEN** the active file ends in an incomplete JSON line
- **THEN** valid preceding events load, the trailing line is skipped, and status reports a
  recovery warning without throwing.

### Requirement: Main-mediated export and deletion

The Main process SHALL expose redacted export and delete-all-local-data commands. Export SHALL
write only validated retained records and return a summary without an absolute path. Clear SHALL
remove only the configured activity directory and be idempotent.

#### Scenario: export is safe and bounded

- **WHEN** a user requests JSON or JSONL export
- **THEN** Main writes the selected redacted representation, returns event count/format/path
  mode, and the result contains no internal authority values or filesystem path.

#### Scenario: clear is explicit

- **WHEN** the user confirms delete-all-local-activity
- **THEN** all local activity files are deleted, the active directory is recreated, and future
  events can be persisted again.

### Requirement: Display and accessibility

The Activity Center SHALL display persistence status and expose export/delete actions with
English and Chinese labels, keyboard access, visible non-color status, bounded diagnostics, and
no rollback or guaranteed-hardware wording.

#### Scenario: keyboard user exports and clears

- **WHEN** a keyboard user opens Activity Center and activates the export or delete control
- **THEN** each action has a distinct accessible name, visible result text, and no color-only or
  motion-only state; delete requires an explicit confirmation.

### Requirement: Performance and compatibility

Recovery/export SHALL be bounded and a 10,000-event fixture SHALL establish a recorded baseline.
Existing SessionManager, WriteQueue, Transport, JobManager, IJLinkBackend, approval broker, and
Main trust-boundary semantics SHALL remain unchanged.

#### Scenario: large recovery remains bounded

- **WHEN** the store starts with at least 10,000 valid events and a malformed tail
- **THEN** recovery returns within the documented benchmark budget, bounds memory to the configured
  recent window, preserves the valid events, and does not invoke any transport or hardware path.
