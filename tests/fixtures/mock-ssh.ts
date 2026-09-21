import { EventEmitter } from 'node:events';
import type {
  SshChannelLike,
  SshClientFactory,
  SshClientLike,
  SshConnectOptions,
  SshShellOptions,
} from '@linkterm/runtime/transports/ssh/ssh-client-like';

export interface FakeSshBehavior {
  /** connect 后多少微任务后 emit 'ready'；省略 = 立刻 ready。 */
  readyDelayTicks?: number;
  /** connect 后改为 emit 'error'，模拟 DNS / 认证失败。 */
  failOnConnect?: Error;
  /** shell() 回调返回错误，模拟 shell 请求被拒。 */
  failOnShell?: Error;
  /** hostVerifier 接到的 key 内容（默认 Buffer.from('FAKEKEY')）。 */
  hostKey?: Buffer | string;
  /**
   * 默认情况下 `end()` 会在下一个微任务 emit `'close'`（模拟 ssh2 的常见行为）。
   * 置为 true 时 end() 不再 emit `'close'` —— 用于断言 transport 是否主动 end client、
   * 或模拟 "channel close 但 TCP 仍存活，等到 ssh server keepalive 超时才断" 这类场景。
   */
  silentEnd?: boolean;
  /** 让 shell() 回调永不触发，模拟 "ready 已收到但 shell 请求悬挂" 的窗口期。 */
  shellHang?: boolean;
}

/**
 * `SshChannelLike` 的进程内 mock。
 *
 * 测试通过 `pushIncoming` / `pushClose` / `pushExtended` 主动驱动事件；
 * 所有 write 字节按顺序记录在 `writes`，setWindow 调用记录在 `windows`。
 */
export class FakeSshChannel extends EventEmitter implements SshChannelLike {
  readonly writes: Buffer[] = [];
  readonly windows: { rows: number; cols: number; height: number; width: number }[] = [];
  endCalls = 0;

  write(data: Buffer | Uint8Array): boolean {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.writes.push(buf);
    return true;
  }

  end(): void {
    this.endCalls += 1;
  }

  setWindow(rows: number, cols: number, height: number, width: number): void {
    this.windows.push({ rows, cols, height, width });
  }

  pushIncoming(data: Buffer | Uint8Array): void {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.emit('data', buf);
  }

  pushClose(): void {
    this.emit('close');
  }
}

/** `SshClientLike` 的进程内 mock。 */
export class FakeSshClient extends EventEmitter implements SshClientLike {
  readonly behavior: FakeSshBehavior;
  /** connect() 收到的最后一组 options（含 hostVerifier）—— 测试用来反查凭据。 */
  lastConnect?: SshConnectOptions;
  /** 当前持有的 channel；shell() 成功后填充。 */
  channel?: FakeSshChannel;
  endCalls = 0;
  shellCalls: SshShellOptions[] = [];

  constructor(behavior: FakeSshBehavior = {}) {
    super();
    this.behavior = behavior;
  }

  connect(options: SshConnectOptions): void {
    this.lastConnect = options;
    const ticks = this.behavior.readyDelayTicks ?? 0;
    const fire = (): void => {
      if (this.behavior.failOnConnect) {
        this.emit('error', this.behavior.failOnConnect);
        return;
      }
      // hostVerifier 必定被调用 —— SshTransport 把它作为 hostVerifier 传给 ssh2
      const key = this.behavior.hostKey ?? Buffer.from('FAKEKEY');
      options.hostVerifier(key, (allow) => {
        if (allow) {
          this.emit('ready');
        } else {
          this.emit('error', new Error('host key rejected'));
        }
      });
    };
    if (ticks <= 0) {
      queueMicrotask(fire);
    } else {
      let n = ticks;
      const loop = (): void => {
        n -= 1;
        if (n <= 0) fire();
        else queueMicrotask(loop);
      };
      queueMicrotask(loop);
    }
  }

  end(): void {
    this.endCalls += 1;
    if (this.behavior.silentEnd) return;
    queueMicrotask(() => this.emit('close'));
  }

  shell(
    options: SshShellOptions,
    callback: (err: Error | null | undefined, channel: SshChannelLike) => void,
  ): void {
    this.shellCalls.push(options);
    if (this.behavior.shellHang) return;
    queueMicrotask(() => {
      if (this.behavior.failOnShell) {
        callback(this.behavior.failOnShell, undefined as unknown as SshChannelLike);
        return;
      }
      const ch = new FakeSshChannel();
      this.channel = ch;
      callback(null, ch);
    });
  }

  /** 测试便捷方法：等待若干微任务，让事件链路 settle。 */
  async settle(ticks = 4): Promise<void> {
    for (let i = 0; i < ticks; i += 1) await Promise.resolve();
  }
}

export function createMockSshClientFactory(behavior: FakeSshBehavior = {}): {
  factory: SshClientFactory;
  created: FakeSshClient[];
} {
  const created: FakeSshClient[] = [];
  const factory: SshClientFactory = () => {
    const c = new FakeSshClient(behavior);
    created.push(c);
    return c;
  };
  return { factory, created };
}
