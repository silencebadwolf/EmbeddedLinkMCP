## ADDED Requirements

### Requirement: device prompt text is display-faithful by default

The renderer SHALL preserve the position, order, and repetition of device-origin
shell prompt text. It MUST NOT insert or remove line breaks, collapse prompts, or
delay ordinary ASCII text based on `msh >` or another shell-specific token.

#### Scenario: prompt is embedded in newline-free device output

- **WHEN** a device event contains `ui=SKIPPEmsh >`
- **THEN** xterm receives `ui=SKIPPEmsh >` in that order
- **AND** the renderer does not insert a line break before the prompt

#### Scenario: prompt is split across device events

- **WHEN** consecutive device events contain `m`, `sh`, and ` >`
- **THEN** each event is rendered in arrival order without an idle prompt timer
- **AND** their combined visible text remains `msh >`

#### Scenario: device repeats a prompt

- **WHEN** device output contains `msh >\r\nmsh >`
- **THEN** both prompts remain visible
- **AND** the existing device line break is preserved exactly once

### Requirement: generic terminal safeguards remain intact

Removing shell-specific prompt rewriting MUST NOT remove raw transcript storage,
streaming UTF-8 decoding, outgoing AI/human input visibility, echo de-duplication,
or existing ANSI containment at real device line breaks.

#### Scenario: outgoing input is followed by a device echo

- **WHEN** an AI or human write is locally displayed and the device echoes it
- **THEN** the input remains visible once
- **AND** subsequent non-echo device output remains visible in arrival order
