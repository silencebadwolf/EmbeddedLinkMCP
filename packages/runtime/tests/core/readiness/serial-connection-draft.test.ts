import { describe, expect, it } from 'vitest';
import {
  createDraftFromCandidate,
  createManualSerialDraft,
  draftToNonSensitivePrefill,
} from '@linkterm/runtime/core/readiness/serial-connection-draft';
import type { DeviceCandidate } from '@/shared/readiness-contract.js';

const candidate: DeviceCandidate = {
  id: 'candidate_serial_COM7',
  kind: 'serial',
  label: 'COM7 · USB Serial Device',
  confidence: 'likely',
  requiresUserConfirmation: true,
  evidence: [],
  serial: {
    portLabel: 'COM7',
    baudRate: 115_200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
  },
};

describe('SerialConnectionDraft helpers', () => {
  it('creates a draft from a candidate with parameter sources and side-effect metadata', () => {
    const draft = createDraftFromCandidate(candidate, { draftId: 'draft_1' });

    expect(draft).toMatchObject({
      schemaVersion: '1.0.0',
      draftId: 'draft_1',
      source: 'live-discovery',
      candidateId: 'candidate_serial_COM7',
      portLabel: 'COM7',
      parameters: {
        baudRate: { value: 115_200, source: 'default' },
        dataBits: { value: 8, source: 'default' },
        stopBits: { value: 1, source: 'default' },
        parity: { value: 'none', source: 'default' },
      },
      sideEffects: {
        reservesPort: true,
        sendsPayloadOnConnect: false,
        controlLineBehaviorCode: 'connection.control_lines.default',
        mayResetBoard: true,
      },
      validation: { status: 'ready', reasons: [] },
    });
  });

  it('creates an incomplete manual draft without connecting', () => {
    const draft = createManualSerialDraft({ draftId: 'draft_manual', portLabel: '' });

    expect(draft).toMatchObject({
      source: 'manual',
      validation: {
        status: 'incomplete',
        reasons: ['readiness.serial.port_required'],
      },
    });
  });

  it('round-trips non-sensitive values to existing ConnectionDialog prefill shape', () => {
    const draft = createManualSerialDraft({
      draftId: 'draft_manual',
      portLabel: 'COM9',
      baudRate: 57_600,
      dataBits: 7,
      stopBits: 2,
      parity: 'even',
    });

    expect(draftToNonSensitivePrefill(draft)).toEqual({
      type: 'serial',
      serialPort: 'COM9',
      baudRate: '57600',
      serialMode: 'terminal',
      dataBits: '7',
      stopBits: '2',
      parity: 'even',
      readinessDraftId: 'draft_manual',
      readinessDraftSource: 'manual',
      readinessDraftValidationStatus: 'ready',
      readinessDraftMayResetBoard: true,
      readinessDraftSendsPayloadOnConnect: false,
    });
    expect(JSON.stringify(draftToNonSensitivePrefill(draft))).not.toMatch(/password|privateKey|token/i);
  });

  it('preserves saved-profile baud-rate source separately from default serial parameters', () => {
    const draft = createDraftFromCandidate(
      {
        ...candidate,
        confidence: 'exact',
        requiresUserConfirmation: false,
        evidence: [
          {
            source: 'saved-record',
            summaryCode: 'readiness.profile.matched',
            params: [{ key: 'baudRate', value: '230400' }],
          },
        ],
        serial: {
          portLabel: 'COM7',
          baudRate: 230400,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
        },
      },
      { draftId: 'draft_profile' },
    );

    expect(draft.parameters).toMatchObject({
      baudRate: { value: 230400, source: 'saved-profile' },
      dataBits: { value: 8, source: 'default' },
      stopBits: { value: 1, source: 'default' },
      parity: { value: 'none', source: 'default' },
    });
  });

  it('captures a candidate fingerprint that changes when live evidence changes', () => {
    const original = createDraftFromCandidate(
      {
        ...candidate,
        evidence: [
          {
            source: 'live-discovery',
            summaryCode: 'readiness.serial.detected',
            params: [{ key: 'port', value: 'COM7' }],
          },
        ],
      },
      { draftId: 'draft_original' },
    );
    const changed = createDraftFromCandidate(
      {
        ...candidate,
        confidence: 'unknown',
        evidence: [
          {
            source: 'live-discovery',
            summaryCode: 'readiness.serial.conflict',
            params: [{ key: 'port', value: 'COM7' }],
          },
        ],
      },
      { draftId: 'draft_changed' },
    );

    expect(original.candidateFingerprint).toMatch(/^candidate_fp_[0-9a-f]+$/u);
    expect(changed.candidateFingerprint).not.toBe(original.candidateFingerprint);
  });

  it('fails closed when a candidate has no serial settings', () => {
    const draft = createDraftFromCandidate(
      { ...candidate, serial: undefined },
      { draftId: 'draft_no_serial' },
    );

    expect(draft).toMatchObject({
      validation: {
        status: 'incomplete',
        reasons: ['readiness.serial.settings_missing'],
      },
    });
  });

  it('fails closed for J-Link candidates instead of treating them as serial ports', () => {
    const draft = createDraftFromCandidate(
      {
        id: 'candidate_jlink_probe_a',
        kind: 'jlink',
        label: 'J-Link probe A',
        confidence: 'unknown',
        requiresUserConfirmation: true,
        evidence: [{ source: 'probe-detect', summaryCode: 'readiness.jlink.probe.detected' }],
        jlink: { probeLabel: 'J-Link probe A', targetLabel: 'STM32H743' },
      },
      { draftId: 'draft_jlink' },
    );

    expect(draft).toMatchObject({
      source: 'live-discovery',
      validation: {
        status: 'incomplete',
        reasons: ['readiness.serial.settings_missing'],
      },
    });
    expect(draft).not.toHaveProperty('portLabel');
  });
});
