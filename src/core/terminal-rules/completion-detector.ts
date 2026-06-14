// Phase 7 跨 chunk 完成标记检测器（有状态 FSM）：字符串 marker 走 KMP，RegExp 走累计 buffer 上 test。

import type { CompletionMarker, DetectorState, ICompletionDetector } from './types.js';

/** 单个 marker 的内部状态。 */
interface MarkerState {
  /** marker 字面量（字符串只读取一次 encoded 副本，RegExp 引用本体）。 */
  readonly marker: CompletionMarker;
  /** 仅字符串 marker 使用：已编码 UTF-8 字节副本。 */
  readonly stringBytes?: Uint8Array;
  /** 仅 RegExp marker 使用：去掉 g/y 标志后预编译的非粘性副本，避免 feed 热路径反复 new RegExp。 */
  readonly normalizedRe?: RegExp;
  /** 仅字符串 marker 使用：当前已匹配前缀长度（0..stringBytes.length-1）。 */
  partialIndex: number;
}

/** 字符串 marker 的 KMP 部分匹配回退值（一次预计算）。 */
function buildKmpFailure(bytes: Uint8Array): Uint16Array {
  // 经典 KMP failure function；适合 marker 长度通常 < 32 的场景。
  const fail = new Uint16Array(bytes.length);
  let k = 0;
  for (let i = 1; i < bytes.length; i++) {
    while (k > 0 && bytes[k] !== bytes[i]) {
      k = fail[k - 1] ?? 0;
    }
    if (bytes[k] === bytes[i]) k += 1;
    fail[i] = k;
  }
  return fail;
}

/**
 * 跨 chunk 完成标记检测器。
 *
 * 通过 {@link feed} 持续喂入字节，命中后 {@link DetectorState.matched} 永久为 true 直到 {@link reset}。
 */
export class CompletionDetector implements ICompletionDetector {
  readonly #markerStates: MarkerState[];
  /** 每个字符串 marker 的 KMP failure 表，与 #markerStates 同下标对应。 */
  readonly #kmpFails: (Uint16Array | undefined)[];
  /** 累计 buffer（仅 RegExp marker 使用；字符串 marker 不需要 retain 已通过的字节）。 */
  #buffer: Uint8Array = new Uint8Array(0);
  #totalBytes = 0;
  #matched = false;
  #matchedMarkerIndex = -1;
  #matchStartByte = -1;
  #matchEndByte = -1;
  readonly #bufferMaxBytes: number;
  /**
   * RegExp marker 中 source 字节数最大值（决定 RegExp 命中后丢头保尾的尾窗大小）。
   * 字符串-only 模式下取 0；上限计算按 max(longestRegexSourceBytes*4, 4096) 与 bufferMaxBytes 取小值。
   */
  readonly #longestRegexSourceBytes: number;
  /** 是否含 RegExp marker —— 仅决定是否要在 buffer 上跑 regex.test。buffer 本身始终维护以支持 received 抓取。 */
  readonly #hasRegexMarker: boolean;

  constructor(markers: readonly CompletionMarker[], bufferMaxBytes: number) {
    this.#bufferMaxBytes = bufferMaxBytes;
    let hasRegex = false;
    let longestRegexSource = 0;
    this.#markerStates = markers.map((marker) => {
      if (typeof marker === 'string') {
        const encoded = new TextEncoder().encode(marker);
        return { marker, stringBytes: encoded, partialIndex: 0 };
      }
      hasRegex = true;
      const sourceBytes = new TextEncoder().encode(marker.source).byteLength;
      if (sourceBytes > longestRegexSource) longestRegexSource = sourceBytes;
      // 去掉 g/y 标志，避免共享 lastIndex 状态污染 feed 热路径
      const normalizedRe = new RegExp(marker.source, marker.flags.replace(/[gy]/g, ''));
      return { marker, normalizedRe, partialIndex: 0 };
    });
    this.#kmpFails = this.#markerStates.map((s) =>
      s.stringBytes && s.stringBytes.length > 1 ? buildKmpFailure(s.stringBytes) : undefined,
    );
    this.#hasRegexMarker = hasRegex;
    this.#longestRegexSourceBytes = longestRegexSource;
  }

  feed(bytes: Uint8Array): DetectorState {
    if (bytes.byteLength === 0) {
      return this.#snapshot();
    }
    if (this.#matched) {
      // 命中后只更新累计字节，不再尝试匹配；buffer 仍维护以反映新数据。
      this.#totalBytes += bytes.byteLength;
      this.#appendToBuffer(bytes);
      return this.#snapshot();
    }

    // 1. 累计 buffer（始终维护，用于 received 抓取与 RegExp 匹配）
    this.#appendToBuffer(bytes);

    // 2. 逐字节推进字符串 marker（KMP），每个字节都检查所有字符串 marker；
    //    同字节同时命中多个 marker 时按 #markerStates 顺序优先。
    const baseTotal = this.#totalBytes;
    for (let bi = 0; bi < bytes.byteLength; bi++) {
      const byte = bytes[bi]!;
      for (let mi = 0; mi < this.#markerStates.length; mi++) {
        const state = this.#markerStates[mi]!;
        if (!state.stringBytes) continue; // RegExp marker 在第 3 步处理
        const target = state.stringBytes;
        let k = state.partialIndex;
        while (k > 0 && target[k] !== byte) {
          k = this.#kmpFails[mi]?.[k - 1] ?? 0;
        }
        if (target[k] === byte) k += 1;
        state.partialIndex = k;
        if (k === target.length) {
          const matchEnd = baseTotal + bi + 1;
          const matchStart = matchEnd - target.length;
          this.#flagMatch(mi, matchStart, matchEnd);
          // 整个 chunk 都视作已喂入；buffer 已在第 1 步整体追加
          this.#totalBytes = baseTotal + bytes.byteLength;
          return this.#snapshot();
        }
      }
    }
    this.#totalBytes = baseTotal + bytes.byteLength;

    // 3. RegExp marker 在累计 buffer 上 test —— 仅在还有未命中的 RegExp marker 时尝试。
    if (this.#hasRegexMarker) {
      // 把 buffer 解码为 UTF-8 字符串（buffer 截断时可能导致首尾不完整字符；regex.test 对此宽容，
      // 因为它只关心是否 *存在* 命中子串，不完整字符不会构造出合法 marker 命中）
      const text = new TextDecoder('utf-8', { fatal: false }).decode(this.#buffer);
      for (let mi = 0; mi < this.#markerStates.length; mi++) {
        const state = this.#markerStates[mi]!;
        if (state.stringBytes) continue;
        if (!state.normalizedRe) continue;
        if (state.normalizedRe.test(text)) {
          // 命中位置粒度无法精确到字节（buffer 起点未必是 0）；
          // 用"匹配区间相对当前累计 buffer 末尾估算"
          const matchEnd = this.#totalBytes;
          const matchStart = Math.max(0, matchEnd - text.length); // 保守：取整个 buffer
          this.#flagMatch(mi, matchStart, matchEnd);
          return this.#snapshot();
        }
      }
    }

    return this.#snapshot();
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
    this.#totalBytes = 0;
    this.#matched = false;
    this.#matchedMarkerIndex = -1;
    this.#matchStartByte = -1;
    this.#matchEndByte = -1;
    for (const s of this.#markerStates) s.partialIndex = 0;
  }

  snapshotBuffer(): Uint8Array {
    return new Uint8Array(this.#buffer);
  }

  /** 内部：把 chunk 追加进累计 buffer，超过 bufferMaxBytes 时丢头保尾。 */
  #appendToBuffer(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    const merged = new Uint8Array(this.#buffer.byteLength + bytes.byteLength);
    merged.set(this.#buffer, 0);
    merged.set(bytes, this.#buffer.byteLength);
    if (merged.byteLength <= this.#bufferMaxBytes) {
      this.#buffer = merged;
      return;
    }
    // 丢头保尾。纯 string-marker 模式下不需要保留 buffer 给 regex.test，但仍维持完整上限以便 received 抓取；
    // 含 RegExp marker 时取 max(longestRegexSourceBytes * 4, 4096) 作为命中窗口，并 clamp 到 bufferMaxBytes。
    const tailWindow =
      this.#longestRegexSourceBytes === 0
        ? this.#bufferMaxBytes
        : Math.min(this.#bufferMaxBytes, Math.max(this.#longestRegexSourceBytes * 4, 4096));
    this.#buffer = merged.slice(merged.byteLength - tailWindow);
  }

  #flagMatch(markerIndex: number, startByte: number, endByte: number): void {
    this.#matched = true;
    this.#matchedMarkerIndex = markerIndex;
    this.#matchStartByte = startByte;
    this.#matchEndByte = endByte;
  }

  #snapshot(): DetectorState {
    return {
      matched: this.#matched,
      matchedMarkerIndex: this.#matchedMarkerIndex,
      matchStartByte: this.#matchStartByte,
      matchEndByte: this.#matchEndByte,
      totalBytes: this.#totalBytes,
    };
  }
}
