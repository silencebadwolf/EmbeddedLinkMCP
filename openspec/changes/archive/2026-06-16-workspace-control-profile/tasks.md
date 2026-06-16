## 1. Core Control Profile

- [x] 1.1 Define control profile DTOs and strict Zod schemas.
- [x] 1.2 Persist `.linkterm/control-profile.json` with atomic write and visible path.
- [x] 1.3 Enforce hex `flash.baseAddress` and reject decimal addresses.
- [x] 1.4 Parse human answers into serial/J-Link/flash profile patches.

## 2. MCP Integration

- [x] 2.1 Register `init_control_profile`, `get_control_profile`, `inspect_control_profile`, `prepare_control_profile_questions`, `apply_control_profile_answer`, and `activate_control_profile`.
- [x] 2.2 Make `activate_control_profile` require the workspace file and avoid destructive operations.
- [x] 2.3 Support `speedKHz: "auto"` with descending J-Link speed fallback.

## 3. UI and IPC

- [x] 3.1 Add renderer control profile panel for human setup.
- [x] 3.2 Wire save/load/path picker IPC through preload.
- [x] 3.3 Synchronize Chinese and English UI strings.
- [x] 3.4 Add dropdown/candidate controls for common serial/J-Link values.
- [x] 3.5 Add workspace directory picker and firmware file picker.

## 4. Verification

- [x] 4.1 Add core manager/parser tests.
- [x] 4.2 Add MCP control-profile tests.
- [x] 4.3 Add renderer panel tests for i18n, dropdowns, auto speed, and path picking.
- [x] 4.4 Run targeted tests, full build, lint, and full test suite.
