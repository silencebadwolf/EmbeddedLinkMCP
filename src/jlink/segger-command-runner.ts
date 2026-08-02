import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { normalizeJLinkTargetName } from '../shared/jlink-target-name.js';
import { JLinkAbortedError, JLinkInvalidStateError, JLinkOperationError } from './errors.js';
import type {
  CommanderScriptResult,
  FlashProgressUpdate,
  JLinkRebootOptions,
  MemoryRange,
  ProbeInfo,
  RegisterValue,
  RttChannelInfo,
  RttReadResult,
} from './types.js';
import type { ProbeSelector, VcomChangeResult, VcomInspection } from './vcom-types.js';
import { parseSeggerVcomChange, parseSeggerVcomInspection } from './segger-vcom-control.js';

/** Probe context required by SEGGER Commander commands. */
export interface CommanderProbeContext {
  /** SEGGER device name, for example AT32F435RGT7 or STM32F407VG. */
  target: string;
  /** Debug interface; defaults to SWD when omitted. */
  interface?: 'swd' | 'jtag';
  /** SWD/JTAG speed in kHz; defaults to SEGGER auto speed when omitted. */
  speedKHz?: number;
  /** Optional physical J-Link serial number; never exposed at MCP boundary. */
  serialNumber?: string;
}

/** Output chunk emitted by a SEGGER child process before the process exits. */
export interface SeggerProcessOutputEvent {
  stream: 'stdout' | 'stderr';
  chunk: string;
}

/** Request passed to the low-level process runner. */
export interface SeggerProcessRequest {
  /** Absolute executable path. Must not rely on PATH/current-directory lookup. */
  command: string;
  /** Argument vector. Must be passed without shell interpolation. */
  args: string[];
  /** Optional cancellation signal. */
  signal?: AbortSignal;
  /** Optional process timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum stdout/stderr bytes retained in memory. */
  maxOutputBytes?: number;
  /** Optional streaming output observer used for long-running status updates. */
  onOutput?: (event: SeggerProcessOutputEvent) => void;
}

/** Low-level process completion result. */
export interface SeggerProcessResult {
  /** Process exit code; null when terminated by signal. */
  exitCode: number | null;
  /** Terminating signal, if any. */
  signal: NodeJS.Signals | null;
  /** Captured stdout, possibly truncated. */
  stdout: string;
  /** Captured stderr, possibly truncated. */
  stderr: string;
  /** True when stdout or stderr exceeded maxOutputBytes. */
  truncated?: boolean;
}

/** Process runner abstraction used to avoid spawning SEGGER tools in unit tests. */
export interface SeggerProcessRunner {
  /** Run one SEGGER process and return captured output. */
  run(request: SeggerProcessRequest): Promise<SeggerProcessResult>;
}

/** Commander availability check result for workflow preflight. */
export interface JLinkCommanderAvailability {
  /** true when LinkTerm has a trusted absolute Commander executable path and optional target support check passed. */
  available: boolean;
  /** Trusted executable path; only present when available. */
  commanderPath?: string;
  /** Stable reason for unavailable Commander. */
  reason?: 'not-found' | 'target-unsupported';
  /** Target checked against local SEGGER device databases. */
  target?: string;
  /** True when the optional target support check found the target in local SEGGER device databases. */
  targetSupported?: boolean;
  /** Human-readable remediation hint. */
  message?: string;
}

/** Commander-level operations used by JLinkAdapter. */
export interface JLinkCommanderClient {
  /** Check whether the Commander executable and optional target support can be resolved without spawning a process. */
  checkAvailability?(target?: string): JLinkCommanderAvailability;

  /** Enumerate physically attached J-Link probes without opening a target connection. */
  detectProbes?(): Promise<ProbeInfo[]>;

  /** Obtain fresh, positive evidence that Commander can access the configured target. */
  connectTarget?(probe: CommanderProbeContext, signal?: AbortSignal): Promise<void>;

  /** Reboot the J-Link probe itself without opening a target connection. */
  rebootProbe?(opts?: JLinkRebootOptions, signal?: AbortSignal): Promise<CommanderScriptResult>;

  /** Query the probe-level VCOM feature without opening a target connection. */
  inspectVcom?(selector?: ProbeSelector, signal?: AbortSignal): Promise<VcomInspection>;

  /** Explicitly request probe-level VCOM enable/disable. */
  setVcomEnabled?(
    selector: ProbeSelector | undefined,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<VcomChangeResult>;

  /** Program a raw binary at an explicit address. */
  download(
    probe: CommanderProbeContext,
    binary: Buffer,
    opts: {
      address: number;
      verify?: boolean;
      timeoutMs?: number;
      onProgress?: (update: FlashProgressUpdate) => void;
    },
    signal?: AbortSignal,
  ): Promise<{ bytesWritten: number; verified: boolean }>;

  /** Verify a raw binary at an explicit address. */
  verify(
    probe: CommanderProbeContext,
    binary: Buffer,
    opts: {
      address: number;
      timeoutMs?: number;
      onProgress?: (update: FlashProgressUpdate) => void;
    },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; mismatchAt?: number }>;

  /** Erase full flash or a bounded address range. */
  eraseFlash(
    probe: CommanderProbeContext,
    opts?: { address?: number; length?: number },
    signal?: AbortSignal,
  ): Promise<void>;

  /** Program flash bytes at an explicit address without an extra verify pass. */
  writeFlash(
    probe: CommanderProbeContext,
    address: number,
    data: Buffer,
    signal?: AbortSignal,
  ): Promise<void>;

  /** Reset the target CPU; halt=true requests a halt immediately after reset. */
  reset(
    probe: CommanderProbeContext,
    opts?: { halt?: boolean },
    signal?: AbortSignal,
  ): Promise<void>;

  /** Halt the current target CPU execution. */
  halt(probe: CommanderProbeContext, signal?: AbortSignal): Promise<void>;

  /** Resume target CPU execution. */
  run(probe: CommanderProbeContext, signal?: AbortSignal): Promise<void>;

  /** Halt if needed, then single-step one target instruction. */
  step(probe: CommanderProbeContext, signal?: AbortSignal): Promise<void>;

  /** Read one CPU register and return a structured numeric value. */
  readRegister(
    probe: CommanderProbeContext,
    name: string,
    signal?: AbortSignal,
  ): Promise<RegisterValue>;

  /** Write one CPU register. */
  writeRegister(
    probe: CommanderProbeContext,
    name: string,
    value: number,
    signal?: AbortSignal,
  ): Promise<void>;

  /** List architecture-visible CPU registers as structured numeric values. */
  listRegisters(probe: CommanderProbeContext, signal?: AbortSignal): Promise<RegisterValue[]>;

  /** Read a contiguous target memory range as bytes. */
  readMemory(
    probe: CommanderProbeContext,
    range: MemoryRange,
    signal?: AbortSignal,
  ): Promise<Buffer>;

  /** Write bytes into target memory. */
  writeMemory(
    probe: CommanderProbeContext,
    address: number,
    data: Buffer,
    signal?: AbortSignal,
  ): Promise<void>;

  /** Set a target breakpoint at an address. */
  setBreakpoint(
    probe: CommanderProbeContext,
    address: number,
    kind?: 'sw' | 'hw',
    signal?: AbortSignal,
  ): Promise<void>;

  /** Clear a target breakpoint by address. */
  clearBreakpoint(
    probe: CommanderProbeContext,
    address: number,
    signal?: AbortSignal,
  ): Promise<void>;

  /** Run a LinkTerm-controlled Commander diagnostic script and return sanitized process output. */
  runScript(
    probe: CommanderProbeContext,
    commands: string[],
    opts?: { timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<CommanderScriptResult>;
}

/** Options for DefaultJLinkCommanderClient. */
export interface DefaultJLinkCommanderClientOptions {
  /** Explicit J-Link Commander executable path. Must be absolute and exist. */
  commanderPath?: string;
  /** Low-level process runner; tests inject a fake. */
  runner?: SeggerProcessRunner;
  /** Root directory for temporary command/binary files. */
  tempRoot?: string;
  /** Default timeout for a SEGGER command process. */
  defaultTimeoutMs?: number;
  /** Maximum stdout/stderr bytes retained for classification. */
  maxOutputBytes?: number;
}

/** GDB server availability check result for workflow preflight. */
export interface JLinkGdbServerAvailability {
  /** true when LinkTerm has a trusted absolute GDB server executable path and optional target support check passed. */
  available: boolean;
  /** Trusted executable path; only present when available. */
  gdbServerPath?: string;
  /** Stable reason for unavailable GDB server. */
  reason?: 'not-found' | 'target-unsupported';
  /** Target checked against local SEGGER device databases. */
  target?: string;
  /** True when the optional target support check found the target in local SEGGER device databases. */
  targetSupported?: boolean;
  /** Human-readable remediation hint. */
  message?: string;
}

/** Long-running SEGGER process request. */
export interface SeggerManagedProcessRequest extends SeggerProcessRequest {
  /** Regex that marks the long-running process as ready. */
  readyPattern: RegExp;
  /** Human-readable process name for diagnostics. */
  processName: string;
}

/** Handle returned after a long-running SEGGER process becomes ready. */
export interface SeggerGdbServerProcessHandle {
  /** Captured output tail, sanitized at the caller boundary before evidence crosses MCP. */
  readonly outputTail: string;
  /** Stop the managed process and release OS resources. */
  stop(): Promise<void>;
}

/** Long-running process runner abstraction used by the GDB server client. */
export interface SeggerManagedProcessRunner {
  /** Start a process and resolve only after readyPattern is observed. */
  start(request: SeggerManagedProcessRequest): Promise<SeggerGdbServerProcessHandle>;
}

/** Session returned by the GDB server client to JLinkAdapter. */
export interface JLinkGdbServerSession {
  host: string;
  port: number;
  rttTelnetPort?: number;
  outputTail: string;
  stop(): Promise<void>;
}

/** RTT socket connection target. */
export interface JLinkRttConnectOptions {
  host: string;
  port: number;
  controlBlockAddress?: number;
}

/** Backend-owned RTT session abstraction. */
export interface JLinkRttSession {
  readonly channels: RttChannelInfo[];
  read(channelIndex: number, maxBytes: number): Promise<RttReadResult>;
  write(channelIndex: number, data: Buffer): Promise<void>;
  search(
    channelIndex: number,
    pattern: string,
    maxBytes: number,
  ): Promise<{ matchAt: number | null; preview: Buffer }>;
  clear(channelIndex: number): Promise<void>;
  close(): Promise<void>;
}

/** RTT client abstraction used by JLinkAdapter. */
export interface JLinkRttClient {
  connect(opts: JLinkRttConnectOptions): Promise<JLinkRttSession>;
}

/** GDB-server-level operations used by JLinkAdapter. */
export interface JLinkGdbServerClient {
  /** Check whether the GDB server executable and optional target support can be resolved without spawning a process. */
  checkAvailability?(target?: string): JLinkGdbServerAvailability;

  /** Start a long-running GDB server process for the probe. */
  start(
    probe: CommanderProbeContext,
    opts?: { host?: string; port?: number },
    signal?: AbortSignal,
  ): Promise<JLinkGdbServerSession>;
}

/** Options for DefaultJLinkGdbServerClient. */
export interface DefaultJLinkGdbServerClientOptions {
  /** Explicit J-Link GDB server executable path. Must be absolute and exist. */
  gdbServerPath?: string;
  /** Low-level long-running process runner; tests inject a fake. */
  runner?: SeggerManagedProcessRunner;
  /** Default timeout for readiness detection. */
  defaultTimeoutMs?: number;
  /** Maximum stdout/stderr bytes retained for classification. */
  maxOutputBytes?: number;
}

interface TempCommandFile {
  dir: string;
  scriptPath: string;
}

interface TempFlashFiles extends TempCommandFile {
  binaryPath: string;
}

interface TempVerifyFiles extends TempFlashFiles {
  readbackPath: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const LARGE_RAW_FLASH_THRESHOLD_BYTES = 512 * 1024;
const LARGE_RAW_FLASH_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const TERMINATE_GRACE_MS = 5_000;
const OUTPUT_PREVIEW_CHARS = 4000;

function formatOutputPreview(stdout: string, stderr: string): string {
  const output = sanitizeProcessOutput(`${stdout}\n${stderr}`).trim();
  if (output === '') return '';
  return `; output preview: ${tail(output, OUTPUT_PREVIEW_CHARS)}`;
}

function sanitizeProcessOutput(output: string): string {
  return output.replace(/S\/N:\s*\S+/gi, 'S/N: [redacted]');
}

function defaultRawFlashTimeoutMs(binaryLength: number): number {
  return binaryLength >= LARGE_RAW_FLASH_THRESHOLD_BYTES
    ? LARGE_RAW_FLASH_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
}

function tail(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}

function terminateProcessTree(
  child: ChildProcessByStdio<null, Readable, Readable>,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    execFile(
      'taskkill.exe',
      ['/PID', String(child.pid), '/T', signal === 'SIGKILL' ? '/F' : '/F'],
      { windowsHide: true },
      () => undefined,
    );
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process may have already exited.
    }
  }
}

/** Node child_process based runner for SEGGER command-line tools. */
export class NodeSeggerProcessRunner implements SeggerProcessRunner {
  /** Run a process with shell disabled, bounded output, timeout, and AbortSignal support. */
  async run(request: SeggerProcessRequest): Promise<SeggerProcessResult> {
    if (request.signal?.aborted) throw new JLinkAbortedError();

    return new Promise<SeggerProcessResult>((resolve, reject) => {
      let child: ChildProcessByStdio<null, Readable, Readable>;
      try {
        child = spawn(request.command, request.args, {
          shell: false,
          windowsHide: true,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(
          new JLinkOperationError('Failed to start J-Link Commander', {
            operation: 'spawnJLinkCommander',
            underlying: err,
          }),
        );
        return;
      }

      const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let terminateTimer: NodeJS.Timeout | undefined;
      let terminatingError: Error | undefined;
      let timeoutMessagePrefix: string | undefined;

      const append = (current: string, chunk: Buffer): string => {
        if (current.length >= maxOutputBytes) {
          truncated = true;
          return current;
        }
        const next = current + chunk.toString('utf-8');
        if (next.length > maxOutputBytes) {
          truncated = true;
          return next.slice(0, maxOutputBytes);
        }
        return next;
      };

      const clearPrimaryWaiters = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        request.signal?.removeEventListener('abort', onAbort);
      };

      const cleanup = (): void => {
        clearPrimaryWaiters();
        if (terminateTimer !== undefined) {
          clearTimeout(terminateTimer);
          terminateTimer = undefined;
        }
      };

      const rejectOnce = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const beginTermination = (err: Error): void => {
        if (settled || terminatingError !== undefined) return;
        terminatingError = err;
        clearPrimaryWaiters();
        terminateProcessTree(child, 'SIGTERM');
        terminateTimer = setTimeout(() => {
          terminateProcessTree(child, 'SIGKILL');
        }, TERMINATE_GRACE_MS);
      };

      const onAbort = (): void => {
        beginTermination(new JLinkAbortedError());
      };

      child.stdout.on('data', (chunk: Buffer) => {
        request.onOutput?.({ stream: 'stdout', chunk: chunk.toString('utf-8') });
        stdout = append(stdout, chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        request.onOutput?.({ stream: 'stderr', chunk: chunk.toString('utf-8') });
        stderr = append(stderr, chunk);
      });
      child.on('error', (err) => {
        rejectOnce(
          new JLinkOperationError('J-Link Commander process error', {
            operation: 'runJLinkCommander',
            underlying: err,
          }),
        );
      });
      child.on('close', (exitCode, signal) => {
        if (settled) return;
        if (terminatingError !== undefined) {
          if (timeoutMessagePrefix !== undefined && terminatingError instanceof JLinkAbortedError) {
            rejectOnce(
              new JLinkAbortedError(
                `${timeoutMessagePrefix}${formatOutputPreview(stdout, stderr)}`,
              ),
            );
            return;
          }
          rejectOnce(terminatingError);
          return;
        }
        settled = true;
        cleanup();
        resolve({ exitCode, signal, stdout, stderr, truncated });
      });

      request.signal?.addEventListener('abort', onAbort, { once: true });
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      timer = setTimeout(() => {
        timeoutMessagePrefix = `J-Link Commander timed out after ${timeoutMs}ms`;
        beginTermination(new JLinkAbortedError(timeoutMessagePrefix));
      }, timeoutMs);
      if (request.signal?.aborted) {
        onAbort();
      }
    });
  }
}

/** Node child_process based runner for SEGGER long-running tools. */
export class NodeSeggerManagedProcessRunner implements SeggerManagedProcessRunner {
  /** Start a process with shell disabled, bounded output, timeout, AbortSignal support, and readiness detection. */
  async start(request: SeggerManagedProcessRequest): Promise<SeggerGdbServerProcessHandle> {
    if (request.signal?.aborted) throw new JLinkAbortedError();

    return new Promise<SeggerGdbServerProcessHandle>((resolve, reject) => {
      let child: ChildProcessByStdio<null, Readable, Readable>;
      try {
        child = spawn(request.command, request.args, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(
          new JLinkOperationError(`Failed to start ${request.processName}`, {
            operation: 'spawnSeggerManagedProcess',
            underlying: err,
          }),
        );
        return;
      }

      const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      let output = '';
      let truncated = false;
      let ready = false;
      let settled = false;
      let stopRequested = false;
      let timer: NodeJS.Timeout | undefined;
      let terminateTimer: NodeJS.Timeout | undefined;
      let closeResolve: (() => void) | undefined;
      let terminatingError: Error | undefined;

      const append = (chunk: Buffer): void => {
        if (output.length >= maxOutputBytes) {
          truncated = true;
          return;
        }
        const next = output + chunk.toString('utf-8');
        if (next.length > maxOutputBytes) {
          truncated = true;
          output = next.slice(0, maxOutputBytes);
          return;
        }
        output = next;
      };

      const cleanupReadyWaiters = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        request.signal?.removeEventListener('abort', onAbort);
      };

      const rejectOnce = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanupReadyWaiters();
        reject(err);
      };

      const terminate = (err?: Error): void => {
        if (err !== undefined && terminatingError === undefined) terminatingError = err;
        child.kill('SIGTERM');
        terminateTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, TERMINATE_GRACE_MS);
      };

      const stop = async (): Promise<void> => {
        if (stopRequested) return;
        stopRequested = true;
        cleanupReadyWaiters();
        if (terminateTimer !== undefined) {
          clearTimeout(terminateTimer);
          terminateTimer = undefined;
        }
        if (child.exitCode !== null || child.signalCode !== null) return;
        await new Promise<void>((resolveStop) => {
          closeResolve = resolveStop;
          terminate();
        });
      };

      const resolveReady = (): void => {
        if (ready || settled) return;
        ready = true;
        settled = true;
        cleanupReadyWaiters();
        resolve({
          get outputTail(): string {
            const suffix = truncated ? '\n[output truncated]' : '';
            return `${tail(sanitizeProcessOutput(output), OUTPUT_PREVIEW_CHARS)}${suffix}`;
          },
          stop,
        });
      };

      const onData = (chunk: Buffer): void => {
        append(chunk);
        if (request.readyPattern.test(output)) {
          resolveReady();
        }
      };

      const onAbort = (): void => {
        cleanupReadyWaiters();
        terminate(new JLinkAbortedError());
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (err) => {
        rejectOnce(
          new JLinkOperationError(`${request.processName} process error`, {
            operation: 'runSeggerManagedProcess',
            underlying: err,
          }),
        );
      });
      child.on('close', (exitCode, signal) => {
        if (terminateTimer !== undefined) {
          clearTimeout(terminateTimer);
          terminateTimer = undefined;
        }
        cleanupReadyWaiters();
        if (closeResolve !== undefined) {
          closeResolve();
          closeResolve = undefined;
        }
        if (ready || stopRequested) return;
        if (terminatingError !== undefined) {
          rejectOnce(terminatingError);
          return;
        }
        const preview = formatOutputPreview(output, '');
        const closeReason = signal === null ? `exit code ${exitCode}` : `signal ${signal}`;
        rejectOnce(
          new JLinkOperationError(
            `${request.processName} exited before becoming ready (${closeReason})${preview}`,
            {
              operation: 'runSeggerManagedProcess',
            },
          ),
        );
      });

      request.signal?.addEventListener('abort', onAbort, { once: true });
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      timer = setTimeout(() => {
        terminate();
        rejectOnce(
          new JLinkAbortedError(
            `${request.processName} timed out after ${timeoutMs}ms${formatOutputPreview(output, '')}`,
          ),
        );
      }, timeoutMs);
      if (request.signal?.aborted) onAbort();
    });
  }
}

/** Node net.Socket backed RTT telnet client. */
export class NetJLinkRttClient implements JLinkRttClient {
  async connect(opts: JLinkRttConnectOptions): Promise<JLinkRttSession> {
    if (opts.controlBlockAddress !== undefined) {
      assertUint32(opts.controlBlockAddress, 'rttConnect controlBlockAddress');
    }
    return new Promise<JLinkRttSession>((resolve, reject) => {
      const socket = createConnection({ host: opts.host, port: opts.port });
      let settled = false;
      const fail = (err: unknown): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(
          new JLinkOperationError('Failed to connect to J-Link RTT telnet endpoint', {
            operation: 'rttConnect',
            underlying: err,
          }),
        );
      };
      socket.once('connect', () => {
        if (opts.controlBlockAddress !== undefined) {
          socket.write(buildRttTelnetConfigString(opts.controlBlockAddress));
        }
        settled = true;
        resolve(new SocketJLinkRttSession(socket));
      });
      socket.once('error', fail);
    });
  }
}

class SocketJLinkRttSession implements JLinkRttSession {
  readonly channels: RttChannelInfo[] = [
    { index: 0, name: 'Terminal', direction: 'up', bufferSize: 0 },
    { index: 0, name: 'Terminal', direction: 'down', bufferSize: 0 },
  ];
  readonly #socket: Socket;
  #buffer = Buffer.alloc(0);

  constructor(socket: Socket) {
    this.#socket = socket;
    this.#socket.on('data', (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      if (this.#buffer.byteLength > DEFAULT_MAX_OUTPUT_BYTES) {
        this.#buffer = this.#buffer.subarray(this.#buffer.byteLength - DEFAULT_MAX_OUTPUT_BYTES);
      }
    });
  }

  async read(channelIndex: number, maxBytes: number): Promise<RttReadResult> {
    assertRttChannel(channelIndex, 'up');
    assertRttMaxBytes(maxBytes);
    const data = this.#buffer.subarray(0, maxBytes);
    this.#buffer = this.#buffer.subarray(data.byteLength);
    return { channelIndex, data, truncated: this.#buffer.byteLength > 0 };
  }

  async write(channelIndex: number, data: Buffer): Promise<void> {
    assertRttChannel(channelIndex, 'down');
    await new Promise<void>((resolve, reject) => {
      this.#socket.write(data, (err) => {
        if (err)
          reject(
            new JLinkOperationError('Failed to write to J-Link RTT telnet endpoint', {
              operation: 'rttWrite',
              underlying: err,
            }),
          );
        else resolve();
      });
    });
  }

  async search(
    channelIndex: number,
    pattern: string,
    maxBytes: number,
  ): Promise<{ matchAt: number | null; preview: Buffer }> {
    assertRttChannel(channelIndex, 'up');
    assertRttMaxBytes(maxBytes);
    const preview = this.#buffer.subarray(0, maxBytes);
    const match = preview.indexOf(pattern);
    return { matchAt: match >= 0 ? match : null, preview };
  }

  async clear(channelIndex: number): Promise<void> {
    assertRttChannel(channelIndex, 'up');
    this.#buffer = Buffer.alloc(0);
  }

  async close(): Promise<void> {
    this.#socket.destroy();
    this.#buffer = Buffer.alloc(0);
  }
}

function buildRttTelnetConfigString(controlBlockAddress: number): string {
  return `$$SEGGER_TELNET_ConfigStr=SetRTTAddr;${formatAddress(controlBlockAddress)}$$`;
}

/** SEGGER Commander backed client for raw binary flash download and verify. */
export class DefaultJLinkCommanderClient implements JLinkCommanderClient {
  readonly #commanderPath: string | undefined;
  readonly #runner: SeggerProcessRunner;
  readonly #tempRoot: string;
  readonly #defaultTimeoutMs: number;
  readonly #maxOutputBytes: number;

  /** Create a SEGGER Commander client. */
  constructor(options: DefaultJLinkCommanderClientOptions = {}) {
    this.#commanderPath = resolveCommanderPath(options.commanderPath);
    this.#runner = options.runner ?? new NodeSeggerProcessRunner();
    this.#tempRoot = options.tempRoot ?? tmpdir();
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  /** Check whether a trusted Commander executable path and exact SEGGER target are configured. */
  checkAvailability(target?: string): JLinkCommanderAvailability {
    if (this.#commanderPath !== undefined) {
      if (target !== undefined && target.trim() !== '') {
        const targetSupported = commanderSupportsTarget(this.#commanderPath, target);
        if (targetSupported === true) {
          return {
            available: true,
            commanderPath: this.#commanderPath,
            target,
            targetSupported: true,
          };
        }
        return {
          available: true,
          commanderPath: this.#commanderPath,
          target,
          targetSupported: false,
          message: `SEGGER J-Link target ${target} is not listed in the local XML device databases; Commander may still support built-in targets, but update SEGGER J-Link/device packs or use an exact supported device name if Commander reports an unknown device.`,
        };
      }
      return { available: true, commanderPath: this.#commanderPath };
    }
    return {
      available: false,
      reason: 'not-found',
      message:
        'J-Link Commander executable not found; install SEGGER J-Link or set LINKTERM_JLINK_COMMANDER to an existing absolute path',
    };
  }

  /** Enumerate attached J-Link probes through Commander ShowEmuList without connecting to a target. */
  async detectProbes(): Promise<ProbeInfo[]> {
    const commanderPath = this.#requireCommanderPath();
    return this.#withTempCommandFile(async (file) => {
      await writeFile(file.scriptPath, 'ShowEmuList\nq\n', 'utf-8');
      const result = await this.#runner.run({
        command: commanderPath,
        args: buildCommanderProbeDetectArgs(file.scriptPath),
        timeoutMs: this.#defaultTimeoutMs,
        maxOutputBytes: this.#maxOutputBytes,
      });
      assertProbeDetectSuccess(result);
      return parseShowEmuListOutput(`${result.stdout}\n${result.stderr}`);
    });
  }

  /** Connect to the configured target and fail closed unless Commander reports positive access evidence. */
  async connectTarget(probe: CommanderProbeContext, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(commanderPath, probe, file, [], signal);
      assertCommanderSuccess(result, probe, 'probeConnect');
      assertPositiveTargetAccessEvidence(result, probe);
    });
  }

  /** Reboot the J-Link probe itself without requiring a target connection. */
  async rebootProbe(
    opts: JLinkRebootOptions = {},
    signal?: AbortSignal,
  ): Promise<CommanderScriptResult> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    const normalized = normalizeJLinkRebootOptions(opts);
    return this.#withTempCommandFile(async (file) => {
      await writeFile(file.scriptPath, `${buildProbeRebootCommand(normalized)}\nq\n`, 'utf-8');
      const result = await this.#runner.run({
        command: commanderPath,
        args: buildCommanderProbeMaintenanceArgs(file.scriptPath, normalized.serialNumber),
        signal,
        timeoutMs: probeRebootProcessTimeoutMs(normalized, this.#defaultTimeoutMs),
        maxOutputBytes: this.#maxOutputBytes,
      });
      assertProbeRebootSuccess(result, normalized.serialNumber);
      return sanitizeProbeRebootResult(result, normalized.serialNumber);
    });
  }

  /** Query VCOM support/state through the dedicated probe-maintenance command path. */
  async inspectVcom(selector: ProbeSelector = {}, signal?: AbortSignal): Promise<VcomInspection> {
    const result = await this.#runVcomCommand(selector, 'vcom', signal);
    return parseSeggerVcomInspection(result);
  }

  /** Enable or disable VCOM; the caller owns the required USB re-enumeration flow. */
  async setVcomEnabled(
    selector: ProbeSelector = {},
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<VcomChangeResult> {
    const result = await this.#runVcomCommand(
      selector,
      `vcom ${enabled ? 'enable' : 'disable'}`,
      signal,
    );
    return parseSeggerVcomChange(result, enabled);
  }

  /** Program a raw binary at an explicit flash address. */
  async download(
    probe: CommanderProbeContext,
    binary: Buffer,
    opts: {
      address: number;
      verify?: boolean;
      timeoutMs?: number;
      onProgress?: (update: FlashProgressUpdate) => void;
    },
    signal?: AbortSignal,
  ): Promise<{ bytesWritten: number; verified: boolean }> {
    if (signal?.aborted) throw new JLinkAbortedError();
    assertAddress(opts.address, 'download');
    const commanderPath = this.#requireCommanderPath();
    const timeoutMs = opts.timeoutMs ?? defaultRawFlashTimeoutMs(binary.byteLength);
    const progress = createFlashProgressReporter(opts.onProgress, binary.byteLength);
    progress.emit({
      phase: 'preparing',
      message: 'Preparing J-Link flash download',
      bytesTotal: binary.byteLength,
    });
    await this.#withTempFlashFiles(binary, async (files) => {
      const lines = [
        `loadbin ${quoteCommanderPath(files.binaryPath)}, ${formatAddress(opts.address)}`,
      ];
      if (opts.verify === true) {
        lines.push(
          `verifybin ${quoteCommanderPath(files.binaryPath)}, ${formatAddress(opts.address)}`,
        );
      }
      progress.emit({
        phase: 'erasing',
        message: 'J-Link Commander is erasing and programming flash sectors',
        bytesTotal: binary.byteLength,
      });
      const result = await this.#runCommander(
        commanderPath,
        probe,
        files,
        lines,
        signal,
        timeoutMs,
        progress.observeCommanderOutput(probe, 'download'),
      );
      if (opts.verify === true && classifyVerifyMismatch(result)) {
        throw new JLinkOperationError('J-Link flash verify failed after download', {
          operation: 'flashDownload',
        });
      }
      assertCommanderSuccess(result, probe, 'flashDownload');
      if (opts.verify === true) {
        assertPositiveVerifyEvidence(result, probe, 'flashDownload');
      }
    });
    if (opts.verify === true) {
      const verifyResult = await this.verify(
        probe,
        binary,
        { address: opts.address, timeoutMs, onProgress: opts.onProgress },
        signal,
      );
      if (!verifyResult.ok) {
        const mismatch =
          verifyResult.mismatchAt === undefined
            ? 'unknown'
            : formatAddress(verifyResult.mismatchAt);
        throw new JLinkOperationError(
          `J-Link flashDownload binary readback mismatch at ${mismatch}`,
          {
            operation: 'flashDownload',
          },
        );
      }
    }
    progress.emit({
      phase: 'completed',
      message: 'J-Link flash download completed',
      percent: 100,
      bytesWritten: binary.byteLength,
      bytesTotal: binary.byteLength,
    });
    return { bytesWritten: binary.byteLength, verified: opts.verify === true };
  }

  /** Verify a raw binary at an explicit flash address. */
  async verify(
    probe: CommanderProbeContext,
    binary: Buffer,
    opts: {
      address: number;
      timeoutMs?: number;
      onProgress?: (update: FlashProgressUpdate) => void;
    },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; mismatchAt?: number }> {
    if (signal?.aborted) throw new JLinkAbortedError();
    assertAddress(opts.address, 'verify');
    const commanderPath = this.#requireCommanderPath();
    const progress = createFlashProgressReporter(opts.onProgress, binary.byteLength);
    progress.emit({
      phase: 'verifying',
      message: 'Verifying flash contents',
      bytesTotal: binary.byteLength,
    });
    return this.#withTempVerifyFiles(binary, async (files) => {
      const result = await this.#runCommander(
        commanderPath,
        probe,
        files,
        [
          `verifybin ${quoteCommanderPath(files.binaryPath)}, ${formatAddress(opts.address)}`,
          `savebin ${quoteCommanderPath(files.readbackPath)}, ${formatAddress(opts.address)}, ${formatAddress(binary.byteLength)}`,
        ],
        signal,
        opts.timeoutMs,
        progress.observeCommanderOutput(probe, 'verify'),
      );
      const mismatch = classifyVerifyMismatch(result);
      if (mismatch !== undefined) {
        return mismatch.mismatchAt === undefined
          ? { ok: false }
          : { ok: false, mismatchAt: mismatch.mismatchAt };
      }
      assertCommanderSuccess(result, probe, 'flashVerify');
      assertPositiveVerifyEvidence(result, probe, 'flashVerify');
      const readback = await readVerifyReadback(files.readbackPath, probe);
      const readbackMismatch = firstMismatchAddress(binary, readback, opts.address);
      if (readbackMismatch !== undefined) return { ok: false, mismatchAt: readbackMismatch };
      return { ok: true };
    });
  }

  /** Erase full flash or a bounded flash address range through SEGGER Commander. */
  async eraseFlash(
    probe: CommanderProbeContext,
    opts?: { address?: number; length?: number },
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(
        commanderPath,
        probe,
        file,
        [buildEraseCommand(opts)],
        signal,
      );
      assertCommanderSuccess(result, probe, 'flashErase');
    });
  }

  /** Program flash bytes at an explicit address without an extra verify pass. */
  async writeFlash(
    probe: CommanderProbeContext,
    address: number,
    data: Buffer,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    assertAddress(address, 'flashWrite');
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempFlashFiles(data, async (files) => {
      const result = await this.#runCommander(
        commanderPath,
        probe,
        files,
        [`loadbin ${quoteCommanderPath(files.binaryPath)}, ${formatAddress(address)}`],
        signal,
      );
      assertCommanderSuccess(result, probe, 'flashWrite');
    });
  }

  /** Reset the target CPU through SEGGER Commander. */
  async reset(
    probe: CommanderProbeContext,
    opts?: { halt?: boolean },
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(
        commanderPath,
        probe,
        file,
        ['r', opts?.halt === true ? 'h' : 'g'],
        signal,
      );
      assertCommanderSuccess(result, probe, 'cpuReset');
    });
  }

  /** Halt the target CPU through SEGGER Commander. */
  async halt(probe: CommanderProbeContext, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(commanderPath, probe, file, ['h'], signal);
      assertCommanderSuccess(result, probe, 'cpuHalt');
    });
  }

  /** Resume target CPU execution through SEGGER Commander. */
  async run(probe: CommanderProbeContext, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(commanderPath, probe, file, ['g'], signal);
      assertCommanderSuccess(result, probe, 'cpuRun');
    });
  }

  /** Halt if needed, then single-step one target instruction through SEGGER Commander. */
  async step(probe: CommanderProbeContext, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(commanderPath, probe, file, ['h', 's'], signal);
      assertCommanderSuccess(result, probe, 'cpuStep');
    });
  }

  /** Read one target CPU register through SEGGER Commander. */
  async readRegister(
    probe: CommanderProbeContext,
    name: string,
    signal?: AbortSignal,
  ): Promise<RegisterValue> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    const registerName = normalizeRegisterName(name);
    return this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(commanderPath, probe, file, ['h', 'regs'], signal);
      assertCommanderSuccess(result, probe, 'registerRead');
      const register = parseRegisterDump(`${result.stdout}\n${result.stderr}`).find(
        (r) => r.name === registerName,
      );
      if (register === undefined) {
        throw new JLinkOperationError(
          sanitizeOutput(
            `J-Link registerRead did not return ${registerName}: ${result.stdout}\n${result.stderr}`,
            probe,
          ),
          { operation: 'registerRead' },
        );
      }
      return register;
    });
  }

  /** Write one target CPU register through SEGGER Commander. */
  async writeRegister(
    probe: CommanderProbeContext,
    name: string,
    value: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    const registerName = normalizeRegisterName(name);
    assertUint32(value, 'registerWrite');
    await this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(
        commanderPath,
        probe,
        file,
        ['h', `wreg ${registerName}, ${formatAddress(value)}`],
        signal,
      );
      assertCommanderSuccess(result, probe, 'registerWrite');
    });
  }

  /** List target CPU registers through SEGGER Commander. */
  async listRegisters(
    probe: CommanderProbeContext,
    signal?: AbortSignal,
  ): Promise<RegisterValue[]> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    return this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(commanderPath, probe, file, ['h', 'regs'], signal);
      assertCommanderSuccess(result, probe, 'registerList');
      const registers = parseRegisterDump(`${result.stdout}\n${result.stderr}`);
      if (registers.length === 0) {
        throw new JLinkOperationError(
          sanitizeOutput(
            `J-Link registerList returned no registers: ${result.stdout}\n${result.stderr}`,
            probe,
          ),
          { operation: 'registerList' },
        );
      }
      return registers;
    });
  }

  /** Read target memory bytes through SEGGER Commander. */
  async readMemory(
    probe: CommanderProbeContext,
    range: MemoryRange,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (signal?.aborted) throw new JLinkAbortedError();
    assertMemoryRange(range, 'memoryRead');
    const commanderPath = this.#requireCommanderPath();
    return this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(
        commanderPath,
        probe,
        file,
        [`mem ${formatAddress(range.address)}, ${range.length}`],
        signal,
      );
      assertCommanderSuccess(result, probe, 'memoryRead');
      const data = parseMemoryDump(`${result.stdout}\n${result.stderr}`);
      if (data.byteLength < range.length) {
        throw new JLinkOperationError(
          sanitizeOutput(
            `J-Link memoryRead returned ${data.byteLength} bytes, expected ${range.length}`,
            probe,
          ),
          { operation: 'memoryRead' },
        );
      }
      return data.subarray(0, range.length);
    });
  }

  /** Write target memory bytes through SEGGER Commander. */
  async writeMemory(
    probe: CommanderProbeContext,
    address: number,
    data: Buffer,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    assertUint32(address, 'memoryWrite address');
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempCommandFile(async (file) => {
      const commands = Array.from(
        data,
        (byte, offset) => `w1 ${formatAddress(address + offset)}, ${formatByte(byte)}`,
      );
      const result = await this.#runCommander(commanderPath, probe, file, commands, signal);
      assertCommanderSuccess(result, probe, 'memoryWrite');
    });
  }

  /** Set a target breakpoint through SEGGER Commander. */
  async setBreakpoint(
    probe: CommanderProbeContext,
    address: number,
    _kind?: 'sw' | 'hw',
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    assertUint32(address, 'breakpointSet address');
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(
        commanderPath,
        probe,
        file,
        [`SetBP ${formatAddress(address)}`],
        signal,
      );
      assertCommanderSuccess(result, probe, 'breakpointSet');
    });
  }

  /** Clear a target breakpoint through SEGGER Commander. */
  async clearBreakpoint(
    probe: CommanderProbeContext,
    address: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new JLinkAbortedError();
    assertUint32(address, 'breakpointClear address');
    const commanderPath = this.#requireCommanderPath();
    await this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(
        commanderPath,
        probe,
        file,
        [`ClrBP ${formatAddress(address)}`],
        signal,
      );
      assertCommanderSuccess(result, probe, 'breakpointClear');
    });
  }

  /** Run a whitelisted diagnostic Commander script after LinkTerm-controlled connect lines. */
  async runScript(
    probe: CommanderProbeContext,
    commands: string[],
    opts?: { timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<CommanderScriptResult> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    const safeCommands = normalizeDiagnosticScriptCommands(commands);
    return this.#withTempCommandFile(async (file) => {
      const result = await this.#runCommander(
        commanderPath,
        probe,
        file,
        safeCommands,
        signal,
        opts?.timeoutMs,
      );
      return sanitizeCommanderScriptResult(result, probe);
    });
  }

  /** Return the trusted Commander executable path or fail before creating temp files. */
  #requireCommanderPath(): string {
    if (this.#commanderPath === undefined) {
      throw new JLinkOperationError(
        'J-Link Commander executable not found; install SEGGER J-Link or set LINKTERM_JLINK_COMMANDER to an existing absolute path',
        { operation: 'resolveJLinkCommander' },
      );
    }
    return this.#commanderPath;
  }

  /** Create temporary binary/script files, run an operation, then remove the directory. */
  async #withTempFlashFiles<T>(
    binary: Buffer,
    fn: (files: TempFlashFiles) => Promise<T>,
  ): Promise<T> {
    return this.#withTempCommandFile(async (file) => {
      const files = {
        ...file,
        binaryPath: path.join(file.dir, 'image.bin'),
      };
      await writeFile(files.binaryPath, binary);
      return fn(files);
    });
  }

  /** Create temporary binary/script/readback files, run an operation, then remove the directory. */
  async #withTempVerifyFiles<T>(
    binary: Buffer,
    fn: (files: TempVerifyFiles) => Promise<T>,
  ): Promise<T> {
    return this.#withTempFlashFiles(binary, async (files) =>
      fn({
        ...files,
        readbackPath: path.join(files.dir, 'readback.bin'),
      }),
    );
  }

  /** Create a temporary J-Link command file path, run an operation, then remove the directory. */
  async #withTempCommandFile<T>(fn: (file: TempCommandFile) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(this.#tempRoot, 'linkterm-jlink-'));
    const file = {
      dir,
      scriptPath: path.join(dir, 'command.jlink'),
    };
    try {
      return await fn(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Write a J-Link command script and execute Commander through the injected runner. */
  async #runCommander(
    commanderPath: string,
    probe: CommanderProbeContext,
    files: TempCommandFile,
    commandLines: string[],
    signal?: AbortSignal,
    timeoutMs?: number,
    onOutput?: (event: SeggerProcessOutputEvent) => void,
  ): Promise<SeggerProcessResult> {
    const script = [
      ...buildConnectionScriptLines(probe, commanderPath),
      ...commandLines,
      'q',
      '',
    ].join('\n');
    await writeFile(files.scriptPath, script, 'utf-8');
    try {
      return await this.#runner.run({
        command: commanderPath,
        args: buildCommanderArgs(probe, files.scriptPath, commanderPath),
        signal,
        timeoutMs: timeoutMs ?? this.#defaultTimeoutMs,
        maxOutputBytes: this.#maxOutputBytes,
        onOutput,
      });
    } catch (err) {
      throw addCommanderTimeoutGuidance(err, commandLines);
    }
  }

  /** Execute one fixed VCOM maintenance command without target/device arguments. */
  async #runVcomCommand(
    selector: ProbeSelector,
    command: 'vcom' | 'vcom enable' | 'vcom disable',
    signal?: AbortSignal,
  ): Promise<SeggerProcessResult> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const commanderPath = this.#requireCommanderPath();
    const serialNumber = selector.serialNumber?.trim();
    return this.#withTempCommandFile(async (file) => {
      await writeFile(file.scriptPath, `${command}\nq\n`, 'utf-8');
      return this.#runner.run({
        command: commanderPath,
        args: buildCommanderProbeMaintenanceArgs(
          file.scriptPath,
          serialNumber !== '' ? serialNumber : undefined,
        ),
        signal,
        timeoutMs: this.#defaultTimeoutMs,
        maxOutputBytes: this.#maxOutputBytes,
      });
    });
  }
}

/** Resolve an explicitly configured or default trusted Commander path. */
function resolveCommanderPath(configuredPath?: string): string | undefined {
  if (configuredPath !== undefined) {
    return isTrustedCommanderPath(configuredPath) ? configuredPath : undefined;
  }
  return resolveDefaultCommanderPath();
}

/** Resolve the default SEGGER J-Link Commander executable path for the host platform. */
export function resolveDefaultCommanderPath(): string | undefined {
  const configured = process.env.LINKTERM_JLINK_COMMANDER?.trim();
  if (configured !== undefined && configured !== '') {
    return isTrustedCommanderPath(configured) ? configured : undefined;
  }
  return buildDefaultCommanderCandidates(
    process.platform,
    process.env,
    defaultWindowsDriveRoots(),
  ).find((candidate) => isTrustedCommanderPath(candidate));
}

/**
 * 构造默认可信 J-Link Commander 候选路径，不执行外部程序。
 *
 * @param platform Node 平台名
 * @param env 环境变量表
 * @param windowsDriveRoots Windows 盘符根，如 C:\\、D:\\
 * @returns 按优先级排序且去重后的绝对路径候选
 */
export function buildDefaultCommanderCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  windowsDriveRoots: readonly string[] = [],
): string[] {
  if (platform !== 'win32') {
    return [
      '/opt/SEGGER/JLink/JLinkExe',
      '/usr/local/SEGGER/JLink/JLinkExe',
      '/Applications/SEGGER/JLink/JLinkExe',
    ];
  }

  const programFileRoots = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    ...windowsDriveRoots.flatMap((driveRoot) => [
      path.win32.join(driveRoot, 'Program Files'),
      path.win32.join(driveRoot, 'Program Files (x86)'),
    ]),
  ];

  return uniqueStrings(
    programFileRoots
      .filter((root): root is string => root !== undefined && root.trim() !== '')
      .map((root) => path.win32.join(root, 'SEGGER', 'JLink', 'JLink.exe')),
  );
}

/** Build fixed local Windows drive roots without querying or executing SEGGER tools. */
function defaultWindowsDriveRoots(): string[] {
  if (process.platform !== 'win32') return [];
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

/** Check whether a Commander path avoids PATH/current-directory executable lookup. */
function isTrustedCommanderPath(candidate: string): boolean {
  return path.isAbsolute(candidate) && existsSync(candidate);
}

const DEVICE_DATABASE_SCAN_MAX_FILES = 2000;

/** 在 SEGGER device XML 中精确匹配 `<ChipInfo Name="...">` 或 `<Device><ChipInfo Name="...">` 条目。 */
function commanderSupportsTarget(commanderPath: string, target: string): boolean {
  const root = path.dirname(commanderPath);
  const databaseFiles = listJLinkDeviceDatabaseFiles(root, commanderPath);

  // 构建两个精确匹配正则：Name="target" 和 Name="-target"
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`Name\\s*=\\s*"${escaped}"`, 'i'),
    new RegExp(`Name\\s*=\\s*"-${escaped}"`, 'i'),
  ];

  for (const file of databaseFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      if (patterns.some((p) => p.test(content))) return true;
    } catch {
      // Ignore unreadable optional SEGGER database fragments and continue scanning others.
    }
  }
  return false;
}

/** Enumerate SEGGER device database XML files under a J-Link installation root. */
function listJLinkDeviceDatabaseFiles(root: string, commanderPath?: string): string[] {
  const files: string[] = [];
  const rootDatabase = path.join(root, 'JLinkDevices.xml');
  if (existsSync(rootDatabase)) files.push(rootDatabase);

  const devicesRoot = path.join(root, 'Devices');
  collectXmlFiles(devicesRoot, files);
  for (const internalExport of cachedInternalDeviceListPaths(commanderPath)) {
    if (isFreshCachedInternalDeviceList(internalExport.cachePath, internalExport.toolPath)) {
      files.push(internalExport.cachePath);
    }
  }
  return files.slice(0, DEVICE_DATABASE_SCAN_MAX_FILES);
}

function cachedInternalDeviceListPaths(
  toolPath: string | undefined,
): Array<{ cachePath: string; toolPath: string }> {
  if (toolPath === undefined) return [];
  return uniqueStrings(
    [toolPath, siblingCommanderPath(toolPath)].filter(
      (candidate): candidate is string => candidate !== undefined,
    ),
  )
    .filter((candidate) => existsSync(candidate))
    .map((candidate) => ({
      cachePath: cachedInternalDeviceListPath(candidate),
      toolPath: candidate,
    }));
}

function cachedInternalDeviceListPath(toolPath: string): string {
  const hash = createHash('sha256').update(toolPath).digest('hex').slice(0, 16);
  return path.join(tmpdir(), 'linkterm-jlink-device-catalog', `ExpDevListXML-${hash}.xml`);
}

function siblingCommanderPath(toolPath: string): string | undefined {
  const fileName = process.platform === 'win32' ? 'JLink.exe' : 'JLinkExe';
  const candidate = path.join(path.dirname(toolPath), fileName);
  return candidate === toolPath ? undefined : candidate;
}

function isFreshCachedInternalDeviceList(cachePath: string, commanderPath: string): boolean {
  try {
    const cache = statSync(cachePath);
    const commander = statSync(commanderPath);
    return cache.isFile() && cache.size > 0 && cache.mtimeMs >= commander.mtimeMs;
  } catch {
    return false;
  }
}

function collectXmlFiles(dir: string, files: string[]): void {
  if (files.length >= DEVICE_DATABASE_SCAN_MAX_FILES || !existsSync(dir)) return;
  let entries: string[];
  try {
    if (!statSync(dir).isDirectory()) return;
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= DEVICE_DATABASE_SCAN_MAX_FILES) return;
    const fullPath = path.join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        collectXmlFiles(fullPath, files);
      } else if (stat.isFile() && entry.toLowerCase().endsWith('.xml')) {
        files.push(fullPath);
      }
    } catch {
      // Ignore files removed or locked during the scan.
    }
  }
}

/** Build command-line arguments for J-Link Commander. */
export function buildCommanderArgs(
  probe: CommanderProbeContext,
  scriptPath: string,
  commanderPath?: string,
): string[] {
  const target = normalizeDeviceName(probe.target, commanderPath);
  const args = [
    '-device',
    target,
    '-if',
    (probe.interface ?? 'swd').toUpperCase(),
    '-speed',
    probe.speedKHz === undefined ? 'auto' : String(probe.speedKHz),
    '-ExitOnError',
    '1',
    '-NoGui',
    '1',
    '-CommandFile',
    scriptPath,
  ];
  if (probe.serialNumber !== undefined) {
    args.splice(args.length - 2, 0, '-SelectEmuBySN', probe.serialNumber);
  }
  return args;
}

function buildCommanderProbeDetectArgs(scriptPath: string): string[] {
  return ['-ExitOnError', '1', '-NoGui', '1', '-CommandFile', scriptPath];
}

function buildCommanderProbeMaintenanceArgs(scriptPath: string, serialNumber?: string): string[] {
  const args = ['-ExitOnError', '1', '-NoGui', '1', '-CommandFile', scriptPath];
  if (serialNumber !== undefined) {
    args.splice(
      args.length - 2,
      0,
      '-SelectEmuBySN',
      safeCommanderToken(serialNumber, 'serialNumber'),
    );
  }
  return args;
}

function normalizeJLinkRebootOptions(opts: JLinkRebootOptions): JLinkRebootOptions {
  const serialNumber = opts.serialNumber?.trim();
  if (opts.reconnectTimeoutMs !== undefined) {
    assertPositiveTimeoutMs(opts.reconnectTimeoutMs, 'jlinkReboot reconnectTimeoutMs');
  }
  if (opts.timeoutMs !== undefined) {
    assertPositiveTimeoutMs(opts.timeoutMs, 'jlinkReboot timeoutMs');
  }
  return {
    force: opts.force ?? true,
    ...(serialNumber !== undefined && serialNumber !== '' ? { serialNumber } : {}),
    ...(opts.reconnectTimeoutMs !== undefined
      ? { reconnectTimeoutMs: opts.reconnectTimeoutMs }
      : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
}

function buildProbeRebootCommand(opts: JLinkRebootOptions): string {
  const parts = ['Reboot'];
  if (opts.force === true) parts.push('force');
  if (opts.reconnectTimeoutMs !== undefined) parts.push(String(opts.reconnectTimeoutMs));
  return parts.join(' ');
}

function probeRebootProcessTimeoutMs(opts: JLinkRebootOptions, defaultTimeoutMs: number): number {
  if (opts.timeoutMs !== undefined) return opts.timeoutMs;
  if (opts.reconnectTimeoutMs !== undefined)
    return Math.max(defaultTimeoutMs, opts.reconnectTimeoutMs + 5_000);
  return defaultTimeoutMs;
}

function assertPositiveTimeoutMs(value: number, operation: string): void {
  if (!Number.isInteger(value) || value <= 0 || value > 600_000) {
    throw new JLinkInvalidStateError(`${operation} requires a timeout between 1 and 600000ms`, {
      expected: '1..600000',
      actual: String(value),
    });
  }
}

function assertAddress(address: number | undefined, operation: string): asserts address is number {
  if (address === undefined) {
    throw new JLinkInvalidStateError(
      `${operation} requires an explicit address for raw binary input`,
      {
        expected: 'address number',
        actual: 'undefined',
      },
    );
  }
}

function buildEraseCommand(opts?: { address?: number; length?: number }): string {
  if (opts?.address === undefined && opts?.length === undefined) return 'erase';
  if (opts?.address === undefined || opts?.length === undefined) {
    throw new JLinkInvalidStateError('flashErase range requires both address and length', {
      expected: 'address and length together, or neither for full chip erase',
      actual: `address=${String(opts?.address)}, length=${String(opts?.length)}`,
    });
  }
  assertUint32(opts.address, 'flashErase address');
  if (!Number.isInteger(opts.length) || opts.length <= 0) {
    throw new JLinkInvalidStateError('flashErase requires a positive length', {
      expected: 'positive integer',
      actual: String(opts.length),
    });
  }
  const endAddress = opts.address + opts.length - 1;
  assertUint32(endAddress, 'flashErase end address');
  return `erase ${formatAddress(opts.address)}, ${formatAddress(endAddress)}`;
}

function buildConnectionScriptLines(
  probe: CommanderProbeContext,
  commanderPath?: string,
): string[] {
  const target = normalizeDeviceName(probe.target, commanderPath);
  return [
    `device ${safeCommanderToken(target, 'target')}`,
    'eoe 1',
    `si ${(probe.interface ?? 'swd').toUpperCase()}`,
    `speed ${probe.speedKHz === undefined ? 'auto' : String(probe.speedKHz)}`,
    'connect',
  ];
}

/**
 * SEGGER 约定：厂商 AddOn 设备名以 `-` 前缀注册，会加载对应的 JLinkScript。
 * 当用户指定了不带前缀的目标名，而 SEGGER 数据库中存在 `-` 前缀的覆盖条目时自动切换。
 *
 * SEGGER J-Link User Guide §Device selection 明确：`-` 前缀表示 vendor-specific add-on，
 * 会替掉同名的内置定义并加载厂商 JLinkScript。此约定跨所有 MCU 厂商有效。
 *
 * 此函数只做数据库存在性检查，不做 JLinkScript 内容验证；如果 AddOn 未安装退回原始目标名，
 * Commander 会用内置定义（如功能不全，会报 RAMCode timeout 等错误）。
 */
function normalizeDeviceName(target: string, commanderPath?: string): string {
  // 已带前缀或无法查数据库时，保持原样
  const normalizedTarget = normalizeJLinkTargetName(target);
  if (normalizedTarget.startsWith('-') || commanderPath === undefined) return normalizedTarget;

  // SEGGER 约定：AddOn 名称 = "-" + 内置名称
  const addOnTarget = `-${normalizedTarget}`;
  if (commanderSupportsTarget(commanderPath, addOnTarget)) return addOnTarget;

  return normalizedTarget;
}

function safeCommanderToken(value: string, field: string): string {
  if (/\s|["'`,;#\r\n]/u.test(value)) {
    throw new JLinkOperationError(`Unsafe J-Link Commander ${field}`, {
      operation: 'buildJLinkScript',
    });
  }
  return value;
}

const DIAGNOSTIC_SCRIPT_MAX_COMMANDS = 64;
const CONTROLLED_CONNECTION_COMMANDS = new Set([
  'device',
  'si',
  'speed',
  'connect',
  'eoe',
  'q',
  'exit',
]);
const FILE_BACKED_COMMANDS = new Set(['loadbin', 'verifybin', 'loadfile', 'savebin', 'savefile']);

function normalizeDiagnosticScriptCommands(commands: string[]): string[] {
  if (commands.length > DIAGNOSTIC_SCRIPT_MAX_COMMANDS) {
    throw new JLinkInvalidStateError('J-Link Commander diagnostic script has too many commands', {
      expected: `at most ${DIAGNOSTIC_SCRIPT_MAX_COMMANDS} commands`,
      actual: String(commands.length),
    });
  }

  const result: string[] = [];
  for (const rawCommand of commands) {
    const command = normalizeDiagnosticScriptCommand(rawCommand);
    if (command !== undefined) result.push(command);
  }
  if (result.length === 0) {
    throw new JLinkInvalidStateError(
      'J-Link Commander diagnostic script contains no runnable commands',
      {
        expected: 'at least one non-connection command',
        actual: 'empty script',
      },
    );
  }
  return result;
}

function normalizeDiagnosticScriptCommand(rawCommand: string): string | undefined {
  const command = rawCommand.trim();
  if (command === '') return undefined;
  if (/[\r\n"'`<>|&;]/u.test(command)) {
    throw new JLinkOperationError('Unsafe J-Link Commander diagnostic command', {
      operation: 'buildJLinkScript',
    });
  }
  const verb = command.split(/[\s,]+/u)[0]!.toLowerCase();
  if (CONTROLLED_CONNECTION_COMMANDS.has(verb)) return undefined;
  if (FILE_BACKED_COMMANDS.has(verb)) {
    throw new JLinkOperationError(
      'File-backed J-Link Commander commands are not accepted by diagnostic scripts',
      {
        operation: 'buildJLinkScript',
      },
    );
  }
  if (isAllowedDiagnosticScriptCommand(command, verb)) return command;
  throw new JLinkInvalidStateError('Unsupported J-Link Commander diagnostic command', {
    expected: 'r/h/g/s/regs/mem/erase/w1/w2/w4/wreg/SetBP/ClrBP command',
    actual: command,
  });
}

function isAllowedDiagnosticScriptCommand(command: string, verb: string): boolean {
  if (/^(r|h|g|s|regs)$/iu.test(command)) return true;
  if (verb === 'mem')
    return /^mem\s+0x[0-9a-fA-F]{1,8}\s*,\s*(?:0x[0-9a-fA-F]+|\d+)$/u.test(command);
  if (verb === 'erase') {
    return (
      /^erase$/iu.test(command) ||
      /^erase\s+0x[0-9a-fA-F]{1,8}\s*,\s*0x[0-9a-fA-F]{1,8}$/u.test(command)
    );
  }
  if (/^w[124]$/u.test(verb)) {
    return /^w[124]\s+0x[0-9a-fA-F]{1,8}\s*,\s*0x[0-9a-fA-F]{1,8}$/iu.test(command);
  }
  if (verb === 'wreg') {
    return /^wreg\s+[A-Za-z][A-Za-z0-9_()]*\s*,\s*0x[0-9a-fA-F]{1,8}$/u.test(command);
  }
  if (verb === 'setbp' || verb === 'clrbp') {
    return /^(?:SetBP|ClrBP)\s+0x[0-9a-fA-F]{1,8}$/iu.test(command);
  }
  return false;
}

function sanitizeCommanderScriptResult(
  result: SeggerProcessResult,
  probe: CommanderProbeContext,
): CommanderScriptResult {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: sanitizeCommanderResultOutput(result.stdout, probe),
    stderr: sanitizeCommanderResultOutput(result.stderr, probe),
    ...(result.truncated === true ? { truncated: true } : {}),
  };
}

function sanitizeCommanderResultOutput(output: string, probe: CommanderProbeContext): string {
  let sanitized = sanitizeProcessOutput(output);
  if (probe.serialNumber !== undefined) {
    sanitized = sanitized.split(probe.serialNumber).join('[redacted]');
  }
  return sanitized;
}

function quoteCommanderPath(filePath: string): string {
  if (/["\r\n]/.test(filePath)) {
    throw new JLinkOperationError('Unsafe path generated for J-Link command file', {
      operation: 'buildJLinkScript',
    });
  }
  return `"${filePath}"`;
}

function formatAddress(address: number): string {
  return `0x${address.toString(16).padStart(8, '0')}`;
}

function normalizeRegisterName(name: string): string {
  const value = name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_()]*$/u.test(value)) {
    throw new JLinkInvalidStateError('Unsafe J-Link register name', {
      expected: 'register name without whitespace or shell metacharacters',
      actual: name,
    });
  }
  return value;
}

function assertUint32(value: number, operation: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new JLinkInvalidStateError(`${operation} requires a 32-bit unsigned value`, {
      expected: '0..0xffffffff',
      actual: String(value),
    });
  }
}

function assertMemoryRange(range: MemoryRange, operation: string): void {
  assertUint32(range.address, `${operation} address`);
  if (!Number.isInteger(range.length) || range.length <= 0) {
    throw new JLinkInvalidStateError(`${operation} requires a positive length`, {
      expected: 'positive integer',
      actual: String(range.length),
    });
  }
  if (range.address + range.length - 1 > 0xffff_ffff) {
    throw new JLinkInvalidStateError(`${operation} range exceeds 32-bit address space`, {
      expected: 'range ending at or below 0xffffffff',
      actual: `${formatAddress(range.address)} + ${range.length}`,
    });
  }
}

function formatByte(value: number): string {
  return `0x${value.toString(16).padStart(2, '0')}`;
}

function assertRttChannel(channelIndex: number, direction: 'up' | 'down'): void {
  if (!Number.isInteger(channelIndex) || channelIndex !== 0) {
    throw new JLinkInvalidStateError(`Only RTT ${direction} channel 0 is currently supported`, {
      expected: `${direction} channelIndex 0`,
      actual: String(channelIndex),
    });
  }
}

function assertRttMaxBytes(maxBytes: number): void {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new JLinkInvalidStateError('RTT read/search requires a positive maxBytes', {
      expected: 'positive integer',
      actual: String(maxBytes),
    });
  }
}

interface FlashProgressReporter {
  emit(update: FlashProgressUpdate): void;
  observeCommanderOutput(
    probe: CommanderProbeContext,
    stage: 'download' | 'verify',
  ): (event: SeggerProcessOutputEvent) => void;
}

function createFlashProgressReporter(
  onProgress: ((update: FlashProgressUpdate) => void) | undefined,
  bytesTotal: number,
): FlashProgressReporter {
  let lastKey = '';

  const emit = (update: FlashProgressUpdate): void => {
    if (onProgress === undefined) return;
    const normalized = normalizeFlashProgressUpdate(update, bytesTotal);
    const key = JSON.stringify(normalized);
    if (key === lastKey) return;
    lastKey = key;
    onProgress(normalized);
  };

  return {
    emit,
    observeCommanderOutput:
      (probe, stage) =>
      (event): void => {
        for (const update of parseFlashProgressOutput(event.chunk, probe, stage, bytesTotal)) {
          emit(update);
        }
      },
  };
}

function parseFlashProgressOutput(
  chunk: string,
  probe: CommanderProbeContext,
  stage: 'download' | 'verify',
  bytesTotal: number,
): FlashProgressUpdate[] {
  return chunk
    .split(/\r?\n/u)
    .map((line) => parseFlashProgressLine(line, probe, stage, bytesTotal))
    .filter((update): update is FlashProgressUpdate => update !== undefined);
}

function parseFlashProgressLine(
  line: string,
  probe: CommanderProbeContext,
  stage: 'download' | 'verify',
  bytesTotal: number,
): FlashProgressUpdate | undefined {
  const message = line.replace(/\s+/gu, ' ').trim();
  if (message === '') return undefined;
  const lower = message.toLowerCase();
  let phase: FlashProgressUpdate['phase'] | undefined;
  if (/eras(?:e|ing|ed)|sector erase/iu.test(lower)) {
    phase = 'erasing';
  } else if (/read(?:ing)? back|savebin|readback|saving/iu.test(lower)) {
    phase = 'readback';
  } else if (/verify|verifying|verification/iu.test(lower)) {
    phase = 'verifying';
  } else if (/download|program|programming|writing|loadbin/iu.test(lower)) {
    phase = stage === 'verify' ? 'verifying' : 'programming';
  }
  if (phase === undefined) return undefined;

  const percent = parseProgressPercent(message);
  return normalizeFlashProgressUpdate(
    {
      phase,
      message: sanitizeOutput(message, probe),
      ...(percent !== undefined ? { percent } : {}),
      bytesTotal,
    },
    bytesTotal,
  );
}

function parseProgressPercent(line: string): number | undefined {
  const match = line.match(/\b(\d{1,3})\s*%/u);
  if (match?.[1] === undefined) return undefined;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

function normalizeFlashProgressUpdate(
  update: FlashProgressUpdate,
  bytesTotal: number,
): FlashProgressUpdate {
  const percent =
    update.percent === undefined
      ? undefined
      : Math.min(100, Math.max(0, Math.round(update.percent)));
  return {
    phase: update.phase,
    message: update.message,
    ...(percent !== undefined ? { percent } : {}),
    ...(update.bytesWritten !== undefined ? { bytesWritten: update.bytesWritten } : {}),
    bytesTotal: update.bytesTotal ?? bytesTotal,
  };
}

function addCommanderTimeoutGuidance(err: unknown, commandLines: string[]): unknown {
  if (!(err instanceof JLinkAbortedError) || !/timed out/i.test(err.message)) return err;
  if (!hasTargetAccessCommand(commandLines)) return err;
  return new JLinkAbortedError(
    `${err.message}; target access did not complete. Check target power, BOOT straps, NRST/reset wiring, SWDIO/SWCLK wiring, exact J-Link device name, debug speed, readout/write protection, and whether another tool owns the probe.`,
  );
}

function hasTargetAccessCommand(commandLines: readonly string[]): boolean {
  return commandLines.some((line) =>
    /^(?:connect|mem|loadbin|verifybin|savebin|loadfile|savefile|h|r|regs|erase|w[124]|wreg|setbp|clrbp)\b/i.test(
      line.trim(),
    ),
  );
}

function parseRegisterDump(output: string): RegisterValue[] {
  const registers: RegisterValue[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const matcher = /(\w[\w()]*?)\s*=\s*([0-9a-fA-F]{1,8})(?=\s*[,\s:]|$)/gu;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(line)) !== null) {
      const rawName = match[1]!;
      const parenMatch = rawName.match(/^(\w+)\(\w+\)$/u);
      const name = (parenMatch?.[1] ?? rawName).toLowerCase();
      registers.push({ name, value: Number.parseInt(match[2]!, 16) >>> 0 });
    }
  }
  return registers;
}

function parseMemoryDump(output: string): Buffer {
  const bytes: number[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^[0-9a-fA-F]{8}\s*=\s*(.*)$/u);
    if (match?.[1] === undefined) continue;
    const byteMatches = match[1].match(/\b[0-9a-fA-F]{2}\b/gu) ?? [];
    for (const byteText of byteMatches) {
      bytes.push(Number.parseInt(byteText, 16));
    }
  }
  return Buffer.from(bytes);
}

function firstMismatchAddress(
  expected: Buffer,
  actual: Buffer,
  baseAddress: number,
): number | undefined {
  const length = Math.min(expected.byteLength, actual.byteLength);
  for (let offset = 0; offset < length; offset += 1) {
    if (expected[offset] !== actual[offset]) return baseAddress + offset;
  }
  if (expected.byteLength !== actual.byteLength) return baseAddress + length;
  return undefined;
}

async function readVerifyReadback(
  readbackPath: string,
  probe: CommanderProbeContext,
): Promise<Buffer> {
  try {
    return await readFile(readbackPath);
  } catch (err) {
    throw new JLinkOperationError(
      sanitizeOutput(
        'J-Link flashVerify binary readback was not produced by Commander savebin',
        probe,
      ),
      {
        operation: 'flashVerify',
        underlying: err,
      },
    );
  }
}

function classifyVerifyMismatch(result: SeggerProcessResult): { mismatchAt?: number } | undefined {
  const output = `${result.stdout}\n${result.stderr}`;
  if (!/verify\s+failed|verify\s+error|contents\s+of\s+.*differ/i.test(output)) return undefined;
  const match = output.match(/(?:address|@)\s*(?:address\s*)?(0x[0-9a-fA-F]+)/i);
  if (!match) return {};
  return { mismatchAt: Number.parseInt(match[1]!, 16) };
}

function assertPositiveVerifyEvidence(
  result: SeggerProcessResult,
  probe: CommanderProbeContext,
  operation: string,
): void {
  const output = `${result.stdout}\n${result.stderr}`;
  if (
    /verify\s+successful|verification\s+successful|contents\s+of\s+.*(?:match|identical)/i.test(
      output,
    )
  ) {
    return;
  }
  throw new JLinkOperationError(
    sanitizeOutput(
      `J-Link ${operation} completed without positive verify evidence: ${output}`,
      probe,
    ),
    { operation },
  );
}

function assertProbeDetectSuccess(result: SeggerProcessResult): void {
  const output = `${result.stdout}\n${result.stderr}`;
  if (/no\s+emulators\s+found|no\s+j-link\s+device\s+found/i.test(output)) return;
  if (result.exitCode === 0 && !/script\s+processing\s+failed/i.test(output)) return;
  throw new JLinkOperationError(
    sanitizeProcessOutput(`J-Link probeDetect failed: ${output}`).slice(0, 4000),
    {
      operation: 'probeDetect',
    },
  );
}

function parseShowEmuListOutput(output: string): ProbeInfo[] {
  const probes: ProbeInfo[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/J-Link\[(\d+)\]:.*?\bSerial\s+number:\s*([^\s,]+)(?:,|\s|$)/iu);
    if (match === null) continue;
    probes.push({
      probeId: `physical-${match[1]!}`,
      serialNumber: match[2]!,
      connected: false,
    });
  }
  return probes;
}

function assertProbeRebootSuccess(result: SeggerProcessResult, serialNumber?: string): void {
  const output = `${result.stdout}\n${result.stderr}`;
  const failed =
    result.exitCode !== 0 ||
    /script\s+processing\s+failed|failed\s+to\s+reboot|cannot\s+reboot|no\s+j-link|no\s+emulators\s+found/i.test(
      output,
    );
  if (!failed) return;
  throw new JLinkOperationError(
    sanitizeProbeRebootOutput(`J-Link jlinkReboot failed: ${output}`, serialNumber).slice(0, 4000),
    {
      operation: 'jlinkReboot',
    },
  );
}

function assertCommanderSuccess(
  result: SeggerProcessResult,
  probe: CommanderProbeContext,
  operation: string,
): void {
  const output = `${result.stdout}\n${result.stderr}`;
  const failed =
    result.exitCode !== 0 ||
    /failed\s+to\s+connect|cannot\s+connect|could\s+not\s+connect|no\s+j-link|no\s+emulators\s+found|ramcode\s+did\s+not\s+respond|verify\s+failed|script\s+processing\s+failed/i.test(
      output,
    );
  if (!failed) return;
  throw new JLinkOperationError(sanitizeOutput(`J-Link ${operation} failed: ${output}`, probe), {
    operation,
  });
}

function assertPositiveTargetAccessEvidence(
  result: SeggerProcessResult,
  probe: CommanderProbeContext,
): void {
  const output = `${result.stdout}\n${result.stderr}`;
  const hasPositiveEvidence =
    /\bfound\s+(?:sw|jtag)-dp\s+with\s+id\b/i.test(output) ||
    /\bcortex-[\w.+-]+\s+identified\b/i.test(output) ||
    /\btarget\s+connection\s+(?:successfully\s+)?established\b/i.test(output) ||
    /\bsuccessfully\s+connected\s+to\s+target\b/i.test(output);
  if (hasPositiveEvidence) return;
  throw new JLinkOperationError(
    sanitizeOutput(
      `J-Link probeConnect completed without positive target-access evidence: ${output}`,
      probe,
    ),
    { operation: 'probeConnect' },
  );
}

function sanitizeOutput(output: string, probe: CommanderProbeContext): string {
  let sanitized = output.replace(/S\/N:\s*\S+/gi, 'S/N: [redacted]');
  if (probe.serialNumber !== undefined) {
    sanitized = sanitized.split(probe.serialNumber).join('[redacted]');
  }
  return sanitized.slice(0, 4000);
}

function sanitizeProbeRebootResult(
  result: SeggerProcessResult,
  serialNumber?: string,
): CommanderScriptResult {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: sanitizeProbeRebootOutput(result.stdout, serialNumber),
    stderr: sanitizeProbeRebootOutput(result.stderr, serialNumber),
    ...(result.truncated === true ? { truncated: true } : {}),
  };
}

function sanitizeProbeRebootOutput(output: string, serialNumber?: string): string {
  let sanitized = sanitizeProcessOutput(output).replace(
    /(Serial\s+number:\s*)[^\s,]+/gi,
    '$1[redacted]',
  );
  if (serialNumber !== undefined) {
    sanitized = sanitized.split(serialNumber).join('[redacted]');
  }
  return sanitized;
}

/** SEGGER GDB server backed client. */
export class DefaultJLinkGdbServerClient implements JLinkGdbServerClient {
  readonly #gdbServerPath: string | undefined;
  readonly #runner: SeggerManagedProcessRunner;
  readonly #defaultTimeoutMs: number;
  readonly #maxOutputBytes: number;

  /** Create a SEGGER GDB server client. */
  constructor(options: DefaultJLinkGdbServerClientOptions = {}) {
    this.#gdbServerPath = resolveGdbServerPath(options.gdbServerPath);
    this.#runner = options.runner ?? new NodeSeggerManagedProcessRunner();
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  /** Check whether a trusted GDB server executable path and exact SEGGER target are configured. */
  checkAvailability(target?: string): JLinkGdbServerAvailability {
    if (this.#gdbServerPath !== undefined) {
      if (target !== undefined && target.trim() !== '') {
        const targetSupported = commanderSupportsTarget(this.#gdbServerPath, target);
        if (targetSupported === true) {
          return {
            available: true,
            gdbServerPath: this.#gdbServerPath,
            target,
            targetSupported: true,
          };
        }
        return {
          available: true,
          gdbServerPath: this.#gdbServerPath,
          target,
          targetSupported: false,
          message: `SEGGER J-Link target ${target} is not listed in the local XML device databases; GDB server may still support built-in targets, but update SEGGER J-Link/device packs or use an exact supported device name if it reports an unknown device.`,
        };
      }
      return { available: true, gdbServerPath: this.#gdbServerPath };
    }
    return {
      available: false,
      reason: 'not-found',
      message:
        'J-Link GDB server executable not found; install SEGGER J-Link or set LINKTERM_JLINK_GDB_SERVER to an existing absolute path',
    };
  }

  /** Start a J-Link GDB server for the given probe. */
  async start(
    probe: CommanderProbeContext,
    opts: { host?: string; port?: number } = {},
    signal?: AbortSignal,
  ): Promise<JLinkGdbServerSession> {
    if (signal?.aborted) throw new JLinkAbortedError();
    const gdbServerPath = this.#requireGdbServerPath();
    const host = normalizeGdbServerHost(opts.host);
    const port = opts.port ?? 2331;
    assertPort(port, 'gdbServerStart');
    try {
      const processHandle = await this.#runner.start({
        command: gdbServerPath,
        args: buildGdbServerArgs(probe, { host, port }),
        signal,
        timeoutMs: this.#defaultTimeoutMs,
        maxOutputBytes: this.#maxOutputBytes,
        readyPattern: GDB_SERVER_READY_PATTERN,
        processName: 'J-Link GDB Server',
      });
      return {
        host,
        port,
        rttTelnetPort: DEFAULT_RTT_TELNET_PORT,
        outputTail: sanitizeOutput(processHandle.outputTail, probe),
        stop: () => processHandle.stop(),
      };
    } catch (err) {
      throw sanitizeGdbServerError(err, probe);
    }
  }

  /** Return the trusted GDB server executable path or fail before spawning. */
  #requireGdbServerPath(): string {
    if (this.#gdbServerPath === undefined) {
      throw new JLinkOperationError(
        'J-Link GDB server executable not found; install SEGGER J-Link or set LINKTERM_JLINK_GDB_SERVER to an existing absolute path',
        { operation: 'resolveJLinkGdbServer' },
      );
    }
    return this.#gdbServerPath;
  }
}

/** Resolve an explicitly configured or default trusted J-Link GDB server path. */
function resolveGdbServerPath(configuredPath?: string): string | undefined {
  if (configuredPath !== undefined) {
    return isTrustedCommanderPath(configuredPath) ? configuredPath : undefined;
  }
  return resolveDefaultGdbServerPath();
}

/** Resolve the default SEGGER J-Link GDB server executable path for the host platform. */
export function resolveDefaultGdbServerPath(): string | undefined {
  const configured = process.env.LINKTERM_JLINK_GDB_SERVER?.trim();
  if (configured !== undefined && configured !== '') {
    return isTrustedCommanderPath(configured) ? configured : undefined;
  }
  return buildDefaultGdbServerCandidates(
    process.platform,
    process.env,
    defaultWindowsDriveRoots(),
  ).find((candidate) => isTrustedCommanderPath(candidate));
}

/**
 * 构造默认可信 J-Link GDB server 候选路径，不执行外部程序。
 *
 * @param platform Node 平台名
 * @param env 环境变量表
 * @param windowsDriveRoots Windows 盘符根，如 C:\\、D:\\
 * @returns 按优先级排序且去重后的绝对路径候选
 */
export function buildDefaultGdbServerCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  windowsDriveRoots: readonly string[] = [],
): string[] {
  if (platform !== 'win32') {
    return [
      '/opt/SEGGER/JLink/JLinkGDBServerCLExe',
      '/usr/local/SEGGER/JLink/JLinkGDBServerCLExe',
      '/Applications/SEGGER/JLink/JLinkGDBServerCLExe',
    ];
  }

  const programFileRoots = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    ...windowsDriveRoots.flatMap((driveRoot) => [
      path.win32.join(driveRoot, 'Program Files'),
      path.win32.join(driveRoot, 'Program Files (x86)'),
    ]),
  ];

  return uniqueStrings(
    programFileRoots
      .filter((root): root is string => root !== undefined && root.trim() !== '')
      .map((root) => path.win32.join(root, 'SEGGER', 'JLink', 'JLinkGDBServerCL.exe')),
  );
}

const GDB_SERVER_READY_PATTERN =
  /listening\s+on\s+tcp\/ip\s+port|gdb\s+server\s+listening\s+port|waiting\s+for\s+gdb\s+connection|gdb\s+server\s+is\s+running/i;
const DEFAULT_RTT_TELNET_PORT = 19021;

function buildGdbServerArgs(
  probe: CommanderProbeContext,
  opts: { host: string; port: number },
): string[] {
  const target = normalizeJLinkTargetName(probe.target);
  const args = [
    '-device',
    safeCommanderToken(target, 'target'),
    '-if',
    (probe.interface ?? 'swd').toUpperCase(),
    '-speed',
    probe.speedKHz === undefined ? 'auto' : String(probe.speedKHz),
    '-port',
    String(opts.port),
    '-RTTTelnetPort',
    String(DEFAULT_RTT_TELNET_PORT),
    '-localhostonly',
    isLoopbackHost(opts.host) ? '1' : '0',
    '-nogui',
    '-silent',
  ];
  if (probe.serialNumber !== undefined) {
    args.push('-select', `USB=${safeCommanderToken(probe.serialNumber, 'serialNumber')}`);
  }
  return args;
}

function normalizeGdbServerHost(host: string | undefined): string {
  const value = host?.trim() ?? '127.0.0.1';
  if (value === '') return '127.0.0.1';
  if (/\s|["'`,;#\r\n]/u.test(value)) {
    throw new JLinkInvalidStateError('Unsafe J-Link GDB server host', {
      expected: 'host without shell metacharacters',
      actual: value,
    });
  }
  return value;
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function assertPort(port: number, operation: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new JLinkInvalidStateError(`${operation} requires a TCP port between 1 and 65535`, {
      expected: '1..65535',
      actual: String(port),
    });
  }
}

function sanitizeGdbServerError(err: unknown, probe: CommanderProbeContext): Error {
  if (err instanceof JLinkAbortedError) {
    return new JLinkAbortedError(sanitizeOutput(err.message, probe));
  }
  if (err instanceof JLinkOperationError) {
    return new JLinkOperationError(sanitizeOutput(err.message, probe), {
      operation: err.operation,
      underlying: err.underlying,
    });
  }
  if (err instanceof JLinkInvalidStateError) {
    return err;
  }
  if (err instanceof Error) {
    return new JLinkOperationError(sanitizeOutput(err.message, probe), {
      operation: 'gdbServerStart',
      underlying: err,
    });
  }
  return new JLinkOperationError(sanitizeOutput(String(err), probe), {
    operation: 'gdbServerStart',
  });
}
