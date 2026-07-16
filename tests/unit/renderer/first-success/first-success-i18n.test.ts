import { describe, expect, it } from 'vitest';
import { en } from '@/renderer/i18n/en.js';
import { zh } from '@/renderer/i18n/zh.js';

const REQUIRED_FIRST_SUCCESS_TRANSLATION_KEYS = [
  'firstSuccess.kicker',
  'firstSuccess.title',
  'firstSuccess.description',
  'firstSuccess.plan.title',
  'firstSuccess.plan.port',
  'firstSuccess.plan.baudRate',
  'firstSuccess.plan.dataBits',
  'firstSuccess.plan.stopBits',
  'firstSuccess.plan.parity',
  'firstSuccess.plan.source',
  'firstSuccess.sideEffects.title',
  'firstSuccess.sideEffects.reservesPort',
  'firstSuccess.sideEffects.noPayload',
  'firstSuccess.sideEffects.controlLinesDefault',
  'firstSuccess.sideEffects.controlLinesUnknown',
  'firstSuccess.sideEffects.mayReset',
  'firstSuccess.error.candidateChanged',
  'firstSuccess.status.reviewingPlan',
  'firstSuccess.status.connecting',
  'firstSuccess.status.waitingForOutput',
  'firstSuccess.status.dataReceived',
  'firstSuccess.status.displayUnavailable',
  'firstSuccess.status.silent',
  'firstSuccess.status.errored',
  'firstSuccess.status.disconnected',
  'firstSuccess.status.cancelled',
  'firstSuccess.status.completed',
  'firstSuccess.action.confirmConnect',
  'firstSuccess.action.cancel',
  'firstSuccess.action.keepWaiting',
  'firstSuccess.action.disconnectAndEdit',
  'firstSuccess.action.backToSession',
  'firstSuccess.action.disconnect',
  'firstSuccess.action.retry',
  'firstSuccess.action.goToTerminal',
] as const;

const REQUIRED_KEY_GROUPS = {
  labels: [
    'firstSuccess.kicker',
    'firstSuccess.title',
    'firstSuccess.plan.title',
    'firstSuccess.plan.port',
    'firstSuccess.sideEffects.title',
  ],
  statuses: [
    'firstSuccess.status.reviewingPlan',
    'firstSuccess.status.connecting',
    'firstSuccess.status.waitingForOutput',
    'firstSuccess.status.dataReceived',
    'firstSuccess.status.displayUnavailable',
    'firstSuccess.status.silent',
    'firstSuccess.status.errored',
    'firstSuccess.status.disconnected',
    'firstSuccess.status.cancelled',
    'firstSuccess.status.completed',
  ],
  diagnostics: ['firstSuccess.error.candidateChanged'],
  actions: [
    'firstSuccess.action.confirmConnect',
    'firstSuccess.action.cancel',
    'firstSuccess.action.keepWaiting',
    'firstSuccess.action.disconnectAndEdit',
    'firstSuccess.action.backToSession',
    'firstSuccess.action.disconnect',
    'firstSuccess.action.retry',
    'firstSuccess.action.goToTerminal',
  ],
  planReviewMessages: [
    'firstSuccess.sideEffects.reservesPort',
    'firstSuccess.sideEffects.noPayload',
    'firstSuccess.sideEffects.controlLinesDefault',
    'firstSuccess.sideEffects.controlLinesUnknown',
    'firstSuccess.sideEffects.mayReset',
  ],
} as const;

function firstSuccessKeys(table: Record<string, string>): string[] {
  return Object.keys(table)
    .filter((key) => key.startsWith('firstSuccess.'))
    .sort();
}

describe('first-success i18n coverage', () => {
  it('keeps every first-success key explicitly covered by the bilingual checklist', () => {
    expect(firstSuccessKeys(en)).toEqual([...REQUIRED_FIRST_SUCCESS_TRANSLATION_KEYS].sort());
    expect(firstSuccessKeys(zh)).toEqual([...REQUIRED_FIRST_SUCCESS_TRANSLATION_KEYS].sort());
  });

  it('provides non-empty English and Chinese copy for every first-success label and message', () => {
    for (const key of REQUIRED_FIRST_SUCCESS_TRANSLATION_KEYS) {
      expect(en[key], `missing English copy for ${key}`).toEqual(expect.any(String));
      expect(en[key].trim(), `empty English copy for ${key}`).not.toHaveLength(0);
      expect(zh[key], `missing Chinese copy for ${key}`).toEqual(expect.any(String));
      expect(zh[key].trim(), `empty Chinese copy for ${key}`).not.toHaveLength(0);
    }
  });

  it('covers labels, statuses, diagnostics, actions, and plan-review messages', () => {
    const required = new Set<string>(REQUIRED_FIRST_SUCCESS_TRANSLATION_KEYS);
    for (const [group, keys] of Object.entries(REQUIRED_KEY_GROUPS)) {
      expect(keys.length, `${group} should declare at least one covered key`).toBeGreaterThan(0);
      for (const key of keys) {
        expect(required.has(key), `${group} is not covered by the first-success key list: ${key}`).toBe(
          true,
        );
      }
    }
  });
});
