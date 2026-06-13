import { createRequire } from 'node:module';

/**
 * 与 `node-pty` IDisposable 等价的最小契约：
 * onData / onExit 注册时返回该对象，调用 dispose() 即可解订阅。
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * 子进程退出信息。
 *
 * - exitCode: 进程返回码（POSIX 0..255；Windows 上可能为更大整数）
 * - signal:   被信号杀掉时的信号号；正常退出为 undefined
 */
export interface PtyExitInfo {
  exitCode: number;
  signal?: number;
}

/**
 * `LocalShellTransport` 实际依赖的最小 PTY 接口面。
 *
 * 仅列出真实使用到的方法/属性，避免把 `node-pty` 整个 API 渗透进 transport。
 * 测试通过 `tests/fixtures/mock-pty.ts` 实现该接口注入。
 */
export interface PtyLike {
  readonly pid: number;
  /** 注册 stdout/stderr 合流的 UTF-8 字符串数据回调。 */
  onData(listener: (data: string) => void): IDisposable;
  /** 注册子进程退出回调（exitCode / signal 经此抛出，由 transport 翻译成 'exit' 事件）。 */
  onExit(listener: (info: PtyExitInfo) => void): IDisposable;
  /** 写入 stdin。node-pty 在 macOS/Linux 接收 UTF-8 字符串。 */
  write(data: string): void;
  /** 调整 PTY 窗口尺寸。 */
  resize(cols: number, rows: number): void;
  /** 主动结束子进程；signal 默认 SIGHUP（POSIX）/ 直接终止（Windows）。 */
  kill(signal?: string): void;
}

/**
 * 打开真实 PTY 时需要的展平参数 —— `LocalShellTransport.#buildSpawnOptions`
 * 在调用工厂前会从 `LocalShellSessionConfig` 推导默认值并补齐。
 */
export interface PtySpawnOptions {
  file: string;
  args: readonly string[];
  cwd?: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  /** TERM 类型，对应 node-pty 的 `name` 字段。 */
  name: string;
}

/**
 * PTY 工厂：测试通过此入口注入 FakePty，生产由 `defaultPtyFactory` 构造真实 `node-pty` 实例。
 */
export type PtyFactory = (options: PtySpawnOptions) => PtyLike;

/**
 * 默认 PTY 工厂：通过 `createRequire` 懒加载 `node-pty`，
 * 让纯单元测试无需安装该原生模块；正式构建时由 Electron 进程加载 prebuilt 二进制。
 */
export const defaultPtyFactory: PtyFactory = (options) => {
  const requireFn = createRequire(import.meta.url);
  const pty = requireFn('node-pty') as {
    spawn: (
      file: string,
      args: readonly string[] | string,
      opts: {
        name: string;
        cols: number;
        rows: number;
        cwd?: string;
        env?: Record<string, string>;
      },
    ) => PtyLike;
  };
  return pty.spawn(options.file, options.args, {
    name: options.name,
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
  });
};
