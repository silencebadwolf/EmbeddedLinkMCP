// Phase 7 回显处理器：按字节剥离 AI 写入的回显，避免 detector 把回显当成完成证据。

import type { EchoStrategy, IEchoHandler } from './types.js';

/** Echo 队列硬上限：防止 echo-off 设备下无限堆积；超出时整列 flush 视为 echo-off。 */
const MAX_QUEUE_LEN = 4096;

/**
 * 按字节剥离回显的 EchoHandler 实现。
 *
 * @example
 * const echo = new EchoHandler('auto');
 * echo.observeWrite(new TextEncoder().encode('ls\r\n'));
 * const filtered = echo.filter(new TextEncoder().encode('ls\r\nfile1\n'));
 * // filtered === new TextEncoder().encode('file1\n')
 */
export class EchoHandler implements IEchoHandler {
  readonly #strategy: EchoStrategy;
  /** FIFO 队列；队首是当前正在剥离的写入。 */
  readonly #expected: Uint8Array[] = [];
  /** 当前队首已消费字节数。 */
  #headIndex = 0;

  constructor(strategy: EchoStrategy) {
    this.#strategy = strategy;
  }

  observeWrite(bytes: Uint8Array): void {
    if (this.#strategy === 'keep') return; // keep 策略不维护队列
    if (bytes.byteLength === 0) return;
    this.#expected.push(new Uint8Array(bytes));
    if (this.#expected.length > MAX_QUEUE_LEN) {
      // echo-off 设备下 expected 永远消费不完；整列 flush 退化为透传
      this.#expected.length = 0;
      this.#headIndex = 0;
    }
  }

  filter(deviceChunk: Uint8Array): Uint8Array {
    if (this.#strategy === 'keep') return deviceChunk;
    if (deviceChunk.byteLength === 0) return deviceChunk;
    if (this.#expected.length === 0) return deviceChunk;

    let chunkIdx = 0;
    while (chunkIdx < deviceChunk.byteLength && this.#expected.length > 0) {
      const head = this.#expected[0]!;
      const expectedByte = head[this.#headIndex];
      const actualByte = deviceChunk[chunkIdx];
      if (expectedByte === actualByte) {
        this.#headIndex += 1;
        chunkIdx += 1;
        if (this.#headIndex >= head.byteLength) {
          // 当前 expected 完全匹配，shift 进入下一段
          this.#expected.shift();
          this.#headIndex = 0;
        }
      } else {
        // 首个不匹配 —— 保守清空所有 expected，剩余 chunk 全部透传
        this.#expected.length = 0;
        this.#headIndex = 0;
        break;
      }
    }
    if (chunkIdx === 0) return deviceChunk;
    if (chunkIdx === deviceChunk.byteLength) return new Uint8Array(0);
    return deviceChunk.slice(chunkIdx);
  }

  reset(): void {
    this.#expected.length = 0;
    this.#headIndex = 0;
  }
}
