import type { SessionId, SshSessionConfig } from '../../shared/types.js';
import { SessionBase } from '../../core/session/session-base.js';
import { SshTransport } from './ssh-transport.js';
import type {
  SshClientFactory,
  SshCredentials,
  SshHostVerifier,
} from './ssh-client-like.js';

export interface SshSessionOptions {
  id: SessionId;
  config: SshSessionConfig;
  /**
   * 认证凭据（密码 / 私钥）。**仅在 open() 调用瞬间被 SshTransport 持有**，
   * 之后立即清空 —— 不会进入字段、不会写入 transcript（req §4.4 / §5.1）。
   */
  credentials: SshCredentials;
  /**
   * 主机指纹校验。Phase 3 必填 —— 上层 IPC handler 应弹 UI 让用户决策；
   * 自动化测试可注入 `() => true / false`。Phase 8 引入 known_hosts 后会有默认实现。
   */
  hostVerifier: SshHostVerifier;
  /** 注入用 ssh2.Client 工厂；测试场景下传 FakeSshClient 工厂。 */
  clientFactory?: SshClientFactory;
  /** TranscriptBuffer 容量上限（仅用于测试覆盖溢出场景）。 */
  transcriptCapacity?: number;
}

/**
 * SSH 会话实现。
 *
 * 在 SessionBase 之上加一项 SSH 特有能力：`resize(cols, rows)` 把远端 PTY 窗口尺寸
 * 通过 ssh2.Channel.setWindow 同步到服务端。其余生命周期/审计语义沿用 SessionBase。
 */
export class SshSession extends SessionBase {
  readonly #transport: SshTransport;

  constructor(options: SshSessionOptions) {
    const transport = new SshTransport({
      config: options.config,
      credentials: options.credentials,
      hostVerifier: options.hostVerifier,
      clientFactory: options.clientFactory,
    });
    super({
      id: options.id,
      transport,
      transcriptCapacity: options.transcriptCapacity,
    });
    this.#transport = transport;
  }

  /**
   * 调整远端 PTY 窗口尺寸。仅 state==='open' 时生效；其它状态下静默返回。
   */
  async resize(cols: number, rows: number): Promise<void> {
    if (this.state !== 'open') return;
    this.#transport.resize(cols, rows);
  }
}
