## ADDED Requirements

### Requirement: Connected means live target access

LinkTerm SHALL report a J-Link target as connected only after the configured backend obtains fresh,
positive target-access evidence for the requested target, interface, speed, and probe selection.
Creating, retaining, or finding an in-memory probe handle MUST NOT count as connection evidence.

#### Scenario: Target chip is physically absent

- **GIVEN** a J-Link probe or backend is available
- **AND** the configured target chip is unpowered, unplugged, or inaccessible over SWD/JTAG
- **WHEN** a user or workflow requests target connection
- **THEN** LinkTerm reports connection failure
- **AND** it does not create or return a connected probe handle
- **AND** the UI does not show “Chip connected”

#### Scenario: Commander exits without positive target evidence

- **WHEN** the Commander process exits without a recognized error but its output contains no
  positive target-access evidence
- **THEN** LinkTerm fails closed with a J-Link operation error
- **AND** it does not infer connection from exit code alone

#### Scenario: Existing handle is revalidated

- **GIVEN** LinkTerm retained a probe handle from an earlier successful target access
- **WHEN** connection or status is requested again after the target becomes inaccessible
- **THEN** LinkTerm revalidates hardware access
- **AND** it does not return the stale handle as connected

### Requirement: Physical discovery does not invent connected targets

LinkTerm SHALL distinguish physical J-Link probe visibility from target-chip connectivity.

#### Scenario: Physical probe is visible but target is disconnected

- **WHEN** SEGGER ShowEmuList reports a physical probe but no target-access check has succeeded
- **THEN** discovery reports the probe as visible and not target-connected
- **AND** stale in-memory handles do not override that state

### Requirement: Numeric download progress is evidence-backed

LinkTerm SHALL display a numeric download percentage only when it is parsed from current streamed
Commander output, or when the full operation reaches a successful terminal state. It MUST NOT
invent percentages from UI phase, elapsed time, workflow step count, or failure state.

#### Scenario: Running stage has no Commander percentage

- **WHEN** a download is preparing, erasing, verifying, or reading back
- **AND** Commander has not emitted a numeric percentage
- **THEN** LinkTerm shows the current stage without a numeric percentage
- **AND** the progress fill does not imply advancement

#### Scenario: Commander emits a programming percentage

- **WHEN** streamed Commander output contains a valid programming percentage
- **THEN** LinkTerm may display that percentage for the current programming stage
- **AND** it does not derive a hardware byte count from that percentage

#### Scenario: Download fails

- **WHEN** the job fails before terminal success
- **THEN** LinkTerm shows a failed state
- **AND** it does not render 100% solely because the job is terminal

### Requirement: Completion wording states verification truth

LinkTerm SHALL distinguish a verified firmware result from an unverified Commander completion.

#### Scenario: Readback verification succeeds

- **WHEN** requested verification produces positive verify evidence and byte-for-byte readback match
- **THEN** LinkTerm may report the download as verified

#### Scenario: Verification was not requested

- **WHEN** Commander completes the download but verification was not requested
- **THEN** LinkTerm reports that the command completed without verification
- **AND** it does not claim verified firmware contents
