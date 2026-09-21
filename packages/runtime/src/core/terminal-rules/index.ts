/**
 * Phase 7 — terminal-rules 模块对外 barrel。
 *
 * 仅导出公共 API；具体类内部的私有字段 / KMP failure 表等都不暴露。
 */

export type {
  CompletionMarker,
  DetectorState,
  EchoStrategy,
  ICompletionDetector,
  IEchoHandler,
  SendAndWaitArgs,
  SendAndWaitDeps,
  SendAndWaitResult,
  SessionManagerLike,
  TerminalRuleSet,
} from './types.js';

export { CompletionDetector } from './completion-detector.js';
export { EchoHandler } from './echo-handler.js';
export { sendAndWait } from './send-and-wait.js';
export {
  DEFAULT_TERMINAL_RULES,
  appendLineEnding,
  mergeRules,
  parseMarkerSpec,
} from './rules.js';
