import { createRequire } from 'node:module';
import type { EventEmitter } from 'node:events';

/**
 * `SshTransport` 实际依赖的最小 ssh2 Channel 接口面。
 *
 * 真实 ssh2.ClientChannel 是 stream.Duplex 的子类；这里只列出我们用到的方法和事件，
 * 让测试通过 `tests/fixtures/mock-ssh.ts` 实现该接口注入即可，无需启动真实 SSH server。
 *
 * 事件契约：
 * - 'data'(Buffer) — stdout 字节
 * - 'close'(code?, signal?) — 远端 shell 退出
 * - 'extended data'(type, Buffer) — stderr（type=1）；可选订阅
 */
export interface SshChannelLike extends EventEmitter {
  write(data: Buffer | Uint8Array): boolean;
  end(): void;
  /** 调整远端 PTY 窗口尺寸（rows/cols 顺序与 ssh2 一致）。 */
  setWindow(rows: number, cols: number, height: number, width: number): void;
}

/**
 * `SshTransport` 用到的最小 ssh2.Client 接口。
 *
 * 事件契约：
 * - 'ready'        — 握手完成，可以请求 shell
 * - 'error'(Error) — 任意错误（DNS / 认证 / 协议）
 * - 'close'        — 连接关闭
 * - 'banner'(msg)  — 服务端 banner（可选订阅）
 */
export interface SshClientLike extends EventEmitter {
  connect(options: SshConnectOptions): void;
  end(): void;
  shell(
    options: SshShellOptions,
    callback: (err: Error | null | undefined, channel: SshChannelLike) => void,
  ): void;
}

/** ssh2.Client.connect() 入参子集，覆盖我们用到的字段。 */
export interface SshConnectOptions {
  host: string;
  port: number;
  username: string;
  /** 密码认证；与 privateKey 互斥。 */
  password?: string;
  /** PEM 格式私钥；passphrase 单独传。 */
  privateKey?: Buffer | string;
  passphrase?: string;
  readyTimeout: number;
  keepaliveInterval: number;
  /** 主机指纹校验回调；本项目要求**必须**提供，无默认值。 */
  hostVerifier: (key: Buffer | string, callback: (allow: boolean) => void) => void;
}

/** ssh2.Client.shell() 入参中我们关心的部分。 */
export interface SshShellOptions {
  rows: number;
  cols: number;
  term: string;
}

/** SshTransport 注入入口的认证凭据（仅在 connect() 调用瞬间持有；不入字段、不入 transcript）。 */
export type SshCredentials =
  | { kind: 'password'; password: string }
  | { kind: 'privateKey'; privateKey: Buffer | string; passphrase?: string };

/**
 * 主机指纹校验回调。第一次连接时被调用；返回 true 表示允许 / false 表示拒绝并断开。
 *
 * Phase 3 把决策权完全交给上层（IPC handler 弹 UI；测试直接返回 true/false）。
 * Phase 8 会引入持久化 known_hosts，那时此回调将被默认实现替换。
 */
export type SshHostVerifier = (key: Buffer | string) => boolean | Promise<boolean>;

/** ssh2.Client 工厂：测试通过此入口注入 FakeSshClient，生产由 `defaultSshClientFactory` 创建真实 Client。 */
export type SshClientFactory = () => SshClientLike;

/**
 * 默认 ssh2.Client 工厂：通过 `createRequire` 懒加载 `ssh2`，
 * 让纯单元测试无需安装该原生模块；正式构建时由 Electron 进程加载。
 */
export const defaultSshClientFactory: SshClientFactory = () => {
  const requireFn = createRequire(import.meta.url);
  const ssh = requireFn('ssh2') as { Client: new () => SshClientLike };
  return new ssh.Client();
};
