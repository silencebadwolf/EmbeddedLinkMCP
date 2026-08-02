import { JLinkOperationError } from './errors.js';
import type { SeggerProcessResult } from './segger-command-runner.js';
import type { VcomChangeResult, VcomInspection } from './vcom-types.js';

const UNSUPPORTED_PATTERN =
  /unknown\s+command|command\s+not\s+found|unsupported\s+command|syntax\s+error.*vcom/iu;
const FAILURE_PATTERN = /cannot|failed|error/iu;
const FIRMWARE_UPDATE_PATTERN =
  /(?:(?:firmware|fw).{0,80}(?:update|updated|updating)|(?:update|updated|updating).{0,80}(?:firmware|fw))/iu;

/** 将 Commander 的 VCOM 查询输出收敛为不含探针序列号的结构化状态。 */
export function parseSeggerVcomInspection(result: SeggerProcessResult): VcomInspection {
  const output = combinedOutput(result);
  if (UNSUPPORTED_PATTERN.test(output)) {
    return {
      supported: false,
      state: 'unknown',
      requiresPowerCycle: true,
      firmwareUpdateObserved: FIRMWARE_UPDATE_PATTERN.test(output),
    };
  }
  assertProcessCompleted(result, output, 'inspect');
  return {
    supported: /\bvcom\b/iu.test(output),
    state: parseState(output),
    requiresPowerCycle: true,
    firmwareUpdateObserved: FIRMWARE_UPDATE_PATTERN.test(output),
  };
}

/** 验证 Commander 明确认可 VCOM enable/disable；模糊输出按失败关闭。 */
export function parseSeggerVcomChange(
  result: SeggerProcessResult,
  enabled: boolean,
): VcomChangeResult {
  const output = combinedOutput(result);
  assertProcessCompleted(result, output, enabled ? 'enable' : 'disable');
  const requestedState = enabled ? 'enabled' : 'disabled';
  const accepted =
    new RegExp(`\\bvcom\\b.{0,160}\\b${requestedState}\\b`, 'isu').test(output) ||
    new RegExp(`\\b${requestedState}\\b.{0,160}\\bvcom\\b`, 'isu').test(output);
  if (!accepted || UNSUPPORTED_PATTERN.test(output) || FAILURE_PATTERN.test(output)) {
    throw new JLinkOperationError(`J-Link Commander did not confirm VCOM ${requestedState}`, {
      operation: 'jlinkVcom',
    });
  }
  return {
    commandAccepted: true,
    enabled,
    requiresPowerCycle: true,
    firmwareUpdateObserved: FIRMWARE_UPDATE_PATTERN.test(output),
  };
}

function parseState(output: string): VcomInspection['state'] {
  if (/\bvcom\b.{0,120}\bdisabled\b/isu.test(output)) return 'disabled';
  if (/\bvcom\b.{0,120}\benabled\b/isu.test(output)) return 'enabled';
  return 'unknown';
}

function combinedOutput(result: SeggerProcessResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

function assertProcessCompleted(
  result: SeggerProcessResult,
  output: string,
  operation: string,
): void {
  if (result.exitCode === 0 && result.signal === null) return;
  throw new JLinkOperationError(`J-Link VCOM ${operation} failed`, {
    operation: 'jlinkVcom',
    underlying: {
      exitCode: result.exitCode,
      signal: result.signal,
      outputObserved: output.length > 0,
    },
  });
}
