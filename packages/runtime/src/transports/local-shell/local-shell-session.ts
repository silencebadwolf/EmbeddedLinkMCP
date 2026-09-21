import type { LocalShellSessionConfig, SessionId } from '@linkterm/contracts/types';
import { SessionBase } from '../../core/session/session-base.js';
import { LocalShellTransport, type LocalShellExitEvent } from './local-shell-transport.js';
import type { PtyFactory } from './pty-like.js';

export interface LocalShellSessionOptions {
  id: SessionId;
  config: LocalShellSessionConfig;
  /** 注入用 PTY 工厂；测试场景下传 FakePty 工厂。 */
  ptyFactory?: PtyFactory;
  /** TranscriptBuffer 容量上限（仅用于测试覆盖溢出场景）。 */
  transcriptCapacity?: number;
}

/**
 * 本地 Shell（PTY）会话实现。
 *
 * 在 SessionBase 之上做了两件 PTY 特有的事：
 * 1. 把 transport 'exit' 事件翻译为一条 system-origin 的 state 事件
 *    （`meta:{kind:'pty-exit', exitCode, signal}`），让 MCP 客户端能在 transcript 中
 *    结构化解析子进程退出原因（按 F5 决策：非 0 退出**不**升级为 errored）。
 * 2. 暴露 `resize(cols, rows)` —— ISession 上的可选方法 —— 直接转发到 transport。
 */
export class LocalShellSession extends SessionBase {
  readonly #transport: LocalShellTransport;

  constructor(options: LocalShellSessionOptions) {
    const transport = new LocalShellTransport({
      config: options.config,
      ptyFactory: options.ptyFactory,
    });
    super({
      id: options.id,
      transport,
      transcriptCapacity: options.transcriptCapacity,
    });
    this.#transport = transport;
    this.#transport.on('exit', (event: LocalShellExitEvent) => {
      this.recordSystemEvent({
        type: 'state',
        origin: 'system',
        meta: {
          kind: 'pty-exit',
          exitCode: event.exitCode,
          ...(event.signal !== undefined ? { signal: event.signal } : {}),
        },
      });
    });
  }

  /**
   * 调整本地 PTY 窗口尺寸。仅 state==='open' 时生效；其它状态下静默返回。
   */
  async resize(cols: number, rows: number): Promise<void> {
    if (this.state !== 'open') return;
    this.#transport.resize(cols, rows);
  }
}
