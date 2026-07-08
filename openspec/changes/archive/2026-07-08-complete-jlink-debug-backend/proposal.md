## Why

LinkTerm 的 J-Link MCP/debug surface 已经注册 28 个工具，但生产 `JLinkAdapter` 仍有 CPU、寄存器、内存、断点、RTT、诊断和部分 flash 方法返回 `NOT_IMPLEMENTED`。这会让 AI 客户端在需要真实 debug evidence 时陷入低层重试，或被迫等待人工绕过 LinkTerm 安全边界。

## What Changes

- 补齐 `JLinkAdapter` 中当前已注册但尚未真实实现的 debug backend 方法，使生产 backend 不再对已连接 probe 的注册工具返回占位 `NOT_IMPLEMENTED`。
- 扩展 `src/jlink/` 内部 SEGGER Commander/GDB server/RTT 封装，用 LinkTerm 自有抽象层实现 CPU 控制、寄存器、内存、断点、RTT、snapshot、crash diagnose、flash erase/write。
- 参考 `Klievan/jlink-mcp` 的命令模型、GDB server 生命周期、RTT telnet 缓冲、寄存器/内存解析和 Cortex-M fault 解码思路，但不直接复制源码；如后续确需复用 MIT 代码，另行处理 license/attribution。
- 保持现有 MCP 工具名、schema、evidence 形态和错误码兼容；只在必要时扩展 backend 内部 DTO 或 evidence data 字段。
- 继续保持 `src/jlink/` 与 `src/mcp/surfaces/debug/` Electron-free；MCP surface 不直接调用外部 CLI。
- 保留高影响操作 `confirm=true` 门禁，保持 16 MiB 二进制 cap 且不在确认前解码高影响 payload。
- 按阶段 TDD 推进：Phase A CPU halt/run/step + status；Phase B register；Phase C memory；Phase D breakpoint；Phase E RTT；Phase F snapshot/crash diagnose；Phase G flash erase/write 边界完善。

## Capabilities

### New Capabilities
- `jlink-debug-backend`: Covers complete production backend behavior for the already registered J-Link MCP/debug tools, including backend command execution, structured parsing, per-probe state, evidence, safety gates, and test-driven phased delivery.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/jlink/`, `src/mcp/surfaces/debug/`, `tests/unit/jlink/`, `tests/unit/mcp/debug/`, and possibly shared J-Link fixture types.
- APIs: Existing MCP tool names and input schemas should remain stable. Backend interfaces may gain internal helper methods or optional DTO fields only when needed for structured evidence.
- Dependencies: No new runtime dependency expected. Use existing Node primitives and current SEGGER runner abstraction.
- Systems: Improves real J-Link debug coverage while preserving LinkTerm's hardware safety boundary, privacy redaction, confirmation gates, and MCP evidence model.