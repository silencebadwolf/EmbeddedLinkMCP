import { describe, expect, it } from 'vitest';
import { en } from '@/renderer/i18n/en.js';
import { zh } from '@/renderer/i18n/zh.js';

const REQUIRED_READINESS_TRANSLATION_KEYS = [
  'readiness.start.kicker',
  'readiness.start.title',
  'readiness.start.description',
  'readiness.action.refresh',
  'readiness.action.refreshing',
  'readiness.action.advanced',
  'readiness.action.openTerminal',
  'readiness.action.manualOpen',
  'readiness.action.manualHint',
  'readiness.action.firstSuccessGuide',
  'readiness.status.aria',
  'readiness.status.loading',
  'readiness.status.ready',
  'readiness.status.blocked',
  'readiness.status.actionRequired',
  'readiness.status.unavailable',
  'readiness.status.generation',
  'readiness.checklist.title',
  'readiness.candidates.title',
  'readiness.candidates.empty',
  'readiness.candidates.advancedEmpty',
  'readiness.candidates.needsConfirmation',
  'readiness.candidates.openTerminal',
  'readiness.candidates.reviewJlink',
  'readiness.serial.title',
  'readiness.saved.title',
  'readiness.saved.description',
  'readiness.saved.loading',
  'readiness.saved.empty',
  'readiness.saved.open',
  'readiness.saved.manage',
  'readiness.serial.baudRate',
  'readiness.serial.baudInvalid',
  'readiness.manual.open',
  'readiness.advanced.title',
  'readiness.advanced.summary',
  'readiness.confidence.exact',
  'readiness.confidence.likely',
  'readiness.confidence.unknown',
  'readiness.check.status.ready',
  'readiness.check.status.actionRequired',
  'readiness.check.status.blocked',
  'readiness.check.status.unavailable',
  'readiness.check.status.checking',
  'readiness.check.status.unknown',
  'readiness.scope.runtime',
  'readiness.scope.workspace',
  'readiness.scope.serial',
  'readiness.scope.jlink',
  'readiness.scope.firmware',
  'readiness.scope.rtt',
  'readiness.scope.profile',
  'readiness.scope.session',
  'readiness.scope.agent',
  'readiness.param.port',
  'readiness.param.name',
  'readiness.param.profile',
  'readiness.param.baudRate',
  'readiness.param.count',
  'readiness.param.profilePort',
  'readiness.param.livePort',
  'readiness.param.target',
  'readiness.param.firmware',
  'readiness.param.format',
  'readiness.param.bytes',
  'readiness.param.hash',
  'readiness.message.runtimeReady',
  'readiness.message.runtimeFresh',
  'readiness.message.runtimeStale',
  'readiness.message.runtimeBlocked',
  'readiness.message.serialReady',
  'readiness.message.serialEmpty',
  'readiness.message.serialDetected',
  'readiness.message.serialScanCompleted',
  'readiness.message.serialDiscoveryFailed',
  'readiness.message.serialPermissionBlocked',
  'readiness.message.preferencesCorrupt',
  'readiness.message.refreshFailed',
  'readiness.message.refreshRecovered',
  'readiness.message.invalidPayload',
  'readiness.message.providerFailed',
  'readiness.message.providerTimeout',
  'readiness.message.providerInvalid',
  'readiness.message.providerTruncated',
  'readiness.message.workspaceProfilesAvailable',
  'readiness.message.workspaceNotSelected',
  'readiness.message.workspaceUnavailable',
  'readiness.message.profileMatched',
  'readiness.message.profileConflict',
  'readiness.message.profileCount',
  'readiness.message.sessionReusable',
  'readiness.message.sessionNone',
  'readiness.message.sessionCount',
  'readiness.message.agentReady',
  'readiness.message.agentActionRequired',
  'readiness.message.agentCount',
  'readiness.message.jlinkReady',
  'readiness.message.jlinkBackendAvailable',
  'readiness.message.jlinkBackendUnavailable',
  'readiness.message.jlinkProbeEmpty',
  'readiness.message.jlinkProbeCount',
  'readiness.message.jlinkProbeDetected',
  'readiness.message.jlinkDiscoveryFailed',
  'readiness.message.jlinkTargetNotInCatalog',
  'readiness.message.jlinkTargetCatalogChecked',
  'readiness.message.jlinkTargetCatalogMiss',
  'readiness.message.jlinkTargetEvidence',
  'readiness.message.firmwareReady',
  'readiness.message.firmwareMissing',
  'readiness.message.firmwareMetadataReady',
  'readiness.message.firmwareMetadataFailed',
  'readiness.message.rttReady',
  'readiness.message.rttConfigReady',
  'readiness.message.rttConfigMissing',
  'readiness.message.rttConfigFailed',
  'readiness.compensation.title',
  'readiness.compensation.description',
  'readiness.compensation.available',
  'readiness.compensation.disabled',
  'readiness.compensation.hidden',
  'readiness.compensation.reviewReflash',
  'readiness.compensation.expired',
  'readiness.compensation.evidenceMismatch',
  'readiness.profileSuggestions.title',
  'readiness.profileSuggestions.verifiedJlinkRtt',
  'readiness.profileSuggestions.save',
  'readiness.profileSuggestions.skip',
  'readiness.profileSuggestions.fieldTarget',
  'readiness.profileSuggestions.fieldFirmware',
  'readiness.profileSuggestions.fieldWorkflow',
  'readiness.manual.title',
  'readiness.manual.label',
  'readiness.manual.description',
  'readiness.manual.placeholder',
  'readiness.manual.disabledReason',
  'readiness.diagnostics.title',
  'readiness.diagnostics.copy',
  'readiness.diagnostics.empty',
] as const;

const REQUIRED_KEY_GROUPS = {
  labels: [
    'readiness.start.kicker',
    'readiness.start.title',
    'readiness.checklist.title',
    'readiness.candidates.title',
    'readiness.serial.title',
    'readiness.saved.title',
    'readiness.advanced.title',
    'readiness.compensation.title',
    'readiness.profileSuggestions.title',
    'readiness.manual.title',
    'readiness.manual.label',
    'readiness.diagnostics.title',
  ],
  status: [
    'readiness.status.aria',
    'readiness.status.loading',
    'readiness.status.ready',
    'readiness.status.blocked',
    'readiness.status.actionRequired',
    'readiness.status.unavailable',
    'readiness.status.generation',
  ],
  actions: [
    'readiness.action.refresh',
    'readiness.action.refreshing',
    'readiness.action.advanced',
    'readiness.action.openTerminal',
    'readiness.action.manualOpen',
    'readiness.action.firstSuccessGuide',
    'readiness.candidates.openTerminal',
    'readiness.candidates.reviewJlink',
    'readiness.saved.open',
    'readiness.compensation.reviewReflash',
    'readiness.profileSuggestions.save',
    'readiness.profileSuggestions.skip',
    'readiness.manual.open',
    'readiness.diagnostics.copy',
  ],
  disabledReasons: ['readiness.manual.disabledReason', 'readiness.serial.baudInvalid'],
  candidateMessages: [
    'readiness.candidates.empty',
    'readiness.candidates.needsConfirmation',
    'readiness.candidates.reviewJlink',
    'readiness.confidence.exact',
    'readiness.confidence.likely',
    'readiness.confidence.unknown',
  ],
  draftMessages: [
    'readiness.manual.description',
    'readiness.saved.description',
    'readiness.saved.loading',
    'readiness.saved.empty',
    'readiness.manual.placeholder',
    'readiness.manual.disabledReason',
    'readiness.serial.baudRate',
  ],
  diagnosticMessages: [
    'readiness.diagnostics.empty',
    'readiness.message.invalidPayload',
    'readiness.message.refreshFailed',
    'readiness.message.providerTruncated',
    'readiness.message.rttConfigMissing',
    'readiness.compensation.evidenceMismatch',
  ],
} as const;

function readinessKeys(table: Record<string, string>): string[] {
  return Object.keys(table)
    .filter((key) => key.startsWith('readiness.'))
    .sort();
}

describe('readiness i18n coverage', () => {
  it('describes the workspace-first home without removed manual or advanced entry points', () => {
    expect(en['readiness.start.description']).not.toMatch(/manual|advanced/i);
    expect(zh['readiness.start.description']).not.toMatch(/手动|高级/);
    expect(en['tabs.empty.subtitle']).not.toMatch(/serial terminal/i);
    expect(zh['tabs.empty.subtitle']).not.toMatch(/串口终端/);
  });

  it('keeps every readiness key explicitly covered by the bilingual checklist', () => {
    expect(readinessKeys(en)).toEqual([...REQUIRED_READINESS_TRANSLATION_KEYS].sort());
    expect(readinessKeys(zh)).toEqual([...REQUIRED_READINESS_TRANSLATION_KEYS].sort());
  });

  it('provides non-empty English and Chinese copy for every readiness label and message', () => {
    for (const key of REQUIRED_READINESS_TRANSLATION_KEYS) {
      expect(en[key], `missing English copy for ${key}`).toEqual(expect.any(String));
      expect(en[key].trim(), `empty English copy for ${key}`).not.toHaveLength(0);
      expect(zh[key], `missing Chinese copy for ${key}`).toEqual(expect.any(String));
      expect(zh[key].trim(), `empty Chinese copy for ${key}`).not.toHaveLength(0);
    }
  });

  it('covers labels, statuses, diagnostics, actions, disabled reasons, candidates, and drafts', () => {
    const required = new Set<string>(REQUIRED_READINESS_TRANSLATION_KEYS);
    for (const [group, keys] of Object.entries(REQUIRED_KEY_GROUPS)) {
      expect(keys.length, `${group} should declare at least one covered key`).toBeGreaterThan(0);
      for (const key of keys) {
        expect(required.has(key), `${group} is not covered by the readiness key list: ${key}`).toBe(
          true,
        );
      }
    }
  });
});
