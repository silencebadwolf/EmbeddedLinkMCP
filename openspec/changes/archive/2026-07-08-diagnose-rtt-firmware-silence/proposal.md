# Diagnose RTT Firmware Silence

## Why

RTT log sessions can connect successfully and still show only SEGGER transport banners. In that state the LinkTerm App, MCP runtime, J-Link probe, and RTT transport may all be working, while the target firmware has not emitted application log bytes on the selected channel. Today that distinction is left to the operator or AI client, which leads to repeated flashing or reset attempts for a non-flash symptom.

## What Changes

- Classify RTT log transcripts into transport/banner evidence versus firmware-origin output.
- Add a read-only MCP diagnostic tool for an existing `rtt-log` session.
- Add App-visible system transcript guidance when an RTT session sees only SEGGER transport banner bytes.
- Update agent runbook guidance so silent RTT logs are diagnosed before any flash/reset recovery path is considered.

## Scope

In scope:
- RTT log session transcript classification.
- MCP `rtt-log-session` surface.
- Core tool-set diagnostics and agent runbook text.
- Unit coverage for banner-only, firmware-output, and non-RTT-session cases.

Out of scope:
- Changing firmware output configuration in target projects.
- Changing J-Link flash, reset, or GDB confirmation behavior.
- Inferring target liveness from old serial/debug evidence.
