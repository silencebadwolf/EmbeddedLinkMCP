// Phase 7 终端规则常量、合并与工具函数；纯函数无状态。

import {
  COMPLETION_BUFFER_MAX_BYTES,
  DEFAULT_LINE_ENDING,
  TERMINAL_RULES_DEFAULT_SETTLE_MS,
  TERMINAL_RULES_DEFAULT_TIMEOUT_MS,
} from '@linkterm/contracts/constants';
import type { CompletionMarker, TerminalRuleSet } from './types.js';

/**
 * 项目级默认规则。
 *
 * 决策：completionMarkers 默认空数组 —— 不预设 prompt 形态（嵌入式设备各异）。
 * 显式提供时只用于 settle 结果标注，不作为返回前提。
 */
export const DEFAULT_TERMINAL_RULES: TerminalRuleSet = {
  lineEnding: DEFAULT_LINE_ENDING,
  completionMarkers: [],
  defaultTimeoutMs: TERMINAL_RULES_DEFAULT_TIMEOUT_MS,
  defaultSettleMs: TERMINAL_RULES_DEFAULT_SETTLE_MS,
  echoStrategy: 'auto',
  completionBufferMaxBytes: COMPLETION_BUFFER_MAX_BYTES,
};

/**
 * 浅合并规则覆盖：仅当 `override` 字段为 `undefined` 时保留 base 字段；
 * 其他情况整体替换（包括 `completionMarkers` 空数组——调用方明确禁用 marker 时是合法意图）。
 *
 * @param base 基础规则（通常是 DEFAULT_TERMINAL_RULES，或 workspace 级配置）
 * @param override 调用方显式覆盖；undefined 时直接返回 base
 * @returns 新规则对象（不复用引用，避免下游误改 base）
 */
export function mergeRules(
  base: TerminalRuleSet,
  override?: Partial<TerminalRuleSet>,
): TerminalRuleSet {
  if (!override) {
    return { ...base, completionMarkers: [...base.completionMarkers] };
  }
  return {
    lineEnding: override.lineEnding ?? base.lineEnding,
    completionMarkers:
      override.completionMarkers !== undefined
        ? [...override.completionMarkers]
        : [...base.completionMarkers],
    defaultTimeoutMs: override.defaultTimeoutMs ?? base.defaultTimeoutMs,
    defaultSettleMs: override.defaultSettleMs ?? base.defaultSettleMs,
    echoStrategy: override.echoStrategy ?? base.echoStrategy,
    completionBufferMaxBytes: override.completionBufferMaxBytes ?? base.completionBufferMaxBytes,
  };
}

/**
 * 在 payload 末尾追加 lineEnding 字节。
 *
 * @param payload 原始字节
 * @param lineEnding 行尾字符串（如 `\r\n`、`\n`）
 * @returns 新 Uint8Array；`lineEnding` 为空字符串时返回原 payload 的拷贝
 */
export function appendLineEnding(payload: Uint8Array, lineEnding: string): Uint8Array {
  if (lineEnding.length === 0) {
    return new Uint8Array(payload);
  }
  const tail = new TextEncoder().encode(lineEnding);
  const out = new Uint8Array(payload.byteLength + tail.byteLength);
  out.set(payload, 0);
  out.set(tail, payload.byteLength);
  return out;
}

/**
 * MCP schema 边界 → core 类型的转换。
 *
 * - 字符串原样返回（保留 byte 包含语义）
 * - 对象 `{ pattern, flags? }` 用 `new RegExp(pattern, flags ?? '')` 构造
 *
 * 不在此函数内捕获 SyntaxError —— RegExp 构造异常应当冒泡给 schema 调用方，
 * 让 MCP 工具层翻成 INVALID_ARGUMENT，避免吞掉拼写错误。
 *
 * @param spec MCP 入参形态（zod 校验后）
 * @returns 可被 CompletionDetector 直接消费的 CompletionMarker
 */
export function parseMarkerSpec(spec: string | { pattern: string; flags?: string }): CompletionMarker {
  if (typeof spec === 'string') return spec;
  return new RegExp(spec.pattern, spec.flags ?? '');
}
