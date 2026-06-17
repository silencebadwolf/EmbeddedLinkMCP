## Context

LinkTerm 当前已经注册 28 个 J-Link/debug MCP 工具，并且已有真实的 probe lifecycle、raw `flashDownload`/`flashVerify`、`cpuReset`、GDB server lifecycle 与 `run_control_workflow` 关键链路。但生产 `JLinkAdapter` 仍有 19 个方法在校验 `probeId` 后抛 `JLinkNotImplementedError`：`cpuHalt`、`cpuRun`、`cpuStep`、3 个 breakpoint 方法、3 个 register 方法、2 个 memory 方法、`flashErase`、`flashWrite`、4 个 RTT 方法、`snapshotCapture`、`crashDiagnose`。

参考仓库 `Klievan/jlink-mcp`（MIT）提供了较完整的 debug MCP 体验：

- **J-Link Commander 调用方式**：通过 `child_process.spawn` 启动 `JLinkExe`，传入 `-device/-if/-speed/-autoconnect/-ExitOnError/-NoGui` 等参数，再把命令序列写入 stdin，例如 `halt`、`go`、`s`、`regs`、`rreg <name>`、`mem <addr>, <len>`、`w4 <addr>, <value>`、`SetBP <addr>`、`ClrBP`、`erase`、`loadfile`。
- **GDB server 调用方式**：通过进程管理器启动 `JLinkGDBServerCL`，传入 `-device/-if/-speed/-port/-RTTTelnetPort/-SWOPort/-LocalhostOnly/-singlerun/-NoGui` 等参数，并收集 stdout/stderr ring buffer。LinkTerm 已经在 `src/jlink/segger-command-runner.ts` 中实现了更严格的绝对路径解析、无 shell spawn、bounded output、ready pattern 和 stop handle。
- **寄存器/内存/CPU 控制**：参考实现用短生命周期 Commander 命令完成 `halt/resume/reset/step/regs/rreg/mem/w4`，并做寄存器文本解析和 boilerplate 清理。
- **断点**：参考实现用 Commander 的 `SetBP` 与 `ClrBP`；它只暴露清全部断点。LinkTerm 已有 `breakpoint_set/clear/list`，需要额外维护 per-probe 断点账本，以便 `clear(id)` 和 `list()` 结构化返回。
- **RTT**：参考实现通过 GDB server 暴露的 RTT telnet port 建立 `net.Socket`，保存 bounded log buffers，strip ANSI/SEGGER banner，并支持按日志级别、模块、pattern 搜索。LinkTerm 当前接口是 `rtt_connect/read/clear/search`，可借鉴 telnet 缓冲模型，但 evidence 必须是结构化 `Buffer/base64`，而不是只返回人类文本。
- **诊断**：参考实现通过读取 Cortex-M fault status register 区域（如 `0xE000ED28` 起的 CFSR/HFSR/MMFAR/BFAR）和 SP 附近内存，解析 fault 类型与 exception stack frame。LinkTerm 可借鉴寄存器/内存读取顺序和 fault decode 规则，但输出应映射到 `CrashDiagnosis` DTO。

## Goals / Non-Goals

**Goals:**
- 让已注册 J-Link MCP/debug 工具在生产 `JLinkAdapter` 中具备真实 backend 行为，不再用 `NOT_IMPLEMENTED` 作为常规结果。
- 所有外部 SEGGER 交互都封装在 `src/jlink/` runner/client/backend 层，保持 MCP surface 只调用 `IJLinkBackend`。
- 按风险阶段化实现，每阶段先写失败测试，再实现 backend，再验证 MCP evidence/error translation。
- 保持高影响操作确认门禁、16 MiB cap、serialNumber redaction、probe busy 互斥、相对 import + `.js` 扩展。
- 兼容当前 MCP tool 名称、输入 schema 与 `debug_output` evidence kind。

**Non-Goals:**
- 不新增直接执行 `arm-none-eabi-gdb` 的 GDB/MI client；硬件验证与 backend 证据仍通过 LinkTerm MCP/HTTP runtime bridge。
- 不引入 OpenOCD、Black Magic Probe 或 probe-rs backend。
- 不改 UI、串口、workspace profile 等无关模块。
- 不直接复制 `Klievan/jlink-mcp` 源码；只参考公开行为和设计思路。
- 不一次性要求实机验证所有阶段；硬件验证按阶段在 LinkTerm MCP 可用时补充。

## Decisions

### Decision 1: 扩展 LinkTerm 的 Commander client，而不是在 adapter 中散落命令

`DefaultJLinkCommanderClient` 当前只暴露 `download/verify/reset`。本变更将扩展该 client 的受控操作面，例如 `halt/run/step`、`readRegisters/readRegister/writeRegister`、`readMemory/writeMemory`、`erase/writeFlash`、`setBreakpoint/clearBreakpoint`。这些方法内部继续使用临时 command file、绝对 executable path、`spawn(..., { shell: false })`、bounded output 与统一错误分类。

Rationale: 参考实现把 Commander 命令集中在 backend 类内；LinkTerm 已有更严格 runner 层，继续扩展它能避免 MCP surface 或 adapter 直接拼 CLI。

### Decision 2: Adapter 维护最小 per-probe 状态

`JLinkAdapter` 将继续以 `probeId -> ProbeHandle` 为唯一持久状态，并增加必要的 per-probe 状态：断点账本、RTT client/session、最近一次 CPU 状态摘要（如可从 `regs` 解析得到）、GDB server RTT port 信息。所有 target-touching 操作仍通过 `#withProbeOperation` 或等价物串行化。

Rationale: 参考实现有全局 probe 状态机；LinkTerm 当前是多 probe handle 设计。状态必须挂在 handle 上，避免多个 probe 或同 serial duplicate handle 间串扰。

### Decision 3: 结构化解析放在 `src/jlink/`，MCP 只做证据投影

寄存器 dump、memory dump、fault register、RTT log 和断点账本解析都在 `src/jlink/` 内完成，返回 `RegisterValue[]`、`Buffer`、`CrashDiagnosis`、`RttReadResult` 等 DTO。`src/mcp/surfaces/debug/` 只负责调用 backend、base64 边界转换和 ToolError 翻译。

Rationale: 参考实现多数输出是 text。LinkTerm 的 MCP evidence 模型需要机读 DTO，解析逻辑若放在 MCP surface 会破坏 backend ownership boundary。

### Decision 4: RTT 采用 GDB server RTT telnet 的可注入 client

新增或扩展 `src/jlink/` 内部 RTT client，默认通过 `net.Socket` 连接 GDB server 提供的 RTT telnet 端口；测试注入 fake socket/client。`rtt_connect` 负责建立连接并返回 channel 0 的 up-channel 信息；`rtt_read` 消费 bounded buffer；`rtt_search` 在当前 buffer 上做 literal search 且不消费；`rtt_clear` drain 当前 buffer。

Rationale: 参考实现的 RTT telnet + ring buffer 模型成熟，但 LinkTerm 不应把 RTT 视为终端 transcript，也不应返回未限制的文本日志。

### Decision 5: Breakpoint `clear(id)` 由 LinkTerm 账本映射

Commander 的常用 `ClrBP` 更接近清全部断点，参考实现也只暴露 clear all。LinkTerm 已经公开 `breakpoint_clear(id)`，因此 backend 需要维护 `id -> address/kind` 账本。若 SEGGER Commander 支持按地址清除，优先用地址清除；否则可在安全可测的范围内清全部并重建其余断点。该行为必须由单元测试覆盖，避免 silently losing breakpoints。

Rationale: 保持 MCP API 兼容，同时正视 SEGGER 命令粒度与 LinkTerm API 粒度不一致。

### Decision 6: Snapshot 与 crash diagnose 先做 Cortex-M 通用最小闭环

`snapshotCapture` 读取寄存器列表与 caller 指定 memory ranges；`crashDiagnose` 读取核心寄存器、CFSR/HFSR/MMFAR/BFAR、SP 附近 exception frame，并输出 `fault`、`pc/lr/sp`、`reason`、`stackTrace`。若非 Cortex-M 或寄存器缺失，返回 `fault: 'unknown'` 与明确 reason，而不是抛 `NOT_IMPLEMENTED`。

Rationale: 参考实现同样以 Cortex-M fault registers 为主；LinkTerm 的接口必须在无 fault 或非典型 target 上稳定降级。

### Decision 7: 分阶段 TDD，每阶段更新任务状态但不大爆改

实施顺序按风险递增：
- Phase A：CPU halt/run/step + status evidence smoke。
- Phase B：register read/list/write。
- Phase C：memory read/write。
- Phase D：breakpoint set/clear/list。
- Phase E：RTT connect/read/search/clear。
- Phase F：snapshot/crash diagnose。
- Phase G：flash erase/write 边界完善。

每阶段完成标准：失败测试先落地；backend 实现；必要的 MCP evidence/error tests；targeted tests 通过；阶段间不做无关重构。

## Risks / Trade-offs

- **SEGGER Commander 输出格式随版本变化** → 解析器采用多模式匹配，失败时抛 `JLINK_OPERATION_FAILED` 并保留 redacted bounded preview；单元测试覆盖常见输出样本。
- **RTT 依赖 GDB server RTT telnet port** → `rtt_connect` 在未启动 GDB server 或端口不可达时返回结构化 `INVALID_STATE`/`JLINK_OPERATION_FAILED`，不隐式启动高影响服务绕过确认。
- **断点 clear(id) 与 Commander 能力不完全一致** → 用 per-probe 账本隔离 MCP API；若需 clear-all+reapply，必须显式测试并在错误时不伪造成功。
- **内存/flash 写入可能破坏目标状态** → 继续保留现有 sensitivity 与 high-impact gates；`flash_write` 保持 confirm gate 且 decode 在确认之后。
- **实机行为无法完全由单元测试证明** → 先用 fake runner 覆盖命令构造、解析、错误分类；实机验证只通过 LinkTerm MCP/HTTP runtime bridge 执行，并作为阶段完成后的额外证据。

## Migration Plan

1. 生成并校验 OpenSpec 变更产物。
2. 进入编码后加载 TDD 流程，先从 Phase A 开始写失败测试并实现最小 CPU 控制闭环。
3. 每个阶段只修改 `src/jlink/`、`src/mcp/surfaces/debug/` 与对应测试；如需扩展 shared error code，按 M5 双向同步契约处理。
4. 阶段完成后运行 targeted tests；完成较大阶段后运行 `pnpm run build:main`、`pnpm run lint`、`openspec validate --all`。
5. 全部阶段完成后运行 full build/test/license validate，并在 `DEVELOPMENT_PLAN.md` Phase 9 backlog/后续记录中更新结果。

Rollback: 每阶段保持小提交/小改动，可回退对应 backend client 方法与 tests；已存在 MCP schema 不做破坏性变更。