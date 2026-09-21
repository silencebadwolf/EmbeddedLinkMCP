import { describe, expect, it } from 'vitest';
import {
  JLinkAbortedError,
  JLinkBufferTooLargeError,
  JLinkInvalidStateError,
  JLinkNotImplementedError,
  JLinkOperationError,
  NoBackendError,
  ProbeBusyError,
  ProbeNotFoundError,
} from '@linkterm/runtime/jlink/errors';
import { ERROR_CODES } from '@/shared/error-codes.js';
import { ToolError } from '@linkterm/mcp/registry';
import { translateJLinkError } from '@linkterm/mcp/surfaces/debug/error-translate';

function translated(err: unknown): ToolError {
  try {
    translateJLinkError(err);
  } catch (translatedErr) {
    expect(translatedErr).toBeInstanceOf(ToolError);
    return translatedErr as ToolError;
  }
  throw new Error('translateJLinkError unexpectedly returned');
}

describe('debug J-Link error taxonomy', () => {
  it('maps every J-Link domain error to a shared ToolError code', () => {
    const cases: Array<{ input: Error; code: string; details?: Record<string, unknown> }> = [
      { input: new NoBackendError(), code: ERROR_CODES.NO_BACKEND },
      { input: new ProbeNotFoundError('probe-1'), code: ERROR_CODES.PROBE_NOT_FOUND, details: { probeId: 'probe-1' } },
      { input: new ProbeBusyError('probe-1'), code: ERROR_CODES.PROBE_BUSY, details: { probeId: 'probe-1' } },
      {
        input: new JLinkBufferTooLargeError(17, 16),
        code: ERROR_CODES.BUFFER_TOO_LARGE,
        details: { actualBytes: 17, maxBytes: 16 },
      },
      { input: new JLinkAbortedError('aborted'), code: ERROR_CODES.ABORTED },
      {
        input: new JLinkInvalidStateError('bad state', { expected: 'halted', actual: 'running' }),
        code: ERROR_CODES.INVALID_STATE,
        details: { expected: 'halted', actual: 'running' },
      },
      {
        input: new JLinkNotImplementedError('memoryWrite'),
        code: ERROR_CODES.NOT_IMPLEMENTED,
        details: { method: 'memoryWrite' },
      },
      {
        input: new JLinkOperationError('operation failed', { operation: 'flashDownload', underlying: new Error('secret') }),
        code: ERROR_CODES.JLINK_OPERATION_FAILED,
        details: { operation: 'flashDownload' },
      },
    ];

    for (const { input, code, details } of cases) {
      const out = translated(input);
      expect(Object.values(ERROR_CODES)).toContain(code);
      expect(out.code).toBe(code);
      if (details !== undefined) {
        expect(out.details).toMatchObject(details);
      }
      expect(JSON.stringify(out.details ?? {})).not.toContain('secret');
    }
  });

});
