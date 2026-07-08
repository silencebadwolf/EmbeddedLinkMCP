import type { ConnectionType, SessionId, SessionState } from '../../shared/types.js';
import type { ReadResult } from '../transcript/types.js';

export type RttLogTranscriptClassification =
  | 'firmware_output_seen'
  | 'target_input_unanswered'
  | 'transport_connected_firmware_silent'
  | 'rtt_session_error'
  | 'no_transport_evidence';

export interface RttLogTranscriptDiagnosisInput {
  sessionId: SessionId;
  state: SessionState;
  connectionType: ConnectionType;
  rttLog?: {
    probeId: string;
    channelIndex: number;
  };
  readResult: ReadResult;
}

export interface RttDataChunkDiagnostic {
  seggerBannerSeen: boolean;
  firmwareBytes: number;
  bannerOnly: boolean;
}

export interface RttLogTranscriptDiagnosis {
  sessionId: SessionId;
  state: SessionState;
  connectionType: ConnectionType;
  probeId?: string;
  channelIndex?: number;
  cursor: number;
  truncated: boolean;
  eventCount: number;
  deviceDataEvents: number;
  outboundWriteEvents: number;
  outboundBytes: number;
  deviceBytesAfterLastWrite: number;
  errorEvents: number;
  systemGuidanceSeen: boolean;
  seggerBannerSeen: boolean;
  transportConnected: boolean;
  firmwareBytes: number;
  classification: RttLogTranscriptClassification;
  summary: string;
  nextActions: string[];
}

const SEGGER_BANNER_PATTERNS = [
  /SEGGER J-Link/i,
  /Real time terminal output/i,
  /JLinkGDBServer(?:CL)?(?:\.exe)?/i,
  /^Process:\s*JLinkGDBServer/i,
] as const;

const SYSTEM_GUIDANCE_PATTERNS = [
  /RTT log connected/i,
  /waiting for target output/i,
  /SEGGER RTT transport banner/i,
] as const;

export function diagnoseRttLogTranscript(
  input: RttLogTranscriptDiagnosisInput,
): RttLogTranscriptDiagnosis {
  let deviceDataEvents = 0;
  let outboundWriteEvents = 0;
  let outboundBytes = 0;
  let deviceBytesAfterLastWrite = 0;
  let lastOutboundSequence = 0;
  let errorEvents = 0;
  let firmwareBytes = 0;
  let seggerBannerSeen = false;
  let systemGuidanceSeen = false;

  for (const event of input.readResult.events) {
    if (event.type === 'data' && (event.origin === 'human' || event.origin === 'ai')) {
      outboundWriteEvents += 1;
      outboundBytes += event.data?.byteLength ?? 0;
      lastOutboundSequence = Math.max(lastOutboundSequence, event.sequence);
    }
  }

  for (const event of input.readResult.events) {
    if (event.type === 'error') {
      errorEvents += 1;
      continue;
    }
    if (event.type !== 'data') continue;
    if (event.origin === 'human' || event.origin === 'ai') continue;
    if (event.origin === 'system') {
      const text = Buffer.from(event.data ?? []).toString('utf8');
      if (SYSTEM_GUIDANCE_PATTERNS.some((pattern) => pattern.test(text))) {
        systemGuidanceSeen = true;
      }
      continue;
    }
    if (event.origin !== 'device') continue;
    deviceDataEvents += 1;
    if (event.sequence > lastOutboundSequence) {
      deviceBytesAfterLastWrite += event.data?.byteLength ?? 0;
    }
    const chunk = analyzeRttDataChunk(event.data ?? Buffer.alloc(0));
    seggerBannerSeen ||= chunk.seggerBannerSeen;
    firmwareBytes += chunk.firmwareBytes;
  }

  const transportConnected =
    input.state === 'open' || systemGuidanceSeen || seggerBannerSeen || firmwareBytes > 0;
  const classification = classify({
    state: input.state,
    errorEvents,
    firmwareBytes,
    outboundWriteEvents,
    deviceBytesAfterLastWrite,
    transportConnected,
  });

  return {
    sessionId: input.sessionId,
    state: input.state,
    connectionType: input.connectionType,
    ...(input.rttLog?.probeId ? { probeId: input.rttLog.probeId } : {}),
    ...(input.rttLog ? { channelIndex: input.rttLog.channelIndex } : {}),
    cursor: input.readResult.cursor,
    truncated: input.readResult.truncated,
    eventCount: input.readResult.events.length,
    deviceDataEvents,
    outboundWriteEvents,
    outboundBytes,
    deviceBytesAfterLastWrite,
    errorEvents,
    systemGuidanceSeen,
    seggerBannerSeen,
    transportConnected,
    firmwareBytes,
    classification,
    summary: summaryFor(classification),
    nextActions: nextActionsFor(classification),
  };
}

export function analyzeRttDataChunk(data: Uint8Array): RttDataChunkDiagnostic {
  if (data.byteLength === 0) {
    return { seggerBannerSeen: false, firmwareBytes: 0, bannerOnly: false };
  }

  const text = Buffer.from(data).toString('utf8');
  const seggerBannerSeen = SEGGER_BANNER_PATTERNS.some((pattern) => pattern.test(text));
  if (!seggerBannerSeen) {
    return { seggerBannerSeen: false, firmwareBytes: data.byteLength, bannerOnly: false };
  }

  const remainingText = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !SEGGER_BANNER_PATTERNS.some((pattern) => pattern.test(line)))
    .join('\n');
  const firmwareBytes = Buffer.byteLength(remainingText, 'utf8');
  return {
    seggerBannerSeen: true,
    firmwareBytes,
    bannerOnly: firmwareBytes === 0,
  };
}

function classify(input: {
  state: SessionState;
  errorEvents: number;
  firmwareBytes: number;
  outboundWriteEvents: number;
  deviceBytesAfterLastWrite: number;
  transportConnected: boolean;
}): RttLogTranscriptClassification {
  if (input.state === 'errored' || input.errorEvents > 0) return 'rtt_session_error';
  if (input.outboundWriteEvents > 0 && input.deviceBytesAfterLastWrite === 0) {
    return 'target_input_unanswered';
  }
  if (input.firmwareBytes > 0) return 'firmware_output_seen';
  if (input.transportConnected) return 'transport_connected_firmware_silent';
  return 'no_transport_evidence';
}

function summaryFor(classification: RttLogTranscriptClassification): string {
  switch (classification) {
    case 'firmware_output_seen':
      return 'Firmware-origin RTT output has been seen in this session.';
    case 'target_input_unanswered':
      return 'RTT terminal input was written, but no target/device output was observed afterwards.';
    case 'transport_connected_firmware_silent':
      return 'RTT transport is connected, but no firmware-origin RTT output has been seen yet.';
    case 'rtt_session_error':
      return 'The RTT log session recorded an error; inspect the transcript error event.';
    case 'no_transport_evidence':
      return 'No RTT transport or firmware-output evidence is present in the transcript yet.';
  }
}

function nextActionsFor(classification: RttLogTranscriptClassification): string[] {
  switch (classification) {
    case 'firmware_output_seen':
      return [
        'Firmware RTT output is present; continue reading the App-visible session transcript from the returned cursor.',
      ];
    case 'target_input_unanswered':
      return [
        'Do not treat the write as a successful board interaction until device-origin output appears.',
        'Verify that the SEGGER RTT down channel is actually consumed by the target firmware, not just accepted by the host RTT telnet socket.',
        'If the target firmware does not echo shell input, use an explicit command/marker or firmware-side RTT down-buffer diagnostic to prove input consumption.',
      ];
    case 'transport_connected_firmware_silent':
      return [
        'Keep the existing RTT log session open; do not repeat flash solely because RTT is silent.',
        'Check firmware RTT output initialization, selected up-channel, log backend routing, and _SEGGER_RTT/control block configuration.',
        'If target state is still in question, collect fresh read-only debug evidence instead of using flash or reset as a log-silence probe.',
      ];
    case 'rtt_session_error':
      return [
        'Read the RTT session transcript error event and resolve the RTT transport failure before diagnosing firmware output.',
      ];
    case 'no_transport_evidence':
      return [
        'Open or repair the RTT log session first; there is not enough transcript evidence to diagnose firmware output.',
      ];
  }
}
