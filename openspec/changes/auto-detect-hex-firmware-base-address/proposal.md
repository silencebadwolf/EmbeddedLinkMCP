## Why

The control profile dialog already lets users select firmware files with `.hex` extensions, but the profile still requires a manually typed flash base address. Intel HEX images already carry absolute data addresses, so forcing the user to copy the address by hand is error-prone.

The flash workflow also passes a raw `Buffer` to the J-Link backend. If LinkTerm reads an Intel HEX file as text, the backend can receive ASCII HEX records instead of decoded firmware bytes. The profile UI and the destructive flash path must agree on what a selected HEX image means.

## What Changes

- Detect Intel HEX data addresses when a user selects a `.hex` firmware file.
- Auto-fill `flash.baseAddress` with the lowest absolute data address found in the HEX file.
- Decode Intel HEX into raw firmware bytes before calling the existing raw-binary J-Link flash backend.
- Preserve existing `.bin` and `.elf` picker and workflow behavior.
- Add regression coverage for picker auto-fill, renderer form updates, read-only profile diagnostics, and flash workflow download bytes.

## Impact

- Affected code areas:
  - `src/core/workspace/*`
  - `src/main/ipc/control-profile-ipc.ts`
  - `src/renderer/components/ControlProfilePanel.tsx`
  - `src/mcp/surfaces/control-profile/tools.ts`
  - `src/mcp/surfaces/control-workflow/workflow-runner.ts`
  - related unit tests
- Behavior impact:
  - Additive for valid Intel HEX files.
  - Safer destructive workflow behavior: HEX files are decoded before flashing.
  - Invalid HEX files surface as configuration/readability errors instead of being flashed as text.
