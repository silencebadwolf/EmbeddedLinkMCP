## 1. Specify

- [x] 1.1 Add an OpenSpec change for WSL-aware workspace selection.
- [x] 1.2 Add a delta requirement for parity between workspace and firmware path browsing.

## 2. Reproduce

- [x] 2.1 Add a failing main IPC regression test showing the workspace picker should receive a WSL `defaultPath` on Windows.
- [x] 2.2 Confirm the test fails before implementation.

## 3. Fix

- [x] 3.1 Implement WSL-aware default path discovery for the workspace directory dialog.
- [x] 3.2 Preserve fallback behavior when WSL discovery is unavailable.

## 4. Verify

- [x] 4.1 Run the targeted IPC test.
- [x] 4.2 Run OpenSpec validation.
- [x] 4.3 Run project test/build/lint verification.
- [x] 4.4 Run GitNexus `detect_changes`.
