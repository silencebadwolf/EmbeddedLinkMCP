## Context

LinkTerm v2 already exposes `run_control_workflow` as the preferred high-level MCP entry for hardware workflows. It loads `.linkterm/control-profile.json`, reuses or opens serial sessions, connects a J-Link probe, flashes firmware, resets the CPU, observes serial output, and optionally starts debug diagnosis.

The current workflow reduces low-level tool usage, but two inefficiencies remain:

1. SEGGER/J-Link failures are mostly surfaced as text-heavy `JLINK_OPERATION_FAILED` messages, so AI clients must infer whether to lower speed, fix target, retry, stop, or ask the user.
2. `jlink.speedKHz: "auto"` can let SEGGER choose a very high SWD speed for raw flash operations. In the observed workflow this reached 50000 kHz and failed while preserving target RAM; a fixed 4000 kHz succeeded.

The change must keep the LinkTerm MCP ownership boundary intact: all serial, J-Link, debug, RTT, GDB, and flashing evidence still comes from LinkTerm MCP or its bridge. No direct CLI fallback is introduced.

## Goals / Non-Goals

**Goals:**

- Make `run_control_workflow` failures more machine-readable and less token-heavy.
- Provide stable failure codes for common J-Link/SEGGER outcomes.
- Return next actions that include enough structure for AI clients to choose the next MCP call without searching or guessing.
- Use a safer speed policy for raw flash workflows when the profile says `speedKHz: "auto"`.
- Preserve backward compatibility for existing `run_control_workflow` consumers.

**Non-Goals:**

- Do not implement all remaining J-Link debug methods.
- Do not add direct J-Link/GDB/serial CLI access.
- Do not persist last-known-good profiles in this change.
- Do not add workflow resume/checkpointing in this change.
- Do not change UI layout or visual behavior.

## Decisions

### Decision 1: Add workflow-level failure classification instead of adding new MCP error codes first

`run_control_workflow` will add a workflow-local `failureCode` field to failed steps and/or top-level data. These codes classify domain outcomes such as `flash_ram_preserve_failed`, `flash_verify_failed`, `probe_not_found`, `target_rejected`, `capability_not_implemented`, and `command_timeout`.

Rationale: MCP `ToolErrorCode` is intentionally broad and shared across surfaces. A workflow-local code is lower risk, backward compatible, and can be tested without changing global error-code unions.

Alternative considered: add many new global `ERROR_CODES`. This would make every classification part of the stable MCP registry contract immediately, which is too heavy for a workflow optimization.

### Decision 2: Keep SEGGER text as evidence but make the classifier the decision source

The original sanitized SEGGER output remains in `error.message` or details for auditability. AI clients should use `failureCode` and `nextActions` for control flow.

Rationale: removing raw evidence would hurt debugging, but relying on raw text for decisions causes repeated token-heavy reasoning.

### Decision 3: Make `nextActions` machine-readable but not auto-executing

`ControlWorkflowNextAction` will remain advisory. It may include `tool`, `argsPatch`, and `requiresConfirm`, but LinkTerm will not execute follow-up actions automatically in this change.

Rationale: follow-up actions can be high-impact, especially flash and reset. The AI should still present or call the next MCP tool through normal confirmation gates.

### Decision 4: Resolve `auto` to a safe flash speed inside high-level raw flash workflow

When `run_control_workflow` performs raw binary flashing and the profile has `jlink.speedKHz: "auto"`, the workflow will connect the probe using a safe default speed of 4000 kHz. Numeric profile speeds continue to be used directly.

Rationale: high-level raw flash workflows optimize for deterministic success and low repeated attempts. SEGGER auto can be useful for manual or connection-only scenarios, but raw flash should avoid high-risk initial speeds.

Alternative considered: automatic retry from high speed downward. That is more complex, may repeat flash operations, and needs stronger checkpoint semantics. It can be added later.

### Decision 5: Keep profile schema backward compatible

The profile file still accepts numeric speeds and the literal `auto`. The changed interpretation applies only to `run_control_workflow` raw flash execution.

Rationale: Existing profiles remain valid and users do not need migration.

## Risks / Trade-offs

- **Risk:** A board that safely supports higher SWD speeds will flash slower under `auto` in high-level workflow. → **Mitigation:** Numeric `speedKHz` still uses the user-selected speed directly.
- **Risk:** Failure classification may miss a new SEGGER phrasing. → **Mitigation:** Unknown failures keep `JLINK_OPERATION_FAILED` evidence and use a generic `jlink_operation_failed` workflow code.
- **Risk:** `nextActions.argsPatch` may be mistaken as permission to bypass confirmation. → **Mitigation:** Include `requiresConfirm` and keep existing high-impact confirmation checks unchanged.
- **Risk:** Adding output fields could affect strict clients. → **Mitigation:** Only add optional fields; keep existing fields and meanings.
