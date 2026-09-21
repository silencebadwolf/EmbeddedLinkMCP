/**
 * NullJLinkBackend：当 main 进程未注入真实 backend 时的默认占位实现。
 *
 * **不要 Proxy** —— 显式列出每个方法是有意为之：当 `IJLinkBackend` 接口扩展新方法
 * 时，TypeScript 会立即在此文件报缺失成员错误，不会让接口与 null-backend 之间静默
 * 漂移。
 *
 * 所有方法形态一致：`async () => { throw new NoBackendError(); }`，让 MCP 层得到稳定的
 * `{ success: false, error: { code: 'NO_BACKEND' } }` 结构化拒绝（req §4.6）。
 */

import type {
  BreakpointSpec,
  CommanderScriptResult,
  CrashDiagnosis,
  FlashDownloadOptions,
  GdbServerHandle,
  IJLinkBackend,
  JLinkRebootOptions,
  MemoryRange,
  ProbeConnectOptions,
  ProbeInfo,
  RegisterValue,
  RttChannelInfo,
  RttReadResult,
  SnapshotResult,
} from './types.js';
import { NoBackendError } from './errors.js';

/**
 * 一律拒绝的 J-Link backend。每个方法均抛 {@link NoBackendError}。
 *
 * Phase 9 默认注册到 MCP server，确保 debug 工具对 AI 客户端始终可见，
 * 但不会真的执行任何硬件操作（req §4.6）。
 */
export class NullJLinkBackend implements IJLinkBackend {
  // -- probe lifecycle --

  async probeDetect(): Promise<ProbeInfo[]> {
    throw new NoBackendError();
  }

  async probeConnect(_opts: ProbeConnectOptions): Promise<ProbeInfo> {
    throw new NoBackendError();
  }

  async probeDisconnect(_probeId: string): Promise<void> {
    throw new NoBackendError();
  }

  async probeStatus(_probeId: string): Promise<ProbeInfo> {
    throw new NoBackendError();
  }

  async jlinkReboot(
    _opts?: JLinkRebootOptions,
    _signal?: AbortSignal,
  ): Promise<CommanderScriptResult> {
    throw new NoBackendError();
  }

  // -- cpu control --

  async cpuReset(_probeId: string, _opts?: { halt?: boolean }): Promise<void> {
    throw new NoBackendError();
  }

  async cpuHalt(_probeId: string): Promise<void> {
    throw new NoBackendError();
  }

  async cpuRun(_probeId: string): Promise<void> {
    throw new NoBackendError();
  }

  async cpuStep(_probeId: string): Promise<void> {
    throw new NoBackendError();
  }

  // -- breakpoints --

  async breakpointSet(
    _probeId: string,
    _address: number,
    _opts?: { kind?: 'sw' | 'hw' },
  ): Promise<BreakpointSpec> {
    throw new NoBackendError();
  }

  async breakpointClear(_probeId: string, _id: number): Promise<void> {
    throw new NoBackendError();
  }

  async breakpointList(_probeId: string): Promise<BreakpointSpec[]> {
    throw new NoBackendError();
  }

  // -- registers --

  async registerRead(_probeId: string, _name: string): Promise<RegisterValue> {
    throw new NoBackendError();
  }

  async registerWrite(_probeId: string, _name: string, _value: number): Promise<void> {
    throw new NoBackendError();
  }

  async registerList(_probeId: string): Promise<RegisterValue[]> {
    throw new NoBackendError();
  }

  // -- memory --

  async memoryRead(_probeId: string, _range: MemoryRange): Promise<Buffer> {
    throw new NoBackendError();
  }

  async memoryWrite(_probeId: string, _address: number, _data: Buffer): Promise<void> {
    throw new NoBackendError();
  }

  // -- flash --

  async flashDownload(
    _probeId: string,
    _binary: Buffer,
    _opts?: FlashDownloadOptions,
    _signal?: AbortSignal,
  ): Promise<{ bytesWritten: number; verified: boolean }> {
    throw new NoBackendError();
  }

  async flashErase(
    _probeId: string,
    _opts?: { address?: number; length?: number },
  ): Promise<void> {
    throw new NoBackendError();
  }

  async flashWrite(_probeId: string, _address: number, _data: Buffer): Promise<void> {
    throw new NoBackendError();
  }

  async flashVerify(
    _probeId: string,
    _binary: Buffer,
    _opts?: { address?: number },
    _signal?: AbortSignal,
  ): Promise<{ ok: boolean; mismatchAt?: number }> {
    throw new NoBackendError();
  }

  // -- RTT --

  async rttConnect(
    _probeId: string,
    _opts?: { controlBlockAddress?: number },
  ): Promise<{ channels: RttChannelInfo[] }> {
    throw new NoBackendError();
  }

  async rttRead(_probeId: string, _channelIndex: number, _maxBytes: number): Promise<RttReadResult> {
    throw new NoBackendError();
  }

  async rttWrite(_probeId: string, _channelIndex: number, _data: Buffer): Promise<void> {
    throw new NoBackendError();
  }

  async rttClear(_probeId: string, _channelIndex: number): Promise<void> {
    throw new NoBackendError();
  }

  async rttSearch(
    _probeId: string,
    _channelIndex: number,
    _pattern: string,
    _maxBytes: number,
  ): Promise<{ matchAt: number | null; preview: Buffer }> {
    throw new NoBackendError();
  }

  // -- GDB --

  async gdbServerStart(
    _probeId: string,
    _opts?: { port?: number; host?: string },
    _signal?: AbortSignal,
  ): Promise<GdbServerHandle> {
    throw new NoBackendError();
  }

  async gdbServerStop(_probeId: string): Promise<void> {
    throw new NoBackendError();
  }

  // -- diagnostics --

  async runCommanderScript(
    _probeId: string,
    _commands: string[],
    _opts?: { timeoutMs?: number },
    _signal?: AbortSignal,
  ): Promise<CommanderScriptResult> {
    throw new NoBackendError();
  }

  async snapshotCapture(_probeId: string, _ranges: MemoryRange[]): Promise<SnapshotResult> {
    throw new NoBackendError();
  }

  async crashDiagnose(_probeId: string): Promise<CrashDiagnosis> {
    throw new NoBackendError();
  }
}
