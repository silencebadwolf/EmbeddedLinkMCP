/**
 * JLinkAdapter：LinkTerm 内置 J-Link backend。
 *
 * 当前实现保留 Phase 9 的 probe lifecycle（connect/disconnect/status/detect），并实现
 * CPU 控制、断点、寄存器、内存、flash erase/write/download/verify、RTT、GDB server
 * lifecycle 与 Cortex-M snapshot/crash diagnosis。实际 SEGGER 命令只封装在 src/jlink/
 * 内部，MCP/IPC/renderer 均不得绕过 IJLinkBackend 直接调用 J-Link CLI。
 *
 * 不变量：
 * - **probeId 用 `crypto.randomUUID()` 唯一 mint**：避免序列号泄漏（贴在硬件上、
 *   有时是 license key），同时让 adapter 自由 remap 物理 probe；
 * - **Map 是唯一持久状态**：disconnect 即从 Map 删除，之后 probeId 永久失效；
 * - **`requireProbe(probeId)` 是所有非 lifecycle 方法的入口**：未注册立即抛
 *   `ProbeNotFoundError`，避免 partial state；
 * - **每个 probe 一次只允许一个 SEGGER 前台操作**：并发 flash/verify 立即抛
 *   `ProbeBusyError`，避免 Commander/GDB/RTT 抢同一物理 probe。
 */

import { randomUUID } from 'node:crypto';
import type {
  BreakpointSpec,
  CrashDiagnosis,
  FlashDownloadOptions,
  GdbServerHandle,
  IJLinkBackend,
  MemoryRange,
  ProbeConnectOptions,
  ProbeInfo,
  RegisterValue,
  RttChannelInfo,
  RttReadResult,
  SnapshotResult,
} from './types.js';
import {
  JLinkAbortedError,
  JLinkInvalidStateError,
  ProbeBusyError,
  ProbeNotFoundError,
} from './errors.js';
import {
  DefaultJLinkCommanderClient,
  DefaultJLinkGdbServerClient,
  NetJLinkRttClient,
  type CommanderProbeContext,
  type JLinkCommanderAvailability,
  type JLinkCommanderClient,
  type JLinkGdbServerAvailability,
  type JLinkGdbServerClient,
  type JLinkGdbServerSession,
  type JLinkRttClient,
  type JLinkRttSession,
} from './segger-command-runner.js';

/** JLinkAdapter 的可注入依赖；生产默认使用 SEGGER Commander/GDB server，测试注入 fake。 */
export interface JLinkAdapterOptions {
  /** J-Link Commander client used for real flash download/verify. */
  commander?: JLinkCommanderClient;
  /** J-Link GDB server client used for managed debug sessions. */
  gdbServer?: JLinkGdbServerClient;
  /** RTT telnet client used for backend-owned RTT sessions. */
  rttClient?: JLinkRttClient;
}

/** adapter 内部持有的 probe handle。 */
interface ProbeHandle {
  probeId: string;
  target: string;
  interface?: 'swd' | 'jtag';
  speedKHz?: number;
  serialNumber?: string;
  probeKey: string;
  busy: boolean;
  breakpoints: Map<number, BreakpointSpec>;
  nextBreakpointId: number;
  gdbServer?: JLinkGdbServerSession;
  rttSession?: JLinkRttSession;
}

const DEFAULT_PROBE_SELECTION_KEY = 'default-probe-selection';
const CORTEX_M_FAULT_REGISTERS_BASE = 0xe000_ed28;

interface CortexMFaultRegisters {
  cfsr: number;
  hfsr: number;
  mmfar: number;
  bfar: number;
}

/**
 * J-Link backend 的真实适配器壳。
 *
 * Phase 9 仅实现探针生命周期；其它方法 stub。Phase 13+ 替换为真实 SEGGER J-Link
 * 调用时只需扩展非 lifecycle 方法的实现，不触动接口或上层 MCP 工具。
 */
export class JLinkAdapter implements IJLinkBackend {
  readonly #probes = new Map<string, ProbeHandle>();
  readonly #busyProbeKeys = new Set<string>();
  readonly #commander: JLinkCommanderClient;
  readonly #gdbServer: JLinkGdbServerClient;
  readonly #rttClient: JLinkRttClient;

  /**
   * 创建 J-Link adapter.
   *
   * @param options 可注入的 Commander client；测试用 fake，生产默认使用 SEGGER Commander
   */
  constructor(options: JLinkAdapterOptions = {}) {
    this.#commander = options.commander ?? new DefaultJLinkCommanderClient();
    this.#gdbServer = options.gdbServer ?? new DefaultJLinkGdbServerClient();
    this.#rttClient = options.rttClient ?? new NetJLinkRttClient();
  }

  /**
   * 检查 LinkTerm 是否能解析可信的 J-Link Commander 路径，并可选校验目标芯片数据库。
   *
   * @param target 可选 SEGGER 目标名；传入时会做本地 device database 预检
   * @returns Commander 可用性；自定义 commander 未暴露检查能力时视为由注入方保证可用
   */
  checkCommanderAvailability(target?: string): JLinkCommanderAvailability {
    return this.#commander.checkAvailability?.(target) ?? { available: true };
  }

  /**
   * 检查 LinkTerm 是否能解析可信的 J-Link GDB server 路径，并可选校验目标芯片数据库。
   *
   * @param target 可选 SEGGER 目标名；传入时会做本地 device database 预检
   * @returns GDB server 可用性；自定义 client 未暴露检查能力时视为由注入方保证可用
   */
  checkGdbServerAvailability(target?: string): JLinkGdbServerAvailability {
    return this.#gdbServer.checkAvailability?.(target) ?? { available: true };
  }

  // -- probe lifecycle --

  /**
   * 当前阶段不主动连接真实硬件枚举，仅返回当前 adapter 已连接的 handle 投影。
   * 后续接入物理 probe discovery 时仍需在 MCP 边界剥离 serialNumber。
   */
  async probeDetect(): Promise<ProbeInfo[]> {
    return Array.from(this.#probes.values()).map((handle) => this.#toProbeInfo(handle));
  }

  /**
   * mint 一个 UUID v4 作为 probeId，记录 handle，返回 ProbeInfo。
   *
   * @throws JLinkInvalidStateError target 字段缺失或为空字符串
   */
  async probeConnect(opts: ProbeConnectOptions): Promise<ProbeInfo> {
    if (!opts || typeof opts.target !== 'string' || opts.target.trim() === '') {
      throw new JLinkInvalidStateError('probeConnect requires a non-empty target', {
        expected: 'non-empty string',
        actual: `"${opts?.target ?? ''}"`,
      });
    }
    const probeId = randomUUID();
    const handle: ProbeHandle = {
      probeId,
      target: opts.target,
      ...(opts.interface !== undefined ? { interface: opts.interface } : {}),
      ...(opts.speedKHz !== undefined ? { speedKHz: opts.speedKHz } : {}),
      ...(opts.serialNumber !== undefined ? { serialNumber: opts.serialNumber } : {}),
      probeKey: this.#probeOperationKey(opts),
      busy: false,
      breakpoints: new Map<number, BreakpointSpec>(),
      nextBreakpointId: 1,
    };
    this.#probes.set(probeId, handle);
    return this.#toProbeInfo(handle);
  }

  /** 删除 handle；之后 probeId 永久失效。 */
  async probeDisconnect(probeId: string): Promise<void> {
    const handle = this.#requireProbe(probeId);
    if (handle.busy || this.#isProbeSelectionBusy(handle.probeKey)) {
      throw new ProbeBusyError(probeId);
    }
    if (handle.rttSession !== undefined) {
      await handle.rttSession.close();
      handle.rttSession = undefined;
    }
    if (handle.gdbServer !== undefined) {
      await handle.gdbServer.stop();
      handle.gdbServer = undefined;
    }
    this.#probes.delete(probeId);
  }

  /** 返回 handle 当前 ProbeInfo。 */
  async probeStatus(probeId: string): Promise<ProbeInfo> {
    const handle = this.#requireProbe(probeId);
    return this.#toProbeInfo(handle);
  }

  // -- cpu control ----------------------------------------------------

  /** 通过 Commander 复位目标 CPU；halt=false 时复位后继续运行，供串口观察新启动输出。 */
  async cpuReset(probeId: string, opts?: { halt?: boolean }): Promise<void> {
    const handle = this.#requireProbe(probeId);
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.reset(this.#toCommanderContext(handle), opts);
    });
  }

  async cpuHalt(probeId: string): Promise<void> {
    const handle = this.#requireProbe(probeId);
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.halt(this.#toCommanderContext(handle));
    });
  }

  async cpuRun(probeId: string): Promise<void> {
    const handle = this.#requireProbe(probeId);
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.run(this.#toCommanderContext(handle));
    });
  }

  async cpuStep(probeId: string): Promise<void> {
    const handle = this.#requireProbe(probeId);
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.step(this.#toCommanderContext(handle));
    });
  }

  // -- breakpoints ----------------------------------------------------

  async breakpointSet(
    probeId: string,
    address: number,
    opts?: { kind?: 'sw' | 'hw' },
  ): Promise<BreakpointSpec> {
    const handle = this.#requireProbe(probeId);
    const kind = opts?.kind ?? 'sw';
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.setBreakpoint(this.#toCommanderContext(handle), address, kind);
    });
    const breakpoint: BreakpointSpec = {
      id: handle.nextBreakpointId,
      address,
      kind,
      enabled: true,
    };
    handle.nextBreakpointId += 1;
    handle.breakpoints.set(breakpoint.id, breakpoint);
    return breakpoint;
  }

  async breakpointClear(probeId: string, id: number): Promise<void> {
    const handle = this.#requireProbe(probeId);
    const breakpoint = handle.breakpoints.get(id);
    if (breakpoint === undefined) {
      throw new JLinkInvalidStateError('Unknown breakpoint id', {
        expected: 'known breakpoint id',
        actual: String(id),
      });
    }
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.clearBreakpoint(this.#toCommanderContext(handle), breakpoint.address);
    });
    handle.breakpoints.delete(id);
  }

  async breakpointList(probeId: string): Promise<BreakpointSpec[]> {
    const handle = this.#requireProbe(probeId);
    return Array.from(handle.breakpoints.values());
  }

  // -- registers ------------------------------------------------------

  async registerRead(probeId: string, name: string): Promise<RegisterValue> {
    const handle = this.#requireProbe(probeId);
    return this.#withProbeOperation(handle, async () => this.#commander.readRegister(this.#toCommanderContext(handle), name));
  }

  async registerWrite(probeId: string, name: string, value: number): Promise<void> {
    const handle = this.#requireProbe(probeId);
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.writeRegister(this.#toCommanderContext(handle), name, value);
    });
  }

  async registerList(probeId: string): Promise<RegisterValue[]> {
    const handle = this.#requireProbe(probeId);
    return this.#withProbeOperation(handle, async () => this.#commander.listRegisters(this.#toCommanderContext(handle)));
  }

  // -- memory (stub) --

  async memoryRead(probeId: string, range: MemoryRange): Promise<Buffer> {
    const handle = this.#requireProbe(probeId);
    return this.#withProbeOperation(handle, async () => this.#commander.readMemory(this.#toCommanderContext(handle), range));
  }

  async memoryWrite(probeId: string, address: number, data: Buffer): Promise<void> {
    const handle = this.#requireProbe(probeId);
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.writeMemory(this.#toCommanderContext(handle), address, data);
    });
  }

  // -- flash (stub) --

  async flashDownload(
    probeId: string,
    binary: Buffer,
    opts?: FlashDownloadOptions,
    signal?: AbortSignal,
  ): Promise<{ bytesWritten: number; verified: boolean }> {
    this.#throwIfAborted(signal);
    const handle = this.#requireProbe(probeId);
    const address = opts?.address;
    if (address === undefined) {
      throw new JLinkInvalidStateError('flashDownload requires an explicit address for raw binary input', {
        expected: 'address number',
        actual: 'undefined',
      });
    }
    return this.#withProbeOperation(handle, async () => {
      this.#throwIfAborted(signal);
      return this.#commander.download(
        this.#toCommanderContext(handle),
        binary,
        { address, verify: opts?.verify === true },
        signal,
      );
    });
  }

  async flashErase(
    probeId: string,
    opts?: { address?: number; length?: number },
  ): Promise<void> {
    const handle = this.#requireProbe(probeId);
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.eraseFlash(this.#toCommanderContext(handle), opts);
    });
  }

  async flashWrite(probeId: string, address: number, data: Buffer): Promise<void> {
    const handle = this.#requireProbe(probeId);
    await this.#withProbeOperation(handle, async () => {
      await this.#commander.writeFlash(this.#toCommanderContext(handle), address, data);
    });
  }

  async flashVerify(
    probeId: string,
    binary: Buffer,
    opts?: { address?: number },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; mismatchAt?: number }> {
    this.#throwIfAborted(signal);
    const handle = this.#requireProbe(probeId);
    const address = opts?.address;
    if (address === undefined) {
      throw new JLinkInvalidStateError('flashVerify requires an explicit address for raw binary input', {
        expected: 'address number',
        actual: 'undefined',
      });
    }
    return this.#withProbeOperation(handle, async () => {
      this.#throwIfAborted(signal);
      return this.#commander.verify(
        this.#toCommanderContext(handle),
        binary,
        { address },
        signal,
      );
    });
  }

  // -- RTT ------------------------------------------------------------

  async rttConnect(
    probeId: string,
    _opts?: { controlBlockAddress?: number },
  ): Promise<{ channels: RttChannelInfo[] }> {
    const handle = this.#requireProbe(probeId);
    const gdbServer = handle.gdbServer;
    if (gdbServer === undefined || gdbServer.rttTelnetPort === undefined) {
      throw new JLinkInvalidStateError('RTT requires a running GDB server with RTT telnet enabled', {
        expected: 'running GDB server session with rttTelnetPort',
        actual: 'not connected',
      });
    }
    if (handle.rttSession !== undefined) {
      await handle.rttSession.close();
      handle.rttSession = undefined;
    }
    const session = await this.#rttClient.connect({ host: gdbServer.host, port: gdbServer.rttTelnetPort });
    handle.rttSession = session;
    return { channels: session.channels };
  }

  async rttRead(probeId: string, channelIndex: number, maxBytes: number): Promise<RttReadResult> {
    const session = this.#requireRttSession(probeId);
    return session.read(channelIndex, maxBytes);
  }

  async rttClear(probeId: string, channelIndex: number): Promise<void> {
    const session = this.#requireRttSession(probeId);
    await session.clear(channelIndex);
  }

  async rttSearch(
    probeId: string,
    channelIndex: number,
    pattern: string,
    maxBytes: number,
  ): Promise<{ matchAt: number | null; preview: Buffer }> {
    const session = this.#requireRttSession(probeId);
    return session.search(channelIndex, pattern, maxBytes);
  }

  // -- GDB ------------------------------------------------------------

  async gdbServerStart(
    probeId: string,
    opts?: { port?: number; host?: string },
    signal?: AbortSignal,
  ): Promise<GdbServerHandle> {
    this.#throwIfAborted(signal);
    const handle = this.#requireProbe(probeId);
    const requestedHost = opts?.host ?? '127.0.0.1';
    const requestedPort = opts?.port ?? 2331;
    if (handle.gdbServer !== undefined) {
      if (handle.gdbServer.host === requestedHost && handle.gdbServer.port === requestedPort) {
        return { host: handle.gdbServer.host, port: handle.gdbServer.port };
      }
      throw new ProbeBusyError(probeId, 'Probe already has a running GDB server on a different endpoint');
    }
    const session = await this.#withProbeOperation(handle, async () => {
      this.#throwIfAborted(signal);
      return this.#gdbServer.start(this.#toCommanderContext(handle), opts, signal);
    });
    handle.gdbServer = session;
    return { host: session.host, port: session.port };
  }

  async gdbServerStop(probeId: string): Promise<void> {
    const handle = this.#requireProbe(probeId);
    if (handle.rttSession !== undefined) {
      await handle.rttSession.close();
      handle.rttSession = undefined;
    }
    const session = handle.gdbServer;
    if (session === undefined) return;
    handle.gdbServer = undefined;
    await session.stop();
  }

  // -- diagnostics ---------------------------------------------------

  async snapshotCapture(probeId: string, ranges: MemoryRange[]): Promise<SnapshotResult> {
    const handle = this.#requireProbe(probeId);
    return this.#withProbeOperation(handle, async () => {
      const context = this.#toCommanderContext(handle);
      const registers = await this.#commander.listRegisters(context);
      const pc = findRegisterValue(registers, 'pc') ?? 0;
      const sp = findRegisterValue(registers, 'sp') ?? 0;
      const memorySnippets = [];
      for (const range of ranges) {
        memorySnippets.push({ address: range.address, data: await this.#commander.readMemory(context, range) });
      }
      return {
        pc,
        sp,
        registers,
        memorySnippets,
        capturedAt: Date.now(),
      };
    });
  }

  async crashDiagnose(probeId: string): Promise<CrashDiagnosis> {
    const handle = this.#requireProbe(probeId);
    return this.#withProbeOperation(handle, async () => {
      const context = this.#toCommanderContext(handle);
      const registers = await this.#commander.listRegisters(context);
      const pc = findRegisterValue(registers, 'pc') ?? 0;
      const lr = findRegisterValue(registers, 'lr') ?? 0;
      const sp = findRegisterValue(registers, 'sp') ?? 0;
      const faultRegisters = decodeCortexMFaultRegisters(
        await this.#commander.readMemory(context, { address: CORTEX_M_FAULT_REGISTERS_BASE, length: 16 }),
      );
      const fault = classifyCortexMFault(faultRegisters);
      const reason = describeCortexMFault(faultRegisters, fault);
      return {
        fault,
        pc,
        lr,
        sp,
        reason,
        stackTrace: pc === 0 ? [] : [{ pc }],
      };
    });
  }

  // -- internals --

  /**
   * 内部辅助：定位 probe handle，缺失抛 ProbeNotFoundError。
   * 所有非 lifecycle 方法的入口都先调它。
   */
  #requireProbe(probeId: string): ProbeHandle {
    const handle = this.#probes.get(probeId);
    if (!handle) {
      throw new ProbeNotFoundError(probeId);
    }
    return handle;
  }

  /** 内部辅助：定位已连接 RTT session；未 connect 时抛状态错误。 */
  #requireRttSession(probeId: string): JLinkRttSession {
    const handle = this.#requireProbe(probeId);
    if (handle.rttSession === undefined) {
      throw new JLinkInvalidStateError('RTT is not connected for this probe', {
        expected: 'rttConnect called successfully before rttRead/rttSearch/rttClear',
        actual: 'not connected',
      });
    }
    return handle.rttSession;
  }

  /** Handle → Commander context 投影。 */
  #toCommanderContext(handle: ProbeHandle): CommanderProbeContext {
    return {
      target: handle.target,
      ...(handle.interface !== undefined ? { interface: handle.interface } : {}),
      ...(handle.speedKHz !== undefined ? { speedKHz: handle.speedKHz } : {}),
      ...(handle.serialNumber !== undefined ? { serialNumber: handle.serialNumber } : {}),
    };
  }

  /** 生成物理 probe 级操作锁 key；未指定序列号时保守串行化所有默认选择操作。 */
  #probeOperationKey(opts: ProbeConnectOptions): string {
    const serialNumber = opts.serialNumber?.trim();
    return serialNumber === undefined || serialNumber === '' ? DEFAULT_PROBE_SELECTION_KEY : `serial:${serialNumber}`;
  }

  /** 判断 probe 选择器是否与当前忙碌操作冲突；默认选择必须与所有操作互斥。 */
  #isProbeSelectionBusy(probeKey: string): boolean {
    return (
      this.#busyProbeKeys.has(probeKey) ||
      this.#busyProbeKeys.has(DEFAULT_PROBE_SELECTION_KEY) ||
      (probeKey === DEFAULT_PROBE_SELECTION_KEY && this.#busyProbeKeys.size > 0)
    );
  }

  /** 在物理 probe 上串行化高影响 J-Link 操作；并发时立即拒绝。 */
  async #withProbeOperation<T>(handle: ProbeHandle, fn: () => Promise<T>): Promise<T> {
    if (handle.busy || this.#isProbeSelectionBusy(handle.probeKey)) {
      throw new ProbeBusyError(handle.probeId);
    }
    handle.busy = true;
    this.#busyProbeKeys.add(handle.probeKey);
    try {
      return await fn();
    } finally {
      handle.busy = false;
      this.#busyProbeKeys.delete(handle.probeKey);
    }
  }

  /** AbortSignal 已取消时立即抛出统一 J-Link 取消错误。 */
  #throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new JLinkAbortedError();
    }
  }

  /** Handle → 暴露给上层的 ProbeInfo 投影。 */
  #toProbeInfo(handle: ProbeHandle): ProbeInfo {
    return {
      probeId: handle.probeId,
      target: handle.target,
      ...(handle.serialNumber !== undefined ? { serialNumber: handle.serialNumber } : {}),
      connected: true,
    };
  }
}

function findRegisterValue(registers: RegisterValue[], name: string): number | undefined {
  return registers.find((register) => register.name.toLowerCase() === name)?.value;
}

function decodeCortexMFaultRegisters(data: Buffer): CortexMFaultRegisters {
  return {
    cfsr: data.length >= 4 ? data.readUInt32LE(0) : 0,
    hfsr: data.length >= 8 ? data.readUInt32LE(4) : 0,
    mmfar: data.length >= 12 ? data.readUInt32LE(8) : 0,
    bfar: data.length >= 16 ? data.readUInt32LE(12) : 0,
  };
}

function classifyCortexMFault(registers: CortexMFaultRegisters): CrashDiagnosis['fault'] {
  if ((registers.hfsr & 0x4000_0000) !== 0) return 'hardfault';
  if ((registers.cfsr & 0x0000_00ff) !== 0) return 'memmanage';
  if ((registers.cfsr & 0x0000_ff00) !== 0) return 'busfault';
  if ((registers.cfsr & 0xffff_0000) !== 0) return 'usagefault';
  return 'unknown';
}

function describeCortexMFault(registers: CortexMFaultRegisters, fault: CrashDiagnosis['fault']): string {
  const reasons: string[] = [];
  if ((registers.hfsr & 0x4000_0000) !== 0) reasons.push('HFSR.FORCED');
  if ((registers.hfsr & 0x0000_0002) !== 0) reasons.push('HFSR.VECTTBL');
  if ((registers.cfsr & 0x0200_0000) !== 0) reasons.push('UFSR.DIVBYZERO');
  if ((registers.cfsr & 0x0100_0000) !== 0) reasons.push('UFSR.UNALIGNED');
  if ((registers.cfsr & 0x0002_0000) !== 0) reasons.push('UFSR.INVSTATE');
  if ((registers.cfsr & 0x0000_0200) !== 0) reasons.push('BFSR.PRECISERR');
  if ((registers.cfsr & 0x0000_0100) !== 0) reasons.push('BFSR.IBUSERR');
  if ((registers.cfsr & 0x0000_0002) !== 0) reasons.push('MMFSR.DACCVIOL');
  if ((registers.cfsr & 0x0000_0001) !== 0) reasons.push('MMFSR.IACCVIOL');
  if (reasons.length === 0 || fault === 'unknown') return 'No active Cortex-M fault bits were detected';
  return `Cortex-M ${fault}: ${reasons.join(', ')}`;
}
