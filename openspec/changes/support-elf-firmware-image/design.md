## Design

Add a small pure ELF parser in the workspace core layer. It supports ELF32 little-endian executable images with program headers, extracts `PT_LOAD` segments with file data, uses physical addresses as flash load addresses, and returns a contiguous image filled with `0xff` for gaps. The parser enforces the existing 16 MiB decoded image cap.

The firmware picker remains path-first for all supported file types. When a selected file has an `.elf` extension, the main process reads and parses it, then returns the detected load base address in the same optional `baseAddress` field already used for Intel HEX.

The high-level workflow remains a raw-binary J-Link workflow. For `.elf`, `resolveFirmware` decodes the ELF into raw bytes, checks that the configured base address matches the ELF load base, validates the decoded Cortex-M vector table, and passes the decoded bytes to `flashDownload`.

Profile inspection uses the same decode path for `.elf` diagnostics so `inspect_control_profile` reports the same vector-table result that a flash workflow would use.

AI-facing guidance is part of the fix because the original failure mode can be reintroduced by operator behavior even when decoding works. Initialize instructions, the full agent runbook, `get_app_status` recommendations, and the `run_control_workflow` tool description all state that `.bin`, `.hex`, and `.elf` are supported firmware forms; `.elf` is decoded from loadable program segments; and agents must not rewrite an `.elf` profile firmware path to `.bin` to bypass diagnostics.

## Non-Goals

- Do not teach the low-level J-Link adapter to consume ELF directly; it continues receiving raw bytes and an explicit address.
- Do not change the control-profile schema shape; `flash.baseAddress` remains a hexadecimal string.
- Do not support ELF64, big-endian ELF, dynamic linking, or DWARF/debug metadata extraction.
- Do not make low-level `flash_download` consume `.elf` or `.hex` paths; high-level workflows keep ownership of path-based decoding.
