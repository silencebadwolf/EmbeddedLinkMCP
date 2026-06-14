/**
 * JLinkAdapter：Phase 9 的真实 backend 占位实现。
 *
 * 当前阶段只实现 probe lifecycle（connect/disconnect/status/detect）以验证
 * MCP 端到端链路；其余 24 个方法在确认 probeId 存在后立即抛
 * {@link JLinkNotImplementedError}（NOT_IMPLEMENTED）。Phase 13 接入真实
 * SEGGER J-Link 时只动本文件，不动 MCP 层。
 *
 * 不变量：
 * - **probeId 用 `crypto.randomUUID()` 唯一 mint**：避免序列号泄漏（贴在硬件上、
 *   有时是 license key），同时让 adapter 自由 remap 物理 probe；
 * - **Map 是唯一持久状态**：disconnect 即从 Map 删除，之后 probeId 永久失效；
 * - **`requireProbe(probeId)` 是所有非 lifecycle 方法的入口**：未注册立即抛
 *   `ProbeNotFoundError`，避免 partial state。
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
  JLinkInvalidStateError,
  JLinkNotImplementedError,
  ProbeNotFoundError,
} from './errors.js';

/** adapter 内部持有的 probe handle。
 *  （speed/interface 跟踪推迟到 Phase 13 接入真实 backend 时实现）
 */
interface ProbeHandle {
  probeId: string;
  target: string;
  serialNumber?: string;
}

/**
 * J-Link backend 的真实适配器壳。
 *
 * Phase 9 仅实现探针生命周期；其它方法 stub。Phase 13+ 替换为真实 SEGGER J-Link
 * 调用时只需扩展非 lifecycle 方法的实现，不触动接口或上层 MCP 工具。
 */
export class JLinkAdapter implements IJLinkBackend {
  readonly #probes = new Map<string, ProbeHandle>();

  // -- probe lifecycle --

  /**
   * 当前阶段不连接真实硬件，仅返回空数组（占位）。Phase 13+ 接入 J-Link 枚举 API。
   */
  async probeDetect(): Promise<ProbeInfo[]> {
    return [];
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
      ...(opts.serialNumber !== undefined ? { serialNumber: opts.serialNumber } : {}),
    };
    this.#probes.set(probeId, handle);
    return this.#toProbeInfo(handle);
  }

  /** 删除 handle；之后 probeId 永久失效。 */
  async probeDisconnect(probeId: string): Promise<void> {
    if (!this.#probes.has(probeId)) {
      throw new ProbeNotFoundError(probeId);
    }
    this.#probes.delete(probeId);
  }

  /** 返回 handle 当前 ProbeInfo。 */
  async probeStatus(probeId: string): Promise<ProbeInfo> {
    const handle = this.#requireProbe(probeId);
    return this.#toProbeInfo(handle);
  }

  // -- cpu control (stub) --

  async cpuReset(probeId: string, _opts?: { halt?: boolean }): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('cpuReset');
  }

  async cpuHalt(probeId: string): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('cpuHalt');
  }

  async cpuRun(probeId: string): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('cpuRun');
  }

  async cpuStep(probeId: string): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('cpuStep');
  }

  // -- breakpoints (stub) --

  async breakpointSet(
    probeId: string,
    _address: number,
    _opts?: { kind?: 'sw' | 'hw' },
  ): Promise<BreakpointSpec> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('breakpointSet');
  }

  async breakpointClear(probeId: string, _id: number): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('breakpointClear');
  }

  async breakpointList(probeId: string): Promise<BreakpointSpec[]> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('breakpointList');
  }

  // -- registers (stub) --

  async registerRead(probeId: string, _name: string): Promise<RegisterValue> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('registerRead');
  }

  async registerWrite(probeId: string, _name: string, _value: number): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('registerWrite');
  }

  async registerList(probeId: string): Promise<RegisterValue[]> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('registerList');
  }

  // -- memory (stub) --

  async memoryRead(probeId: string, _range: MemoryRange): Promise<Buffer> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('memoryRead');
  }

  async memoryWrite(probeId: string, _address: number, _data: Buffer): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('memoryWrite');
  }

  // -- flash (stub) --

  async flashDownload(
    probeId: string,
    _binary: Buffer,
    _opts?: FlashDownloadOptions,
    _signal?: AbortSignal,
  ): Promise<{ bytesWritten: number; verified: boolean }> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('flashDownload');
  }

  async flashErase(
    probeId: string,
    _opts?: { address?: number; length?: number },
  ): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('flashErase');
  }

  async flashWrite(probeId: string, _address: number, _data: Buffer): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('flashWrite');
  }

  async flashVerify(
    probeId: string,
    _binary: Buffer,
    _opts?: { address?: number },
    _signal?: AbortSignal,
  ): Promise<{ ok: boolean; mismatchAt?: number }> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('flashVerify');
  }

  // -- RTT (stub) --

  async rttConnect(
    probeId: string,
    _opts?: { controlBlockAddress?: number },
  ): Promise<{ channels: RttChannelInfo[] }> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('rttConnect');
  }

  async rttRead(probeId: string, _channelIndex: number, _maxBytes: number): Promise<RttReadResult> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('rttRead');
  }

  async rttClear(probeId: string, _channelIndex: number): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('rttClear');
  }

  async rttSearch(
    probeId: string,
    _channelIndex: number,
    _pattern: string,
    _maxBytes: number,
  ): Promise<{ matchAt: number | null; preview: Buffer }> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('rttSearch');
  }

  // -- GDB (stub) --

  async gdbServerStart(
    probeId: string,
    _opts?: { port?: number; host?: string },
    _signal?: AbortSignal,
  ): Promise<GdbServerHandle> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('gdbServerStart');
  }

  async gdbServerStop(probeId: string): Promise<void> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('gdbServerStop');
  }

  // -- diagnostics (stub) --

  async snapshotCapture(probeId: string, _ranges: MemoryRange[]): Promise<SnapshotResult> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('snapshotCapture');
  }

  async crashDiagnose(probeId: string): Promise<CrashDiagnosis> {
    this.#requireProbe(probeId);
    throw new JLinkNotImplementedError('crashDiagnose');
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
