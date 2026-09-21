import { describe, expect, it, vi } from 'vitest';
import { serializeTranscriptEvent } from '@linkterm/contracts/transcript-ipc-types';
import { ActivityEventViewSchema } from '@linkterm/contracts/activity-contract';
import { normalizeJLinkTargetName } from '@linkterm/contracts/jlink-target-name';
import { serializeTranscriptEvent as legacySerialize } from '../../../src/shared/transcript-ipc-types.js';
import { ActivityEventViewSchema as legacyActivitySchema } from '../../../src/shared/activity-contract.js';
import { normalizeJLinkTargetName as legacyNormalize } from '../../../src/shared/jlink-target-name.js';

describe('contracts compatibility boundary', () => {
  it('keeps desktop and package consumers on the same implementations and schemas', () => {
    expect(legacySerialize).toBe(serializeTranscriptEvent);
    expect(legacyActivitySchema).toBe(ActivityEventViewSchema);
    expect(legacyNormalize).toBe(normalizeJLinkTargetName);
  });

  it('preserves arbitrary terminal bytes when the browser has no Node Buffer', () => {
    const event = {
      type: 'data' as const,
      origin: 'device' as const,
      sequence: 42,
      timestamp: 123,
      data: new Uint8Array([0, 128, 255, 13, 10]),
    };
    const nodeResult = serializeTranscriptEvent(event);
    let browserResult;
    try {
      vi.stubGlobal('Buffer', undefined);
      browserResult = serializeTranscriptEvent(event);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(browserResult).toEqual(nodeResult);
    expect(browserResult?.dataBase64).toBe('AID/DQo=');
    expect(browserResult).not.toHaveProperty('data');
  });
});
