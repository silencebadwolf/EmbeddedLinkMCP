## Why

The control profile UI and answer parser already accept `.elf` firmware paths, but the destructive flash workflow still treats non-HEX files as raw binary images. When an ELF file is selected, LinkTerm reads the ELF header as if it were a Cortex-M vector table, so reset-vector validation can fail before any valid flash image is produced.

ELF is a common output format for embedded builds. LinkTerm should interpret ELF program headers, derive the load image bytes and base address, and keep the existing raw J-Link flash backend boundary.

## What Changes

- Parse 32-bit little-endian ELF firmware files into a contiguous load image from loadable program segments.
- Detect the ELF load base address when the user picks an `.elf` firmware file.
- Decode ELF bytes before high-level flash workflows call the raw binary J-Link backend.
- Reuse decoded ELF bytes for profile vector-table diagnostics so inspection matches flash behavior.
- Preserve current `.bin` and `.hex` behavior.

## Impact

- Affected code areas:
  - `src/core/workspace/*`
  - `src/main/ipc/control-profile-ipc.ts`
  - `src/mcp/surfaces/control-profile/tools.ts`
  - `src/mcp/surfaces/control-workflow/workflow-runner.ts`
  - related unit tests
- Behavior impact:
  - Additive support for valid embedded ELF firmware images.
  - Safer destructive workflow behavior: ELF files are decoded before vector validation and flashing.
  - Invalid or unsupported ELF files fail during preflight before connecting to the probe.
