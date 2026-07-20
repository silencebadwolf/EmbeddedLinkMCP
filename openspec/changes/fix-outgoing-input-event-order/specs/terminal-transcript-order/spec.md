## ADDED Requirements

### Requirement: outgoing transcript precedes synchronous device echo

The session write boundary SHALL append the outgoing human or AI data event
before invoking the transport writer. A device event emitted synchronously from
that writer SHALL therefore receive a later transcript sequence.

#### Scenario: serial transport echoes during write

- **WHEN** a session writes `mstart` and the transport emits `mstart` or other
  device bytes synchronously from `write()`
- **THEN** the transcript contains the outgoing event before the device event
- **AND** the renderer displays the command before the response
- **AND** existing device-echo de-duplication remains active

#### Scenario: writer failure

- **WHEN** the transport writer rejects after the outgoing event is registered
- **THEN** the outgoing attempt remains visible
- **AND** a non-fatal system writer error is appended
- **AND** the next queued write can still execute
