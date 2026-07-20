## 1. Target connection truth

- [x] Add a Commander target-access contract with positive-evidence parsing.
- [x] Make adapter connect/status fail closed and remove stale-handle discovery truth.
- [x] Cover disconnected target, missing evidence, stale handle, and physical-only discovery.

## 2. Workflow and UI propagation

- [x] Prove manual chip connection cannot display connected after backend target-access failure.
- [x] Prove control workflow cannot report `probeConnected=true` after target-access failure.

## 3. Progress and completion truth

- [x] Remove synthetic runner percentages and percentage-derived byte counts.
- [x] Remove renderer idle, step-count, and failure percentages.
- [x] Distinguish verified and unverified completion wording in English and Chinese.

## 4. Verification

- [x] Run focused unit and renderer integration tests.
- [x] Run lint, TypeScript/Vite build, full tests, license validation, and OpenSpec strict validation.
- [x] Run GitNexus detect_changes and directed PDG/taint review.
- [x] Record that no real flash, erase, reset, or debug hardware action was executed.
