import { describe, expect, it } from 'vitest';
import { diagnoseRttLogTranscript } from '@/core/session/rtt-log-diagnostics.js';
import type { TranscriptEvent } from '@/core/transcript/types.js';

const SEGGER_RTT_BANNER =
  'SEGGER J-Link V7.92 - Real time terminal output\r\n' +
  'SEGGER J-Link V11.0, SN=123456789\r\n' +
  'Process: JLinkGDBServerCL.exe\r\n';

describe('RTT log transcript diagnostics', () => {
  it('classifies SEGGER banner-only bytes as transport connected but firmware silent', () => {
    const diagnosis = diagnoseRttLogTranscript({
      sessionId: 'sess_rtt',
      state: 'open',
      connectionType: 'rtt-log',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
      readResult: {
        events: [
          dataEvent(1, 'system', 'RTT log connected on channel 0\r\n'),
          dataEvent(2, 'device', SEGGER_RTT_BANNER),
        ],
        cursor: 2,
        truncated: false,
        oldestAvailableSequence: 1,
      },
    });

    expect(diagnosis.classification).toBe('transport_connected_firmware_silent');
    expect(diagnosis.transportConnected).toBe(true);
    expect(diagnosis.systemGuidanceSeen).toBe(true);
    expect(diagnosis.seggerBannerSeen).toBe(true);
    expect(diagnosis.firmwareBytes).toBe(0);
    expect(diagnosis.nextActions.join('\n')).toContain('do not repeat flash');
    expect(diagnosis.nextActions.join('\n')).toContain('firmware RTT output');
  });

  it('counts non-banner device bytes as firmware output after the SEGGER banner', () => {
    const diagnosis = diagnoseRttLogTranscript({
      sessionId: 'sess_rtt',
      state: 'open',
      connectionType: 'rtt-log',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
      readResult: {
        events: [
          dataEvent(1, 'system', 'RTT log connected on channel 0\r\n'),
          dataEvent(2, 'device', SEGGER_RTT_BANNER),
          dataEvent(3, 'device', '[I/main] firmware online\r\n'),
        ],
        cursor: 3,
        truncated: false,
        oldestAvailableSequence: 1,
      },
    });

    expect(diagnosis.classification).toBe('firmware_output_seen');
    expect(diagnosis.transportConnected).toBe(true);
    expect(diagnosis.seggerBannerSeen).toBe(true);
    expect(diagnosis.firmwareBytes).toBe(Buffer.byteLength('[I/main] firmware online\r\n'));
    expect(diagnosis.nextActions.join('\n')).toContain('continue reading');
  });

  it('classifies writes without later device bytes as unanswered target input', () => {
    const diagnosis = diagnoseRttLogTranscript({
      sessionId: 'sess_rtt',
      state: 'open',
      connectionType: 'rtt-log',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
      readResult: {
        events: [
          dataEvent(1, 'system', 'RTT log connected on channel 0\r\n'),
          dataEvent(2, 'device', '[I/main] old boot log\r\n'),
          dataEvent(3, 'ai', 'help\r\n'),
        ],
        cursor: 3,
        truncated: false,
        oldestAvailableSequence: 1,
      },
    });

    expect(diagnosis.classification).toBe('target_input_unanswered');
    expect(diagnosis.outboundWriteEvents).toBe(1);
    expect(diagnosis.outboundBytes).toBe(Buffer.byteLength('help\r\n'));
    expect(diagnosis.deviceBytesAfterLastWrite).toBe(0);
    expect(diagnosis.firmwareBytes).toBe(Buffer.byteLength('[I/main] old boot log\r\n'));
    expect(diagnosis.nextActions.join('\n')).toContain('Do not treat the write');
  });

  it('keeps firmware-output classification when device bytes arrive after input', () => {
    const diagnosis = diagnoseRttLogTranscript({
      sessionId: 'sess_rtt',
      state: 'open',
      connectionType: 'rtt-log',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
      readResult: {
        events: [
          dataEvent(1, 'system', 'RTT log connected on channel 0\r\n'),
          dataEvent(2, 'human', 'help\r\n'),
          dataEvent(3, 'device', 'help\r\nRT-Thread shell commands:\r\n'),
        ],
        cursor: 3,
        truncated: false,
        oldestAvailableSequence: 1,
      },
    });

    expect(diagnosis.classification).toBe('firmware_output_seen');
    expect(diagnosis.outboundWriteEvents).toBe(1);
    expect(diagnosis.deviceBytesAfterLastWrite).toBe(
      Buffer.byteLength('help\r\nRT-Thread shell commands:\r\n'),
    );
  });
});

function dataEvent(
  sequence: number,
  origin: 'system' | 'device' | 'human' | 'ai',
  text: string,
): TranscriptEvent {
  return {
    sequence,
    timestamp: 1_700_000_000_000 + sequence,
    type: 'data',
    origin,
    evidenceKind: 'raw_bytes',
    data: Buffer.from(text, 'utf8'),
  };
}
