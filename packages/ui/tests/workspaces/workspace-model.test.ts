// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import type {
  SavedConnectionSummary,
  SavedControlProfileRecordPayload,
} from '../../../../src/shared/preload-api.js';
import {
  summarizeControlProfileRecord,
  summarizeSerialConnection,
} from '@linkterm/ui/features/workspaces/workspace-model';

const fullRecord: SavedControlProfileRecordPayload = {
  id: 'workspace_fna',
  label: 'FNA test bench',
  root: 'C:/work/fna',
  source: 'manual',
  profile: {
    schemaVersion: 'linkterm-control/1.0.0',
    serial: { enabled: true, port: 'COM6', baudRate: 115200, mode: 'terminal' },
    jlink: { enabled: true, target: 'STM32H743II', interface: 'swd', speedKHz: 'auto' },
    flash: { binary: 'build/fna.elf', baseAddress: '0x08000000', verify: true },
    rtt: { enabled: true, channels: [0] },
  },
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T01:00:00.000Z',
};

const serialConnection: SavedConnectionSummary = {
  id: 'connection_com7',
  label: 'Temporary board serial',
  type: 'serial',
  config: { type: 'serial', port: 'COM7', baudRate: 921600, mode: 'terminal' },
  hasCredential: false,
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T02:00:00.000Z',
};

describe('workspace summary adapter', () => {
  it('summarizes a full device workspace without system-level AI fields', () => {
    const summary = summarizeControlProfileRecord(fullRecord);

    expect(summary).toMatchObject({
      id: 'workspace_fna',
      label: 'FNA test bench',
      kind: 'full',
      source: 'control-profile',
      controlProfileRecordId: 'workspace_fna',
      updatedAt: fullRecord.updatedAt,
    });
    expect(summary.details.join(' ')).toContain('COM6');
    expect(summary.details.join(' ')).toContain('STM32H743II');
    expect(summary.details.join(' ')).toContain('fna.elf');
    expect(JSON.stringify(summary).toLowerCase()).not.toMatch(/mcp|agent|credential|token/);
  });

  it('summarizes a serial saved connection as a lightweight workspace', () => {
    const summary = summarizeSerialConnection(serialConnection);

    expect(summary).toMatchObject({
      id: 'connection_com7',
      label: 'Temporary board serial',
      kind: 'serial-only',
      source: 'connection-profile',
      connectionProfileId: 'connection_com7',
      details: ['COM7 · 921600'],
    });
  });

  it('does not mislabel non-serial saved connections as device workspaces', () => {
    const summary = summarizeSerialConnection({
      ...serialConnection,
      id: 'connection_ssh',
      type: 'ssh',
      config: { type: 'ssh', host: 'example.test', port: 22, username: 'dev' },
    });

    expect(summary).toBeNull();
  });
});
