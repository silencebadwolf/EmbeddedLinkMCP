# Deep Research Report: Klievan jlink-mcp Device Handling

> Generated: 2026-07-01
> Original Question: How does Klievan/jlink-mcp handle J-Link target device names, and what should LinkTerm learn from it?
> Iteration Round: Round 1

## 1. Sub-Question Breakdown

| # | Sub-Question |
|---|-------------|
| 1 | How does the VS Code extension expose MCP and pass J-Link configuration? |
| 2 | Does it enumerate SEGGER MCU device names or Device Pack entries? |
| 3 | How does it validate whether a configured target actually works? |
| 4 | What should LinkTerm change based on this behavior? |

## 2. Per-Question Research

### Sub-Question 1: MCP and configuration path

**Search Terms:** `Klievan jlink-mcp GitHub device_info set_device`, repository source inspection

**Key Sources:**

| # | Source | Key Point |
|---|--------|-----------|
| 1 | [Klievan/jlink-mcp README](https://github.com/Klievan/jlink-mcp) | VS Code extension auto-registers an MCP server and asks users to configure `jlinkMcp.jlink.device`. |
| 2 | [src/extension.ts](https://github.com/Klievan/jlink-mcp/blob/main/src/extension.ts) | Uses `vscode.lm.registerMcpServerDefinitionProvider`, starts standalone stdio server with env vars such as `JLINK_DEVICE`. |
| 3 | [src/utils/config.ts](https://github.com/Klievan/jlink-mcp/blob/main/src/utils/config.ts) | Reads VS Code settings, defaults device to `Unspecified`, auto-detects common SEGGER install dirs. |

**Answer:**

The extension does not inject tools directly inside the VS Code extension host. It registers a VS Code MCP server definition provider, then launches `out/mcp/standalone.js` with VS Code's bundled Node.js. User settings are converted to environment variables, notably `JLINK_DEVICE`, `JLINK_INSTALL_DIR`, `JLINK_INTERFACE`, `JLINK_SPEED`, and port values.

This means the MCP server sees a normal process environment. Device selection is still an explicit configuration value, either from VS Code settings or environment variables.

### Sub-Question 2: Device enumeration

**Search Terms:** `Klievan jlink-mcp list_devices ShowEmuList`

**Key Sources:**

| # | Source | Key Point |
|---|--------|-----------|
| 1 | [src/probe/jlink.ts](https://github.com/Klievan/jlink-mcp/blob/main/src/probe/jlink.ts) | `listDevices()` runs `ShowEmuList`, which lists connected J-Link probes, not SEGGER target MCU database entries. |
| 2 | [src/mcp/server.ts](https://github.com/Klievan/jlink-mcp/blob/main/src/mcp/server.ts) | `set_device` simply stores the supplied device string at runtime. |

**Answer:**

It does not provide a real SEGGER target-device catalog picker. The tool name `list_devices` is misleading: the J-Link backend sends `ShowEmuList` to J-Link Commander. That command is useful for seeing connected J-Link emulators/probes, not for listing supported MCU target names like `STM32H743II` or `-AT32F435RGT7`.

There is no source-level parser for `JLinkDevices.xml`, no scan of `Devices/**/*.xml`, and no UI/device picker backed by SEGGER target database. `set_device` accepts the exact string supplied by the user or agent.

### Sub-Question 3: Runtime validation

**Search Terms:** `Klievan jlink-mcp preflight 0xE000EDF0 JLink`

**Key Sources:**

| # | Source | Key Point |
|---|--------|-----------|
| 1 | [src/probe/backend.ts](https://github.com/Klievan/jlink-mcp/blob/main/src/probe/backend.ts) | Shared `withPreflight()` gates target operations with a preflight check and recovery attempt. |
| 2 | [src/probe/jlink.ts](https://github.com/Klievan/jlink-mcp/blob/main/src/probe/jlink.ts) | J-Link preflight reads DHCSR at `0xE000EDF0`; target methods use `halt`, `regs`, `mem`, or GDB server start. |
| 3 | [src/jlink/gdb-server.ts](https://github.com/Klievan/jlink-mcp/blob/main/src/jlink/gdb-server.ts) | Starts `JLinkGDBServerCL` with `-device`, `-if`, `-speed`, and RTT port args. |

**Answer:**

The real validation happens by touching the target through official SEGGER tools. For normal commands, it starts `JLinkExe` with `-device <configured device> -if <interface> -speed <speed> -autoconnect 1 -ExitOnError 1 -NoGui 1`, then executes commands like `mem 0xE000EDF0, 4`, `halt`, and `regs`.

Reading `0xE000EDF0` is a Cortex-M DHCSR probe. If this succeeds, the configured device string, probe connection, SWD/JTAG wiring, power, and target attach are all good enough for real debug operations. If it fails, the backend classifies the error and attempts recovery by stopping GDB server, trying reset/halt, and reducing speed.

For RTT, it starts `JLinkGDBServerCL` with the configured device. That also forces SEGGER to resolve the device and attach to the target. RTT then connects to the GDB server's telnet port.

### Sub-Question 4: LinkTerm changes

**Search Terms:** local LinkTerm source and GitNexus-assisted workflow inspection

**Key Sources:**

| # | Source | Key Point |
|---|--------|-----------|
| 1 | [src/jlink/device-catalog.ts](/c:/Users/Admin/Desktop/Code/link-terminal/src/jlink/device-catalog.ts) | Current LinkTerm catalog parses local XML/AddOn databases, which may miss SEGGER built-in targets. |
| 2 | [src/mcp/surfaces/control-workflow/workflow-runner.ts](/c:/Users/Admin/Desktop/Code/link-terminal/src/mcp/surfaces/control-workflow/workflow-runner.ts) | Current workflow can reject targets that are absent from XML catalog before actual J-Link attach. |
| 3 | [src/main/ipc/rtt-log-session-ipc.ts](/c:/Users/Admin/Desktop/Code/link-terminal/src/main/ipc/rtt-log-session-ipc.ts) | RTT open path currently has catalog-backed target checks. |

**Answer:**

LinkTerm's new catalog is stronger than jlink-mcp for selection, especially for vendor AddOns with exact names. But using the XML catalog as an authority is wrong because SEGGER can support built-in target names not present in XML/AddOn files. `STM32H743II` appears to be exactly this kind of case on this machine.

The safer model is:

1. Use catalog search as a UI/MCP suggestion layer.
2. Preserve exact selected SEGGER names.
3. When catalog misses, do not block automatically.
4. Validate with a real J-Link attach preflight before flash/RTT/debug.
5. Treat J-Link/GDBServer output as authoritative for actual support.
6. Only show "install/update Device Pack/AddOn" after runtime validation fails with unknown/unsupported target or flash-loader/device-database evidence.

## 3. Preliminary Synthesis

### Core Findings

1. **jlink-mcp does not solve device selection by catalog enumeration** — it relies on user config plus runtime validation.
2. **`list_devices` lists probes, not MCU target names** — it runs `ShowEmuList`.
3. **The core trick is preflight** — read DHCSR / run `halt` and `regs` / start GDB server with `-device`.
4. **LinkTerm should not hard-block XML misses** — XML/AddOn catalog is incomplete relative to SEGGER's full built-in support.

### Preliminary Conclusion

The extension "works" because it avoids over-validating target names offline. It accepts the configured string and lets SEGGER prove whether it works during target attach. LinkTerm should keep its catalog selector, but downgrade catalog misses from blocking errors to warnings plus runtime validation.

## 4. Verification

### Verification Checkpoints

| # | Checkpoint | Anchored Conclusion Claim |
|---|------------|---------------------------|
| 1 | The extension registers an MCP server through VS Code's MCP provider API. | MCP/config path |
| 2 | The J-Link backend has no SEGGER XML catalog parser. | No catalog enumeration |
| 3 | `listDevices()` uses `ShowEmuList`. | Probe listing, not MCU listing |
| 4 | Runtime commands pass `-device` to SEGGER tools and use target-touching commands for validation. | Runtime validation |

### Verification Summary

| Metric | Result |
|--------|--------|
| Total Checkpoints | 4 |
| Passed | 4 |
| Failed | 0 |
| Overall Verdict | Verified |

## 5. Final Conclusion

LinkTerm should copy the strategy, not the missing feature. The right fix is not to remove the catalog, but to make it advisory and add an explicit J-Link target validation layer that uses official SEGGER attach behavior. That avoids the current STM32 false negative while still helping AT32/AddOn users pick exact registered names.

## 6. Source Index

| # | Title | URL |
|---|-------|-----|
| 1 | Klievan/jlink-mcp README | https://github.com/Klievan/jlink-mcp |
| 2 | jlink-mcp extension.ts | https://github.com/Klievan/jlink-mcp/blob/main/src/extension.ts |
| 3 | jlink-mcp probe/jlink.ts | https://github.com/Klievan/jlink-mcp/blob/main/src/probe/jlink.ts |
| 4 | jlink-mcp probe/backend.ts | https://github.com/Klievan/jlink-mcp/blob/main/src/probe/backend.ts |
| 5 | jlink-mcp utils/config.ts | https://github.com/Klievan/jlink-mcp/blob/main/src/utils/config.ts |
| 6 | jlink-mcp jlink/gdb-server.ts | https://github.com/Klievan/jlink-mcp/blob/main/src/jlink/gdb-server.ts |
