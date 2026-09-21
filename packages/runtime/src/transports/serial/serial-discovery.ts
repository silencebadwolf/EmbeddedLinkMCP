import { EventEmitter } from 'node:events';
import { SERIAL_DISCOVERY_POLL_INTERVAL_MS } from '@linkterm/contracts/constants';
import type { SerialPortInfo } from '@linkterm/contracts/types';

/**
 * SerialPort.list() 返回值的解构形态（serialport 类型为 PortInfo[]）。
 * 我们只关心 SerialPortInfo 包含的字段，多余的 native-only 字段会被裁剪掉。
 */
type RawListFn = () => Promise<readonly SerialPortInfo[]>;

export interface SerialDiscoveryOptions {
  /**
   * 注入用 list 函数；省略时调用真实 `SerialPort.list()`。
   * 测试通过此入口模拟轮询返回不同结果。
   */
  listFn?: RawListFn;
  /** 轮询间隔（ms）；省略时使用 `SERIAL_DISCOVERY_POLL_INTERVAL_MS`。 */
  pollIntervalMs?: number;
}

/**
 * 串口发现器：列出当前可用串口 + 在订阅期间轮询变更。
 *
 * 设计要点（按 C2 推荐）：
 * - `serialport` 不提供 hot-plug 通知，需轮询 `SerialPort.list()`。
 * - 轮询是 **按订阅引用计数** 启停的：第一个 'change' 监听器加入即启动定时器，
 *   最后一个移除时停止 —— 避免无人订阅时常驻 CPU/IO。
 * - 比较使用按 path 排序后的 JSON 字符串，差异时 emit 'change'。
 * - list() 失败 emit 'error'（不抛），不停止轮询；瞬时错误（如权限抖动）不应让 UI 永远收不到通知。
 */
export class SerialDiscovery extends EventEmitter {
  readonly #listFn: RawListFn;
  readonly #pollIntervalMs: number;
  #timer: NodeJS.Timeout | null = null;
  #lastSnapshot: string | null = null;

  constructor(options: SerialDiscoveryOptions = {}) {
    super();
    this.#listFn = options.listFn ?? defaultListFn;
    this.#pollIntervalMs = options.pollIntervalMs ?? SERIAL_DISCOVERY_POLL_INTERVAL_MS;
    this.on('newListener', this.#onListenerAdded);
    this.on('removeListener', this.#onListenerRemoved);
    // 默认 'error' 监听器：保护轮询路径不因无 listener 抛 uncaught。
    // 调用方仍可在外部 .on('error', ...) 接管真实诊断；该 noop 监听器与之共存。
    this.on('error', noopErrorListener);
  }

  /**
   * 列举当前可用串口。直接代理底层实现（可注入）。
   * 不会启动轮询。
   */
  async listPorts(): Promise<readonly SerialPortInfo[]> {
    const ports = await this.#listFn();
    return ports.map(normalizePortInfo);
  }

  /**
   * 显式停止轮询并清理订阅状态。
   * 用于测试 teardown / 应用退出；正常情况下引用计数已经能自动停。
   */
  dispose(): void {
    this.#stopPolling();
    this.removeAllListeners();
  }

  #onListenerAdded = (event: string | symbol): void => {
    if (event !== 'change') return;
    if (this.#timer !== null) return; // 已有定时器
    this.#startPolling();
  };

  #onListenerRemoved = (event: string | symbol): void => {
    if (event !== 'change') return;
    if (this.listenerCount('change') > 0) return;
    this.#stopPolling();
  };

  #startPolling(): void {
    // 立即跑一次，给新订阅者一个初始快照（对比 lastSnapshot 决定是否 emit）
    void this.#poll();
    this.#timer = setInterval(() => {
      void this.#poll();
    }, this.#pollIntervalMs);
    // unref 让 Node 进程可以在仅剩此定时器时退出（测试场景特别有用）
    this.#timer.unref?.();
  }

  #stopPolling(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#lastSnapshot = null;
  }

  async #poll(): Promise<void> {
    let ports: readonly SerialPortInfo[];
    try {
      ports = (await this.#listFn()).map(normalizePortInfo);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const snapshot = serializeSnapshot(ports);
    if (snapshot === this.#lastSnapshot) return;
    this.#lastSnapshot = snapshot;
    this.emit('change', ports);
  }
}

/**
 * 真实的 SerialPort.list() 包装。
 * 单独抽出便于在 SerialDiscovery 外部也复用，并把 PortInfo → SerialPortInfo 的
 * 字段裁剪集中在 SerialDiscovery 内的 normalizePortInfo 一处完成。
 */
const defaultListFn: RawListFn = async () => {
  throw new Error('The runtime host must supply a serial discovery function');
};

/** EventEmitter 默认 'error' 守卫：避免无外部监听者时崩进程。共享同一函数引用便于查询移除。 */
const noopErrorListener = (): void => {
  /* swallow; external listeners still receive the event */
};

/**
 * 把 PortInfo 裁剪为 SerialPortInfo —— 只保留跨进程安全可序列化的字段。
 */
function normalizePortInfo(p: SerialPortInfo): SerialPortInfo {
  return {
    path: p.path,
    ...(p.friendlyName !== undefined ? { friendlyName: p.friendlyName } : {}),
    ...(p.manufacturer !== undefined ? { manufacturer: p.manufacturer } : {}),
    ...(p.serialNumber !== undefined ? { serialNumber: p.serialNumber } : {}),
    ...(p.pnpId !== undefined ? { pnpId: p.pnpId } : {}),
    ...(p.vendorId !== undefined ? { vendorId: p.vendorId } : {}),
    ...(p.productId !== undefined ? { productId: p.productId } : {}),
    ...(p.locationId !== undefined ? { locationId: p.locationId } : {}),
  };
}

/**
 * 生成与顺序无关的快照串：按 path 排序后 JSON 序列化。
 */
function serializeSnapshot(ports: readonly SerialPortInfo[]): string {
  const sorted = [...ports].sort((a, b) => a.path.localeCompare(b.path));
  return JSON.stringify(sorted);
}
