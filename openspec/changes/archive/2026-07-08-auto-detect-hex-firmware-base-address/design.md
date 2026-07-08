## Design

Add a small pure Intel HEX parser in the workspace core layer so main IPC, MCP profile diagnostics, and MCP workflow resolution use the same interpretation. The parser validates checksums, tracks extended segment/linear address records, finds the lowest and highest absolute data addresses, and returns a contiguous image filled with `0xff` for gaps.

The main firmware picker keeps returning the selected path for every supported firmware type. When the selected extension is `.hex`, it reads the selected file, parses it, and returns an optional `baseAddress` formatted as `0x...`. The renderer applies that value to the flash base address field only when it is present.

The workflow remains a raw-binary J-Link workflow. For `.hex`, it decodes the image and passes decoded bytes plus the configured/detected base address to `flashDownload`. If the profile/request base address disagrees with the HEX image base, the workflow rejects the request before connecting to the probe. This is safer than silently flashing decoded bytes at a different address.

Profile inspection reuses the same read/decode path for vector table checks so diagnostics match the actual flash path.

## Non-Goals

- Do not add ELF parsing or ELF segment address detection in this change.
- Do not change the control-profile schema shape; `flash.baseAddress` remains the persisted hexadecimal string.
- Do not teach the low-level J-Link adapter to consume HEX directly; it continues receiving raw bytes and an explicit address.
