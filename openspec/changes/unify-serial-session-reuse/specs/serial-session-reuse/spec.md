## ADDED Requirements

### Requirement: One physical serial resource has one active managed session

LinkTerm SHALL route every serial open request from MCP, renderer IPC, saved connections, saved
workspaces, control-profile activation, and control workflows through one Main-owned coordination
boundary. The boundary SHALL reuse an existing managed session when the normalized complete serial
configuration matches and its state is `idle`, `opening`, or `open`.

#### Scenario: AI opens before a saved connection

- **GIVEN** AI has an open serial session for COM7 with a saved connection's complete configuration
- **WHEN** the user opens that saved connection
- **THEN** LinkTerm returns the existing session id with `reused=true`
- **AND** it does not add a second terminal tab

#### Scenario: AI opens before a saved full workspace

- **GIVEN** AI has an open serial session matching a saved full workspace's serial configuration
- **WHEN** the user opens that workspace
- **THEN** LinkTerm binds the workspace observation to the existing session id
- **AND** human and AI activity remains in the same transcript and write queue

#### Scenario: Human opens before AI

- **GIVEN** a user already has a matching serial terminal open
- **WHEN** AI calls `open_session` or activates the matching control profile
- **THEN** LinkTerm returns the human-opened session id with `reused=true`

#### Scenario: Repeated activation is idempotent

- **WHEN** the same serial-enabled control profile or saved workspace is activated repeatedly
- **THEN** every successful activation refers to the same active session id
- **AND** no additional tab is created

### Requirement: Serial identity uses the complete normalized configuration

LinkTerm SHALL compare normalized port, baud rate, mode, data bits, stop bits, parity, RTS/CTS,
XON, and XOFF. Omitted optional fields SHALL compare using the transport's effective defaults.

#### Scenario: Equivalent explicit and default parameters

- **GIVEN** an active session uses omitted optional serial parameters
- **WHEN** another entry requests the same port with explicit transport-default parameters
- **THEN** LinkTerm treats both requests as the same complete serial configuration
- **AND** it reuses the active session

#### Scenario: Same port has different parameters

- **GIVEN** an idle, opening, or open session owns a physical serial port
- **WHEN** another entry requests that port with a different normalized serial parameter
- **THEN** LinkTerm returns `SERIAL_SESSION_CONFLICT` with non-sensitive existing/requested facts
- **AND** it does not create or retain an errored session tab for the rejected request

#### Scenario: Different ports remain independent

- **WHEN** requests open two different physical serial ports
- **THEN** LinkTerm may open both sessions independently
- **AND** neither request is reported as a conflict with the other

### Requirement: Concurrent serial opens are single-flight per physical port

LinkTerm SHALL serialize overlapping open requests for one normalized physical port while allowing
different ports to progress independently.

#### Scenario: Equivalent requests overlap

- **WHEN** two equivalent requests for the same physical port overlap before open completes
- **THEN** LinkTerm creates at most one managed session
- **AND** both callers receive the same session id
- **AND** the joined caller receives `reused=true`

#### Scenario: Conflicting requests overlap

- **WHEN** two requests with different complete configurations overlap for the same physical port
- **THEN** one request owns the in-flight open and the other receives `SERIAL_SESSION_CONFLICT`
- **AND** the rejected request does not call the serial transport factory

### Requirement: Terminal sessions are reusable only while active

LinkTerm SHALL NOT reuse a `closed` or `errored` serial session. A later matching request MAY create
a fresh session according to the requesting entry's existing failure-display semantics.

#### Scenario: Matching errored tab exists

- **GIVEN** a previous matching serial session is `errored`
- **WHEN** a new matching request is made
- **THEN** LinkTerm does not return the errored session as reused

#### Scenario: Matching closed session exists

- **GIVEN** a previous matching serial session is `closed`
- **WHEN** a new matching request is made
- **THEN** LinkTerm does not return the closed session as reused

### Requirement: Reuse is observable without changing terminal ownership

Successful serial open responses SHALL expose whether the session was reused. Reuse SHALL NOT
change `SessionManager`, `WriteQueue`, transport ownership, transcript origin metadata, terminal
focus, or human input availability.

#### Scenario: AI reuses the user's terminal

- **WHEN** an AI open request reuses a human-opened serial session
- **THEN** AI writes continue through the shared `SessionManager` and `WriteQueue`
- **AND** the user can still focus and type in the same terminal
- **AND** both parties observe the same device transcript
