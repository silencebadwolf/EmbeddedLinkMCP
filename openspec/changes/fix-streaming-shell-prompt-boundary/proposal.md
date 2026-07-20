# Preserve terminal prompt fidelity

## Why

The renderer currently recognizes the RT-Thread-specific text `msh >`, buffers
possible prompt prefixes, inserts line breaks, and collapses repeated prompts.
Those transformations make the display easier to read for one firmware shape,
but a general terminal must not reinterpret or hide device output merely because
it resembles a known shell prompt.

## What changes

- Render serial and RTT device text in transcript-event order without
  shell-specific prompt buffering.
- Do not insert or remove line breaks based on `msh >` or any other prompt token.
- Preserve repeated prompts exactly as emitted by the device.
- Keep raw transcript bytes, outgoing-input visibility, echo de-duplication, UTF-8
  streaming decode, and existing ANSI containment behavior.

## Scope

In scope: renderer prompt transformation state, renderer/hook regression tests,
and this OpenSpec change.

Out of scope: firmware logging, transport framing, terminal protocol negotiation,
AI/human write ownership, configurable display filters, and hardware operations.

## Acceptance criteria

1. `msh >` embedded in device text is displayed at the exact emitted position.
2. A prompt split across device events is displayed in the same event order with
   no idle buffering or inserted line break.
3. Repeated prompts remain repeated.
4. Raw transcript events remain byte-for-byte unchanged.
