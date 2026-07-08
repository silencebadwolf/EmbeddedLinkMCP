/**
 * J-Link backend 抽象层类型定义。
 *
 * 该模块描述 LinkTerm v2 与 J-Link 调试器交互的最小接口（probe / cpu / breakpoint /
 * register / memory / flash / RTT / GDB / 诊断）。Phase 9 仅定义接口与 DTO，并提供
 * `NullJLinkBackend`（一律抛 NoBackendError）+ `JLinkAdapter`（lifecycle 真，其它抛
 * NOT_IMPLEMENTED）。Phase 13+ 才接入真实 SEGGER J-Link 实现。
 *
 * 设计准则（与 src/core/ 一致）：
 * - **零 Electron 依赖**：本模块仅依赖 Node 标准库与项目内部类型；
 * - **抛错而非返回 result**：错误层级见 `./errors.ts`，MCP 层用 `instanceof` 翻译；
 * - **Buffer 在 backend 层**：memory/flash 二进制使用 Node `Buffer`，base64 编/解码
 *   只发生在 MCP 边界（`src/mcp/surfaces/debug/binary-codec.ts`）；
 * - **AbortSignal 透传**：长操作（flash / GDB start）在末参带 `signal?: AbortSignal`，
 *   避免后期接口 bump。
 */

/** 已识别的 J-Link probe 元信息。 */
export interface ProbeInfo {
  /** UUID v4；JLinkAdapter 在 probeConnect 时唯一 mint，断开后失效。 */
  probeId: string;
  /** 硬件序列号；可能不存在（虚拟 probe）。MCP 边界会在出参前剥离此字段（隐私）。 */
  serialNumber?: string;
  /** connect 时传入的 device name（如 "STM32F407VG"），用于上下文回显。 */
  target?: string;
  /** 是否处于 connected 状态；disconnect 后为 false。 */
  connected: boolean;
}

/** probeConnect 入参。target 必填，对应 J-Link Commander 的 `device` 命令参数。 */
export interface ProbeConnectOptions {
  /** 设备名（必填），J-Link Commander 强制要求。 */
  target: string;
  /** SWD 或 JTAG，缺省由 backend 决定（通常 SWD）。 */
  interface?: 'swd' | 'jtag';
  /** 接口时钟（kHz）；缺省由 backend 决定。 */
  speedKHz?: number;
  /** 多 probe 机器上指定优先 serial number（精确匹配）。 */
  serialNumber?: string;
}

/** 单个断点描述。 */
export interface BreakpointSpec {
  /** backend 内部分配的断点 id；用于 clear。 */
  id: number;
  /** 物理地址。 */
  address: number;
  /** 软件断点（指令替换）或硬件断点（FPB 等）。 */
  kind: 'sw' | 'hw';
  /** 是否处于启用状态。 */
  enabled: boolean;
}

/** 内存读写区间。 */
export interface MemoryRange {
  address: number;
  length: number;
}

/** CPU 寄存器键值对。 */
export interface RegisterValue {
  name: string;
  value: number;
}

/** RTT 通道元数据。 */
export interface RttChannelInfo {
  index: number;
  name: string;
  /** up = target → host；down = host → target。 */
  direction: 'up' | 'down';
  /** 目标 RTT buffer 容量；0 表示当前 transport 未报告真实目标容量。 */
  bufferSize: number;
}

/** rttRead 返回值。 */
export interface RttReadResult {
  /** 原始字节；MCP 层 base64 编码后再发往客户端。 */
  data: Buffer;
  channelIndex: number;
  /** 当 maxBytes 不足以容纳本次硬件可读数据时为 true。 */
  truncated: boolean;
}

/** flashDownload 运行阶段。 */
export type FlashProgressPhase =
  | 'preparing'
  | 'erasing'
  | 'programming'
  | 'verifying'
  | 'readback'
  | 'completed';

/** flashDownload 实时进度快照；由后台 job 轮询面消费。 */
export interface FlashProgressUpdate {
  phase: FlashProgressPhase;
  message: string;
  percent?: number;
  bytesWritten?: number;
  bytesTotal?: number;
}

/** flashDownload 选项。 */
export interface FlashDownloadOptions {
  /** 烧录目标地址；缺省让 backend 用 binary 自带的 image header 决定。 */
  address?: number;
  /** 烧录后是否再读回校验。 */
  verify?: boolean;
  /** 覆盖单次 Commander 烧录进程超时，单位毫秒；缺省使用 backend 默认值。 */
  timeoutMs?: number;
  /** 可选实时进度回调；仅在进程内使用，不跨 MCP JSON 边界传递。 */
  onProgress?: (update: FlashProgressUpdate) => void;
}

/** J-Link probe 自身 reboot 选项；不要求先连接目标 MCU。 */
export interface JLinkRebootOptions {
  /** 多 J-Link 机器上指定要 reboot 的物理 probe；MCP 出参不得回显该值。 */
  serialNumber?: string;
  /** 是否强制 reboot；缺省 true，用于恢复卡死或被其它进程占用的 probe。 */
  force?: boolean;
  /** 传给 SEGGER Reboot 命令的重连等待时间，单位毫秒。 */
  reconnectTimeoutMs?: number;
  /** Commander 进程整体超时，单位毫秒。 */
  timeoutMs?: number;
}

/** 受控 J-Link Commander 脚本执行结果；输出已在 backend 边界做序列号脱敏。 */
export interface CommanderScriptResult {
  /** Commander 进程退出码；被信号终止时为 null。 */
  exitCode: number | null;
  /** 终止信号；正常退出时为 null。 */
  signal: NodeJS.Signals | null;
  /** 脱敏后的 stdout。 */
  stdout: string;
  /** 脱敏后的 stderr。 */
  stderr: string;
  /** stdout/stderr 超过保留上限时为 true。 */
  truncated?: boolean;
}

/** GDB server 启动后的连接信息。 */
export interface GdbServerHandle {
  port: number;
  host: string;
}

/** snapshotCapture 返回的 CPU + 内存快照。 */
export interface SnapshotResult {
  pc: number;
  sp: number;
  registers: RegisterValue[];
  memorySnippets: Array<{ address: number; data: Buffer }>;
  /** 快照采样的 unix 毫秒时间戳。 */
  capturedAt: number;
}

/** crashDiagnose 返回的故障诊断结构（仅当 CPU 处于 fault handler 时有意义）。 */
export interface CrashDiagnosis {
  /** 故障类别。 */
  fault: 'hardfault' | 'memmanage' | 'busfault' | 'usagefault' | 'unknown';
  pc: number;
  lr: number;
  sp: number;
  /** 人类可读的故障原因（backend 自行汇总）。 */
  reason: string;
  /** 调用栈帧序列；symbol 由 backend 解析（可能缺失）。 */
  stackTrace: Array<{ pc: number; symbol?: string }>;
}

/**
 * J-Link backend 抽象。
 *
 * 单一接口（不拆 sub-interface）：partial backend 类型正确语义未实现的 mock 漂移
 * 风险高（详见 docs/phase-decisions/Phase9.md Q&A）。所有方法异步；错误以 `JLinkError`
 * 子类形式抛出，MCP 层 `translateJLinkError` 负责翻译。
 *
 * **不变量**：实现者在所有非 lifecycle 方法的入口必须先校验 probeId（不存在抛
 * `ProbeNotFoundError`）。`signal?.aborted === true` 时长操作必须立即抛
 * `JLinkAbortedError`，不得落实任何副作用。
 */
export interface IJLinkBackend {
  // -- probe lifecycle --

  /** 枚举当前可见的物理 probe（未 connect 也会列出）。 */
  probeDetect(): Promise<ProbeInfo[]>;

  /**
   * 连接 probe + 选目标 device。成功后返回的 `probeId` 用作所有后续调用的 handle。
   * @throws JLinkInvalidStateError target 缺失或非法
   * @throws JLinkOperationError 物理连接失败
   */
  probeConnect(opts: ProbeConnectOptions): Promise<ProbeInfo>;

  /**
   * 断开 probe 并释放内部句柄；之后 probeId 失效。
   * @throws ProbeNotFoundError 未 connect 或已 disconnect
   */
  probeDisconnect(probeId: string): Promise<void>;

  /**
   * 查询 probe 当前连接状态与元信息。
   * @throws ProbeNotFoundError
   */
  probeStatus(probeId: string): Promise<ProbeInfo>;

  /**
   * Reboot J-Link probe 本体，不要求先成功 probeConnect/target connect。
   * 用于恢复 J-Link 红灯卡死、USB transport 挂住或外部工具占用后的探针状态。
   */
  jlinkReboot(opts?: JLinkRebootOptions, signal?: AbortSignal): Promise<CommanderScriptResult>;

  // -- cpu control --

  /** 复位 CPU；`opts.halt=true` 时复位后立即停在第一条指令。 */
  cpuReset(probeId: string, opts?: { halt?: boolean }): Promise<void>;
  /** 停机（halt）当前执行。 */
  cpuHalt(probeId: string): Promise<void>;
  /** 解除 halt，让 CPU 自由运行。 */
  cpuRun(probeId: string): Promise<void>;
  /** 单步执行一条指令（要求 CPU 已 halt）。 */
  cpuStep(probeId: string): Promise<void>;

  // -- breakpoints --

  /** 在 address 上设置断点；返回新断点的描述。 */
  breakpointSet(
    probeId: string,
    address: number,
    opts?: { kind?: 'sw' | 'hw' },
  ): Promise<BreakpointSpec>;
  /** 清除指定 id 的断点。 */
  breakpointClear(probeId: string, id: number): Promise<void>;
  /** 列出当前所有已设置断点。 */
  breakpointList(probeId: string): Promise<BreakpointSpec[]>;

  // -- registers --

  /** 读取单个寄存器（支持 r0~r15 / sp / pc / xpsr 等）。 */
  registerRead(probeId: string, name: string): Promise<RegisterValue>;
  /** 写入寄存器（仅 halt 状态下安全）。 */
  registerWrite(probeId: string, name: string, value: number): Promise<void>;
  /** 列出当前 architecture 暴露的全部寄存器值。 */
  registerList(probeId: string): Promise<RegisterValue[]>;

  // -- memory --

  /** 读取连续地址范围；返回原始字节。 */
  memoryRead(probeId: string, range: MemoryRange): Promise<Buffer>;
  /** 写入连续地址范围。 */
  memoryWrite(probeId: string, address: number, data: Buffer): Promise<void>;

  // -- flash --

  /**
   * 烧录二进制到 flash。
   * @param signal 可选取消信号（长操作）。
   * @returns 已写入字节数 + 是否完成 verify
   */
  flashDownload(
    probeId: string,
    binary: Buffer,
    opts?: FlashDownloadOptions,
    signal?: AbortSignal,
  ): Promise<{ bytesWritten: number; verified: boolean }>;

  /** 擦除 flash；缺省擦除整个芯片。 */
  flashErase(probeId: string, opts?: { address?: number; length?: number }): Promise<void>;

  /** 写入指定地址的 flash 数据（不擦除）。 */
  flashWrite(probeId: string, address: number, data: Buffer): Promise<void>;

  /**
   * 校验 flash 内容与给定 binary 是否一致。
   * @returns ok=true 表示完全一致；不一致时 mismatchAt 给出首个差异地址
   */
  flashVerify(
    probeId: string,
    binary: Buffer,
    opts?: { address?: number; timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; mismatchAt?: number }>;

  // -- RTT --

  /** 连接 RTT control block；返回当前可见的所有通道。 */
  rttConnect(
    probeId: string,
    opts?: { controlBlockAddress?: number },
  ): Promise<{ channels: RttChannelInfo[] }>;

  /**
   * 读取指定 RTT up 通道。一次调用读到的字节由硬件读指针推进；
   * 上层多次轮询即可。`maxBytes` 是本次返回的硬上限。
   */
  rttRead(probeId: string, channelIndex: number, maxBytes: number): Promise<RttReadResult>;

  /**
   * 写入指定 RTT down 通道。当前 SEGGER RTT telnet backend 使用同一 socket 写入目标。
   */
  rttWrite(probeId: string, channelIndex: number, data: Buffer): Promise<void>;

  /** 清空（drain）指定 RTT 通道当前缓冲。 */
  rttClear(probeId: string, channelIndex: number): Promise<void>;

  /**
   * 在指定通道的当前缓冲中搜索 pattern；不消费数据。
   * @returns 命中位置（字节偏移）+ 命中前后的预览段
   */
  rttSearch(
    probeId: string,
    channelIndex: number,
    pattern: string,
    maxBytes: number,
  ): Promise<{ matchAt: number | null; preview: Buffer }>;

  // -- GDB --

  /**
   * 启动 GDB server，返回监听端点。
   * @param signal 可选取消信号（绑定端口可能耗时）。
   */
  gdbServerStart(
    probeId: string,
    opts?: { port?: number; host?: string },
    signal?: AbortSignal,
  ): Promise<GdbServerHandle>;

  /** 停止 GDB server。 */
  gdbServerStop(probeId: string): Promise<void>;

  // -- diagnostics --

  /**
   * 运行受控 J-Link Commander 诊断脚本。连接参数由 LinkTerm 根据 probe handle 生成，
   * `commands` 只承载连接之后的白名单命令。
   */
  runCommanderScript(
    probeId: string,
    commands: string[],
    opts?: { timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<CommanderScriptResult>;

  /** 抓取 CPU 寄存器 + 给定地址范围的内存快照（用于事后分析）。 */
  snapshotCapture(probeId: string, ranges: MemoryRange[]): Promise<SnapshotResult>;

  /** 解析当前 fault handler 上下文，返回结构化诊断。 */
  crashDiagnose(probeId: string): Promise<CrashDiagnosis>;
}
