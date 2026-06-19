/**
 * FakeJLinkBackend：测试用合成 backend。
 *
 * 设计：
 * - **calls 账本**：每个方法调用都会 push 一条 `{ method, args }` 记录，便于断言
 *   "MCP base64 → Buffer 翻译正确"等耦合点；
 * - **failOnce 注入**：按方法名预置一次性错误，模拟 backend 偶发失败；
 * - **delayMs**：长操作（flashDownload/flashVerify/gdbServerStart）默认 0；测试可
 *   把它调高来验证 AbortSignal 行为；
 * - **probe lifecycle 真实**：本地 Map 记录连接状态，能跑通端到端 connect/status/
 *   disconnect 流程；
 * - **memoryRead** 返回 `Buffer.alloc(length, 0xab)`，便于二进制 codec 单测。
 *
 * 不在生产路径中使用；只供 `tests/unit/mcp/debug/*` 注入。
 */

import { randomUUID } from 'node:crypto';
import type {
  BreakpointSpec,
  CommanderScriptResult,
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
} from '@/jlink/types.js';
import {
  JLinkAbortedError,
  JLinkError,
  JLinkInvalidStateError,
  ProbeNotFoundError,
} from '@/jlink/errors.js';

interface CallRecord {
  method: string;
  args: unknown[];
}

interface ProbeHandle {
  probeId: string;
  target: string;
}

/**
 * 合成 J-Link backend，仅用于单元/集成测试。所有方法返回合成数据。
 */
export class FakeJLinkBackend implements IJLinkBackend {
  /** 调用账本；测试用 `expect(fake.calls).toContainEqual(...)`. */
  readonly calls: CallRecord[] = [];

  /** 一次性错误注入：调用对应方法前先抛此错（消费一次）。 */
  readonly failOnce = new Map<string, JLinkError>();

  /** 长操作默认延迟（毫秒）；用于 AbortSignal 测试。 */
  delayMs = 0;

  readonly #probes = new Map<string, ProbeHandle>();

  // -- helpers --

  #record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
    const f = this.failOnce.get(method);
    if (f) {
      this.failOnce.delete(method);
      throw f;
    }
  }

  /** 等待 ms；signal 已 abort 或途中 abort 时抛 JLinkAbortedError。 */
  async #abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new JLinkAbortedError();
    }
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new JLinkAbortedError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  #requireProbe(probeId: string): ProbeHandle {
    const h = this.#probes.get(probeId);
    if (!h) throw new ProbeNotFoundError(probeId);
    return h;
  }

  /** 测试断言辅助：返回最近一次调用的方法名。 */
  lastCallMethod(): string | undefined {
    return this.calls[this.calls.length - 1]?.method;
  }

  /** 测试断言辅助：取出某方法的所有调用。 */
  callsOf(method: string): CallRecord[] {
    return this.calls.filter((c) => c.method === method);
  }

  // -- probe lifecycle --

  async probeDetect(): Promise<ProbeInfo[]> {
    this.#record('probeDetect');
    return Array.from(this.#probes.values()).map((h) => ({
      probeId: h.probeId,
      target: h.target,
      connected: true,
    }));
  }

  async probeConnect(opts: ProbeConnectOptions): Promise<ProbeInfo> {
    this.#record('probeConnect', opts);
    if (!opts.target || opts.target.trim() === '') {
      throw new JLinkInvalidStateError('probeConnect requires a non-empty target');
    }
    const probeId = randomUUID();
    this.#probes.set(probeId, { probeId, target: opts.target });
    // 透传 serialNumber 以便 MCP 层的隐私清洗能在测试中被验证。
    const info: ProbeInfo = { probeId, target: opts.target, connected: true };
    if (opts.serialNumber !== undefined) info.serialNumber = opts.serialNumber;
    return info;
  }

  async probeDisconnect(probeId: string): Promise<void> {
    this.#record('probeDisconnect', probeId);
    if (!this.#probes.has(probeId)) throw new ProbeNotFoundError(probeId);
    this.#probes.delete(probeId);
  }

  async probeStatus(probeId: string): Promise<ProbeInfo> {
    this.#record('probeStatus', probeId);
    const h = this.#requireProbe(probeId);
    return { probeId: h.probeId, target: h.target, connected: true };
  }

  // -- cpu control --

  async cpuReset(probeId: string, opts?: { halt?: boolean }): Promise<void> {
    this.#record('cpuReset', probeId, opts);
    this.#requireProbe(probeId);
  }

  async cpuHalt(probeId: string): Promise<void> {
    this.#record('cpuHalt', probeId);
    this.#requireProbe(probeId);
  }

  async cpuRun(probeId: string): Promise<void> {
    this.#record('cpuRun', probeId);
    this.#requireProbe(probeId);
  }

  async cpuStep(probeId: string): Promise<void> {
    this.#record('cpuStep', probeId);
    this.#requireProbe(probeId);
  }

  // -- breakpoints --

  async breakpointSet(
    probeId: string,
    address: number,
    opts?: { kind?: 'sw' | 'hw' },
  ): Promise<BreakpointSpec> {
    this.#record('breakpointSet', probeId, address, opts);
    this.#requireProbe(probeId);
    return { id: 1, address, kind: opts?.kind ?? 'sw', enabled: true };
  }

  async breakpointClear(probeId: string, id: number): Promise<void> {
    this.#record('breakpointClear', probeId, id);
    this.#requireProbe(probeId);
  }

  async breakpointList(probeId: string): Promise<BreakpointSpec[]> {
    this.#record('breakpointList', probeId);
    this.#requireProbe(probeId);
    return [];
  }

  // -- registers --

  async registerRead(probeId: string, name: string): Promise<RegisterValue> {
    this.#record('registerRead', probeId, name);
    this.#requireProbe(probeId);
    return { name, value: 0xdeadbeef };
  }

  async registerWrite(probeId: string, name: string, value: number): Promise<void> {
    this.#record('registerWrite', probeId, name, value);
    this.#requireProbe(probeId);
  }

  async registerList(probeId: string): Promise<RegisterValue[]> {
    this.#record('registerList', probeId);
    this.#requireProbe(probeId);
    return [
      { name: 'r0', value: 0 },
      { name: 'pc', value: 0x08000000 },
    ];
  }

  // -- memory --

  async memoryRead(probeId: string, range: MemoryRange): Promise<Buffer> {
    this.#record('memoryRead', probeId, range);
    this.#requireProbe(probeId);
    return Buffer.alloc(range.length, 0xab);
  }

  async memoryWrite(probeId: string, address: number, data: Buffer): Promise<void> {
    this.#record('memoryWrite', probeId, address, data);
    this.#requireProbe(probeId);
  }

  // -- flash --

  async flashDownload(
    probeId: string,
    binary: Buffer,
    opts?: FlashDownloadOptions,
    signal?: AbortSignal,
  ): Promise<{ bytesWritten: number; verified: boolean }> {
    this.#record('flashDownload', probeId, binary.byteLength, opts);
    this.#requireProbe(probeId);
    await this.#abortableDelay(this.delayMs, signal);
    return { bytesWritten: binary.byteLength, verified: opts?.verify === true };
  }

  async flashErase(
    probeId: string,
    opts?: { address?: number; length?: number },
  ): Promise<void> {
    this.#record('flashErase', probeId, opts);
    this.#requireProbe(probeId);
  }

  async flashWrite(probeId: string, address: number, data: Buffer): Promise<void> {
    this.#record('flashWrite', probeId, address, data);
    this.#requireProbe(probeId);
  }

  async flashVerify(
    probeId: string,
    binary: Buffer,
    opts?: { address?: number },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; mismatchAt?: number }> {
    this.#record('flashVerify', probeId, binary.byteLength, opts);
    this.#requireProbe(probeId);
    await this.#abortableDelay(this.delayMs, signal);
    return { ok: true };
  }

  // -- RTT --

  async rttConnect(
    probeId: string,
    opts?: { controlBlockAddress?: number },
  ): Promise<{ channels: RttChannelInfo[] }> {
    this.#record('rttConnect', probeId, opts);
    this.#requireProbe(probeId);
    return {
      channels: [
        { index: 0, name: 'Terminal', direction: 'up', bufferSize: 1024 },
      ],
    };
  }

  async rttRead(
    probeId: string,
    channelIndex: number,
    maxBytes: number,
  ): Promise<RttReadResult> {
    this.#record('rttRead', probeId, channelIndex, maxBytes);
    this.#requireProbe(probeId);
    const data = Buffer.from('hello-rtt');
    return {
      data: data.byteLength > maxBytes ? data.subarray(0, maxBytes) : data,
      channelIndex,
      truncated: data.byteLength > maxBytes,
    };
  }

  async rttClear(probeId: string, channelIndex: number): Promise<void> {
    this.#record('rttClear', probeId, channelIndex);
    this.#requireProbe(probeId);
  }

  async rttSearch(
    probeId: string,
    channelIndex: number,
    pattern: string,
    maxBytes: number,
  ): Promise<{ matchAt: number | null; preview: Buffer }> {
    this.#record('rttSearch', probeId, channelIndex, pattern, maxBytes);
    this.#requireProbe(probeId);
    return { matchAt: null, preview: Buffer.alloc(0) };
  }

  // -- GDB --

  async gdbServerStart(
    probeId: string,
    opts?: { port?: number; host?: string },
    signal?: AbortSignal,
  ): Promise<GdbServerHandle> {
    this.#record('gdbServerStart', probeId, opts);
    this.#requireProbe(probeId);
    await this.#abortableDelay(this.delayMs, signal);
    return { port: opts?.port ?? 2331, host: opts?.host ?? '127.0.0.1' };
  }

  async gdbServerStop(probeId: string): Promise<void> {
    this.#record('gdbServerStop', probeId);
    this.#requireProbe(probeId);
  }

  // -- diagnostics --

  async runCommanderScript(
    probeId: string,
    commands: string[],
    opts?: { timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<CommanderScriptResult> {
    this.#record('runCommanderScript', probeId, commands, opts, signal);
    this.#requireProbe(probeId);
    await this.#abortableDelay(this.delayMs, signal);
    return {
      exitCode: 0,
      signal: null,
      stdout: 'synthetic Commander output',
      stderr: '',
    };
  }

  async snapshotCapture(probeId: string, ranges: MemoryRange[]): Promise<SnapshotResult> {
    this.#record('snapshotCapture', probeId, ranges);
    this.#requireProbe(probeId);
    return {
      pc: 0x08000000,
      sp: 0x20001000,
      registers: [{ name: 'r0', value: 0 }],
      memorySnippets: ranges.map((r) => ({
        address: r.address,
        data: Buffer.alloc(r.length, 0x55),
      })),
      capturedAt: Date.now(),
    };
  }

  async crashDiagnose(probeId: string): Promise<CrashDiagnosis> {
    this.#record('crashDiagnose', probeId);
    this.#requireProbe(probeId);
    return {
      fault: 'unknown',
      pc: 0,
      lr: 0,
      sp: 0,
      reason: 'no fault detected (synthetic backend)',
      stackTrace: [],
    };
  }
}
