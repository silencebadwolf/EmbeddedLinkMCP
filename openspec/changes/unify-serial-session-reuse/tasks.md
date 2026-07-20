## 1. Characterization and contracts

- [x] 1.1 Add RED tests for complete serial identity, active-state reuse, conflicts, closed/errored exclusion, same-port single-flight, and different-port concurrency.
- [x] 1.2 Add RED boundary tests proving MCP, renderer IPC, saved connections, full workspaces, profile activation, and workflows converge on one session id.
- [x] 1.3 Add the stable `SERIAL_SESSION_CONFLICT` error and `reused` response contracts.

## 2. Main-owned coordination

- [x] 2.1 Implement normalized serial identity and `SerialSessionCoordinator` using a per-port in-flight reservation.
- [x] 2.2 Preserve entry-specific genuine-open failure behavior while ensuring coordinator conflicts never create errored tabs.
- [x] 2.3 Keep complete serial identity Main-only and avoid widening shared renderer metadata contracts.

## 3. Entry-point integration

- [x] 3.1 Create one coordinator in Main and inject it into direct/HTTP MCP plus renderer IPC handlers.
- [x] 3.2 Route `session:create`, saved connections, and MCP `open_session` serial branches through the coordinator.
- [x] 3.3 Route control-profile activation and control workflows through the coordinator and remove workflow-local reuse logic.
- [x] 3.4 Update the agent runbook to recommend `list_sessions` before `open_session` without making correctness prompt-dependent.

## 4. Renderer behavior

- [x] 4.1 Prove a matching AI-created serial session is selected when a saved connection or full workspace is opened and no duplicate tab appears.

## 5. Verification

- [x] 5.1 Run focused unit and renderer integration tests after each TDD slice.
- [x] 5.2 Run lint, TypeScript/Vite build, full tests, license validation, coverage report, and strict OpenSpec validation.
- [x] 5.3 Request code review and address valid high-confidence feedback.
- [x] 5.4 Run GitNexus `detect_changes`, PDG impact, and directed taint review for the changed boundaries.
- [x] 5.5 Record that no real serial open, flash, erase, reset, probe connection, or debug hardware operation was executed.
