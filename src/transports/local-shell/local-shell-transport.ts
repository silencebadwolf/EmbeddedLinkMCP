import { EventEmitter } from 'node:events';
import { platform } from 'node:os';
import {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  DEFAULT_TERM_TYPE,
} from '../../shared/constants.js';
import type { LocalShellSessionConfig } from '../../shared/types.js';
import type { ITransport } from '../types.js';
import {
  defaultPtyFactory,
  type IDisposable,
  type PtyExitInfo,
  type PtyFactory,
  type PtyLike,
  type PtySpawnOptions,
} from './pty-like.js';

export interface LocalShellTransportOptions {
  config: LocalShellSessionConfig;
  /** 注入用 PTY 工厂；省略时使用真实 `node-pty`。 */
  ptyFactory?: PtyFactory;
}

/** transport 与 session 间通信的内部事件载荷。 */
export interface LocalShellExitEvent {
  exitCode: number;
  signal?: number;
}

/**
 * 默认 shell 解析：
 * - macOS / Linux: `process.env.SHELL` ?? '/bin/bash'
 * - Windows: `process.env.COMSPEC` ?? 'cmd.exe'
 *
 * 用户可通过 `LocalShellSessionConfig.shell` 显式覆盖。
 */
function resolveDefaultShell(): string {
  if (platform() === 'win32') {
    return process.env.COMSPEC ?? 'cmd.exe';
  }
  return process.env.SHELL ?? '/bin/bash';
}

/**
 * 本地 Shell（PTY）ITransport 实现。
 *
 * 关键语义：
 * - `open()` 同步 spawn 子进程；spawn 失败抛出底层错误，对外呈现"open 失败"。
 * - `write(data)` 字节经 UTF-8 解码后写入 PTY stdin（node-pty 在 macOS/Linux 接受字符串）。
 * - `resize(cols, rows)` 转发到底层 PTY；调用时若 transport 未打开则忽略（与 Phase 7 的 PTY 调整契合）。
 * - PTY 子进程退出会先 emit 'exit'（携带 exitCode/signal，供 LocalShellSession 写审计），再 emit 'close'，
 *   最终让 SessionBase 进入 'closed' 状态 —— 非 0 退出码不再升级为 errored（按 F5 决策）。
 * - `close()` 主动 kill 子进程；幂等，多次调用只 emit 一次 'close'。
 */
export class LocalShellTransport extends EventEmitter implements ITransport {
  readonly #spawnOptions: PtySpawnOptions;
  readonly #ptyFactory: PtyFactory;
  #pty: PtyLike | null = null;
  #disposables: IDisposable[] = [];
  #closed = false;
  #closeEmitted = false;

  constructor(options: LocalShellTransportOptions) {
    super();
    this.#spawnOptions = LocalShellTransport.#buildSpawnOptions(options.config);
    this.#ptyFactory = options.ptyFactory ?? defaultPtyFactory;
  }

  isOpen(): boolean {
    return this.#pty !== null && !this.#closed;
  }

  /**
   * 打开 PTY：同步 spawn → 订阅 onData/onExit。
   * spawn 抛错时不保留半初始化引用；与 SessionBase.open() 的释放约定一致。
   */
  async open(): Promise<void> {
    if (this.isOpen()) return;
    if (this.#closed) throw new Error('LocalShellTransport has been closed; create a new instance');

    const pty = this.#ptyFactory(this.#spawnOptions);
    this.#pty = pty;
    this.#disposables.push(
      pty.onData((data) => {
        // node-pty 给出 UTF-8 字符串；用 TextEncoder 转回字节，对外保持 ITransport.data 契约
        this.emit('data', new TextEncoder().encode(data));
      }),
    );
    this.#disposables.push(
      pty.onExit((info) => {
        this.#handleExit(info);
      }),
    );
  }

  /**
   * 关闭 PTY 并 kill 子进程。
   *
   * 已 closed 直接 resolve（幂等）。同步释放 onData/onExit 订阅 ——
   * 子进程被 SIGHUP 后到真正退出之间仍可能产出数据，不释放就会继续灌进 transcript，
   * 在 SessionBase.state==='closed' 之后还看到 'data' 事件违反审计直觉。
   * 真正的 'close' emit 由后续 onExit 触发；无 pty 持有时（直接 close()）通过 queueMicrotask
   * 异步 emit，避免在 SessionBase 还没把 state 推进前就同步触发 'closed'。
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const pty = this.#pty;
    if (!pty) {
      queueMicrotask(() => {
        if (!this.#closeEmitted) {
          this.#closeEmitted = true;
          this.emit('close');
        }
      });
      return;
    }
    this.#disposeListeners();
    this.#pty = null;
    try {
      pty.kill();
    } catch {
      // 子进程可能已退出；忽略 kill 抛出的"no such process"
    }
    // 主动 close 不再等待子进程实际退出 —— mock 与生产环境的退出回调时机不可预期；
    // 立即 emit 'close' 让 SessionBase 完成状态收敛。
    queueMicrotask(() => {
      if (!this.#closeEmitted) {
        this.#closeEmitted = true;
        this.emit('close');
      }
    });
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.isOpen() || !this.#pty) {
      throw new Error('LocalShellTransport is not open');
    }
    const text = new TextDecoder('utf-8').decode(data);
    this.#pty.write(text);
  }

  /**
   * 调整 PTY 窗口尺寸。
   *
   * 未打开时静默返回 —— ISession.resize 调用方会在 state!=='open' 时短路，
   * 这里再加一层保险，避免 race（close 后 resize 到达）。
   */
  resize(cols: number, rows: number): void {
    if (!this.isOpen() || !this.#pty) return;
    this.#pty.resize(cols, rows);
  }

  #handleExit(info: PtyExitInfo): void {
    this.#disposeListeners();
    this.#pty = null;
    this.#closed = true;
    const exitEvent: LocalShellExitEvent = { exitCode: info.exitCode, signal: info.signal };
    this.emit('exit', exitEvent);
    if (!this.#closeEmitted) {
      this.#closeEmitted = true;
      this.emit('close');
    }
  }

  #disposeListeners(): void {
    for (const d of this.#disposables) {
      try {
        d.dispose();
      } catch {
        // dispose 可能在底层已释放后失败，吞掉
      }
    }
    this.#disposables = [];
  }

  /**
   * 把用户配置展平成 spawn 时需要的完整参数。
   *
   * env 规则：缺省时**继承**整个 `process.env`（仅保留 string 值），显式提供时**整体替换**。
   * 这与 SessionConfig 的 JSDoc 约束一致 —— 防止"补丁式 env"意外泄漏外部变量。
   */
  static #buildSpawnOptions(config: LocalShellSessionConfig): PtySpawnOptions {
    const file = config.shell ?? resolveDefaultShell();
    const args = config.args ?? [];
    const env = config.env
      ? { ...config.env }
      : (() => {
          const out: Record<string, string> = {};
          for (const key of Object.keys(process.env)) {
            const value = process.env[key];
            if (typeof value === 'string') out[key] = value;
          }
          return out;
        })();
    return {
      file,
      args,
      cwd: config.cwd,
      env,
      cols: config.cols ?? DEFAULT_PTY_COLS,
      rows: config.rows ?? DEFAULT_PTY_ROWS,
      name: config.term ?? DEFAULT_TERM_TYPE,
    };
  }
}
