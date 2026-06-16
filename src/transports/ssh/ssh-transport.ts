import { EventEmitter } from 'node:events';
import {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  DEFAULT_SSH_KEEPALIVE_INTERVAL_MS,
  DEFAULT_SSH_READY_TIMEOUT_MS,
  DEFAULT_TERM_TYPE,
} from '../../shared/constants.js';
import type { SshSessionConfig } from '../../shared/types.js';
import type { ITransport } from '../types.js';
import {
  defaultSshClientFactory,
  type SshChannelLike,
  type SshClientFactory,
  type SshClientLike,
  type SshConnectOptions,
  type SshCredentials,
  type SshHostVerifier,
  type SshShellOptions,
} from './ssh-client-like.js';

export interface SshTransportOptions {
  config: SshSessionConfig;
  /** 认证凭据。仅在 open() 期间持有，不写入字段、不入 transcript。 */
  credentials: SshCredentials;
  /** 主机指纹校验。必填 —— 不提供 = 拒绝连接（避免悄悄接受任意 key）。 */
  hostVerifier: SshHostVerifier;
  /** 注入用 Client 工厂；省略时使用真实 ssh2.Client。 */
  clientFactory?: SshClientFactory;
}

/**
 * SSH ITransport 实现。
 *
 * 关键语义：
 * - `open()` 走 ssh2 的 connect → ready → shell 三段：
 *   1. 调 client.connect(...)，传入 hostVerifier 包装回调
 *   2. 'ready' 后调 client.shell(...)，期间持续监听 client 'error' / 'close' —— 任何中途失败都会 reject
 *   3. channel 'data' / 'error' / 'close' 转发到 ITransport 同名事件
 *   全程任意一步抛错，都会主动断开 client 并 reject open。
 * - `write(data)` 直接写入 channel；不调用 drain（ssh2 channel 是 stream，背压由 Node 内部排队）。
 * - `close()` 调 channel.end() 后再 client.end()；幂等。底层 'close' 抵达后由 #emitCloseOnce 唯一触发对外 'close'。
 * - 'error' 透传；'close' 在 channel 或 client 关闭时 emit 一次（带 #closeEmitted 去重）。
 * - 远端 shell 退出（channel 'close'）会主动 client.end() 释放 TCP，避免 nohup 等场景下的 socket 泄漏。
 * - 凭据生命周期：仅 open() 调用瞬间持有，open() 内首个 await 之前置空 —— 满足 §4.4/§5.1。
 */
export class SshTransport extends EventEmitter implements ITransport {
  readonly #config: SshSessionConfig;
  readonly #hostVerifier: SshHostVerifier;
  readonly #clientFactory: SshClientFactory;
  #credentials: SshCredentials | null;
  #client: SshClientLike | null = null;
  #channel: SshChannelLike | null = null;
  /** close() 已被调用（拒绝再次进入），不代表 'close' 事件已 emit。 */
  #closeRequested = false;
  /** 'close' 事件已对外 emit 过一次 —— 用于 #emitCloseOnce 去重。 */
  #closeEmitted = false;
  #opened = false;

  constructor(options: SshTransportOptions) {
    super();
    this.#config = options.config;
    this.#credentials = options.credentials;
    this.#hostVerifier = options.hostVerifier;
    this.#clientFactory = options.clientFactory ?? defaultSshClientFactory;
  }

  isOpen(): boolean {
    return this.#opened && !this.#closeRequested;
  }

  /**
   * 建立 SSH 连接并开 shell channel。
   *
   * 失败路径（任意步骤抛错或 hostVerifier 拒绝）会主动调用 client.end() 释放底层 socket，
   * 与 SessionBase.open() 的"半初始化释放"约定一致。
   */
  async open(): Promise<void> {
    if (this.isOpen()) return;
    if (this.#closeRequested) {
      throw new Error('SshTransport has been closed; create a new instance');
    }
    if (!this.#credentials) {
      throw new Error('SshTransport credentials are missing; cannot open');
    }

    const client = this.#clientFactory();
    this.#client = client;
    const credentials = this.#credentials;
    // 立即清空字段引用 —— 即使后续步骤抛错，凭据也只在本函数局部变量中存活。
    this.#credentials = null;

    try {
      await this.#waitForReady(client, credentials);
    } catch (err) {
      this.#abortOpen(client, err);
    }

    let channel: SshChannelLike;
    try {
      channel = await this.#requestShell(client);
    } catch (err) {
      this.#abortOpen(client, err);
    }

    this.#channel = channel;
    this.#opened = true;
    this.#bindChannelEvents(channel);
    this.#bindClientEvents(client);
  }

  /**
   * 关闭 SSH：先 channel.end()，再 client.end()。幂等。
   *
   * 'close' 事件并不在 close() 内同步 emit —— 真实 ssh2 在 client.end() 后异步触发 'close'，
   * 由 #bindClientEvents 路由到 #emitCloseOnce；无 client 的情况（test 直接 close() 或 open()
   * 失败被 SessionBase 兜底调用）则用 queueMicrotask 异步 emit，
   * 避免在 SessionBase 还没把 state 推到 'errored' 时就同步触发 'closed'。
   */
  async close(): Promise<void> {
    if (this.#closeRequested) return;
    this.#closeRequested = true;
    const channel = this.#channel;
    const client = this.#client;
    if (!client) {
      queueMicrotask(() => this.#emitCloseOnce());
      return;
    }
    try {
      channel?.end();
    } catch {
      // ssh2 channel 已结束时 end() 可能抛 ERR_STREAM_WRITE_AFTER_END；忽略
    }
    try {
      client.end();
    } catch {
      // 同上：底层 socket 已断时 end() 可能 throw；忽略
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.isOpen() || !this.#channel) {
      throw new Error('SshTransport is not open');
    }
    const buf = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    this.#channel.write(buf);
  }

  /**
   * 调整远端 PTY 窗口尺寸。未打开时静默返回（与 LocalShellTransport 对齐）。
   * setWindow 的 height/width 像素参数 ssh2 在大多数后端忽略，传 0 即可。
   */
  resize(cols: number, rows: number): void {
    if (!this.isOpen() || !this.#channel) return;
    this.#channel.setWindow(rows, cols, 0, 0);
  }

  /**
   * connect → ready 阶段的 promise 包装。任意一方先到都通过 cleanup 撤回订阅，
   * 防止后续 stage 接到陈旧事件。
   */
  #waitForReady(client: SshClientLike, credentials: SshCredentials): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const onReady = (): void => {
        cleanup();
        resolve();
      };
      const cleanup = (): void => {
        client.off('ready', onReady);
        client.off('error', onError);
      };
      client.once('ready', onReady);
      client.once('error', onError);
      client.connect(this.#buildConnectOptions(credentials));
    });
  }

  /**
   * 请求 shell channel。期间持续监听 client 'error' / 'close'，
   * 修复"ready 与 shell 回调之间无 error 监听 → uncaughtException / open 永挂"的窗口（review 发现 #2）。
   */
  #requestShell(client: SshClientLike): Promise<SshChannelLike> {
    return new Promise<SshChannelLike>((resolve, reject) => {
      let settled = false;
      const onError = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const onClose = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('SSH client closed before shell was established'));
      };
      const cleanup = (): void => {
        client.off('error', onError);
        client.off('close', onClose);
      };
      client.once('error', onError);
      client.once('close', onClose);

      const shellOpts: SshShellOptions = {
        rows: this.#config.rows ?? DEFAULT_PTY_ROWS,
        cols: this.#config.cols ?? DEFAULT_PTY_COLS,
        term: this.#config.term ?? DEFAULT_TERM_TYPE,
      };
      client.shell(shellOpts, (err, ch) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve(ch);
      });
    });
  }

  /** 释放 open() 半初始化路径上的 client 引用，并把任何错误规整成 Error 后抛出。 */
  #abortOpen(client: SshClientLike, err: unknown): never {
    client.on('error', swallowLateOpenError);
    try {
      client.end();
    } catch {
      // 释放途中的二次错误吞掉；上层只关心首因
    }
    this.#client = null;
    throw err instanceof Error ? err : new Error(String(err));
  }

  #bindChannelEvents(channel: SshChannelLike): void {
    channel.on('data', (chunk: Buffer) => {
      this.emit('data', chunk);
    });
    channel.on('error', (err: Error) => {
      // ssh2 ClientChannel 是 stream.Duplex，会 emit 'error'（write-after-EOF / 协议异常等）。
      // 必须有监听否则升级为 uncaughtException。
      this.emit('error', err);
    });
    channel.on('close', () => {
      // 远端 shell 退出后 ssh2 不会自动断 client（守护进程场景下 TCP 可能仍存活）。
      // 主动 end() 释放 socket，再走 #emitCloseOnce。
      try {
        this.#client?.end();
      } catch {
        // ignore
      }
      this.#emitCloseOnce();
    });
  }

  #bindClientEvents(client: SshClientLike): void {
    client.on('error', (err: Error) => {
      this.emit('error', err);
    });
    client.on('close', () => {
      this.#emitCloseOnce();
    });
  }

  #emitCloseOnce(): void {
    if (this.#closeEmitted) return;
    this.#closeEmitted = true;
    this.#closeRequested = true;
    this.emit('close');
  }

  #buildConnectOptions(credentials: SshCredentials): SshConnectOptions {
    const verifier = this.#hostVerifier;
    return {
      host: this.#config.host,
      port: this.#config.port,
      username: this.#config.username,
      readyTimeout: this.#config.readyTimeoutMs ?? DEFAULT_SSH_READY_TIMEOUT_MS,
      keepaliveInterval:
        this.#config.keepaliveIntervalMs ?? DEFAULT_SSH_KEEPALIVE_INTERVAL_MS,
      hostVerifier: (key, cb) => {
        // ssh2 支持同步/异步两种回调风格；这里统一异步处理，避免抛错跨协议层
        Promise.resolve(verifier(key))
          .then((allow) => cb(allow))
          .catch(() => cb(false));
      },
      ...(credentials.kind === 'password'
        ? { password: credentials.password }
        : {
            privateKey: credentials.privateKey,
            ...(credentials.passphrase !== undefined ? { passphrase: credentials.passphrase } : {}),
          }),
    };
  }
}

const swallowLateOpenError = (): void => {
  /* swallow late ssh2 errors after open() has already failed */
};
