## 1. Structured Workflow Output

- [x] 1.1 Extend control-workflow output types with workflow-local `failureCode`, machine-readable `argsPatch`, and `requiresConfirm` fields.
- [x] 1.2 Add a focused failure classifier for known J-Link/SEGGER messages, including RAM preserve / prepare programming failures and generic J-Link operation failures.

## 2. Safe Flash Speed Policy

- [x] 2.1 Resolve `jlink.speedKHz: "auto"` to a safe 4000 kHz speed when `run_control_workflow` performs raw binary flashing.
- [x] 2.2 Include evidence that the high-level workflow resolved `auto` through the safe flash speed policy.

## 3. Workflow Integration

- [x] 3.1 Attach failure classifications to failed workflow steps and top-level workflow data.
- [x] 3.2 Add machine-readable `nextActions` for classified RAM preserve failures without bypassing confirmation gates.
- [x] 3.3 Update the `run_control_workflow` tool description to tell AI clients to prefer the high-level workflow for supported modes.

## 4. Verification

- [x] 4.1 Add or update unit tests for failure classification and safe speed resolution.
- [x] 4.2 Run targeted tests, OpenSpec validation, main-process build, and lint.
