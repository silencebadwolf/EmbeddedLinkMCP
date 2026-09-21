import type {
  IDisposable,
  PtyExitInfo,
  PtyFactory,
  PtyLike,
  PtySpawnOptions,
} from '@linkterm/runtime/transports/local-shell/pty-like';

export interface FakePtyBehavior {
  /** spawn() 时同步抛错，模拟"shell 不存在"等不可恢复故障。 */
  failOnSpawn?: Error;
  /** kill() 时抛错；transport 会吞掉，但测试可借此验证容错路径。 */
  failOnKill?: Error;
}

let nextPid = 10_000;

/**
 * `PtyLike` 的进程内 mock：
 *
 * - 不真实 spawn 子进程；onData/onExit 通过 push* / triggerExit 主动驱动。
 * - 所有 write 调用按字符串原样追加到 `writes`。
 * - 所有 resize(cols, rows) 调用追加到 `resizes`。
 */
export class FakePty implements PtyLike {
  readonly pid: number;
  readonly options: PtySpawnOptions;
  readonly writes: string[] = [];
  readonly resizes: { cols: number; rows: number }[] = [];
  killCalls = 0;
  killSignals: (string | undefined)[] = [];
  /** 'data' 监听 —— 可能为空（onExit 之后 dispose 会清掉）。 */
  #dataListeners = new Set<(data: string) => void>();
  #exitListeners = new Set<(info: PtyExitInfo) => void>();

  constructor(options: PtySpawnOptions, public readonly behavior: FakePtyBehavior = {}) {
    this.options = options;
    nextPid += 1;
    this.pid = nextPid;
  }

  onData(listener: (data: string) => void): IDisposable {
    this.#dataListeners.add(listener);
    return {
      dispose: () => this.#dataListeners.delete(listener),
    };
  }

  onExit(listener: (info: PtyExitInfo) => void): IDisposable {
    this.#exitListeners.add(listener);
    return {
      dispose: () => this.#exitListeners.delete(listener),
    };
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(signal?: string): void {
    this.killCalls += 1;
    this.killSignals.push(signal);
    if (this.behavior.failOnKill) throw this.behavior.failOnKill;
  }

  /** 模拟子进程 stdout 输出（UTF-8 字符串，对齐 node-pty 行为）。 */
  pushIncoming(text: string): void {
    for (const fn of this.#dataListeners) fn(text);
  }

  /** 模拟子进程退出。exitCode/signal 由测试控制。 */
  triggerExit(exitCode: number, signal?: number): void {
    const info: PtyExitInfo = signal !== undefined ? { exitCode, signal } : { exitCode };
    for (const fn of this.#exitListeners) fn(info);
  }
}

/**
 * 工厂助手：返回固定 FakePty 实例的工厂；
 * 同时把生成的实例放进 `created` 数组供测试断言。
 */
export function createMockPtyFactory(behavior: FakePtyBehavior = {}): {
  factory: PtyFactory;
  created: FakePty[];
} {
  const created: FakePty[] = [];
  const factory: PtyFactory = (options) => {
    if (behavior.failOnSpawn) throw behavior.failOnSpawn;
    const pty = new FakePty(options, behavior);
    created.push(pty);
    return pty;
  };
  return { factory, created };
}
