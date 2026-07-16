## 1. Characterization and impact

- [x] 1.1 Record current Start Center/App/Activity Center behavior and preserve the existing dirty worktree.
- [x] 1.2 Run GitNexus upstream impact for every existing symbol selected for modification; report HIGH/CRITICAL results before edits.
- [x] 1.3 Add characterization assertions for current ConnectionDialog callbacks, candidate/manual serial callbacks, no-session shell selection, and active-session control-profile behavior.

## 2. Serial-first Start Center

- [x] 2.1 Add failing Start Center tests for a single primary `Open serial terminal` action and consistent detected/manual serial actions; assert saved profiles are not duplicated on Start Center.
- [x] 2.2 Implement the unified serial-device area without changing connection/session boundaries.
- [x] 2.3 Add failing validation tests for empty/invalid manual port and baud values, with local actionable error text.
- [x] 2.4 Implement manual-entry validation and route the explicit action through the existing `ConnectionDialog` prefill path.

## 3. Advanced content and App shell

- [x] 3.1 Add failing tests for collapsed advanced devices and bounded rendering of advanced readiness/diagnostics.
- [x] 3.2 Implement the advanced disclosure while preserving existing J-Link/RTT/control-profile actions.
- [x] 3.3 Add failing App tests proving the control-profile sidebar is hidden only for the no-session Start Center branch.
- [x] 3.4 Implement the App branch condition and rerun active-session/control-profile regression tests.

## 4. Observation-only Activity Center and copy

- [x] 4.1 Add tests proving Activity Center is closed by default on Start Center and opening/closing it preserves terminal focus/input state.
- [x] 4.2 Update the observation entry copy and verify no approval/pause/takeover/recovery controls are introduced.
- [x] 4.3 Add bilingual key-coverage and accessibility tests for primary actions, disclosure, validation, empty/error states, and focus return.

## 5. Verification and handoff

- [x] 5.1 Run focused renderer tests after each vertical slice.
- [x] 5.2 Run full test suite, coverage, lint, TypeScript, build, license validation, and OpenSpec strict validation.
- [x] 5.3 Request code review, resolve valid findings, and rerun affected tests.
- [x] 5.4 Run verification-before-completion, GitNexus detect_changes, and directed PDG/taint review.
- [ ] 5.5 Perform Windows-first manual acceptance at large and small window sizes in Chinese and English, including human terminal input while AI activity is visible. (Layout, bilingual copy, and observation drawer are verified; live terminal input/AI co-use remains pending a safe connected device.)
- [x] 5.6 Record fresh evidence and request authorization before any unrelated phase or hardware operation.
