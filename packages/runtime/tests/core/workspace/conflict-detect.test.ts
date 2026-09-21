import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_SCHEMA_VERSION,
  detectConflicts,
  type EvidenceSnapshot,
} from '@linkterm/runtime/core/workspace/index';
import type { WorkspaceConfig } from '@linkterm/runtime/core/workspace/index';

const baseConfig: WorkspaceConfig = { schemaVersion: WORKSPACE_SCHEMA_VERSION };

const emptyEvidence: EvidenceSnapshot = { serialPorts: [] };

describe('detectConflicts (pure function)', () => {
  it('returns no conflicts when config has no serial section', () => {
    const r = detectConflicts(baseConfig, emptyEvidence);
    expect(r.conflicts).toEqual([]);
  });

  it('lists all 5 required fields as missing on a fresh workspace', () => {
    const r = detectConflicts(baseConfig, emptyEvidence);
    expect(r.missingFields).toEqual(['chip', 'flash', 'debug', 'rtt', 'serial']);
  });

  it('reports serial.port conflict when configured port not present in evidence', () => {
    const cfg: WorkspaceConfig = {
      ...baseConfig,
      serial: { port: '/dev/tty.usbserial-X', baudRate: 115200, mode: 'normal' },
    };
    const r = detectConflicts(cfg, emptyEvidence);
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0]!;
    expect(c.field).toBe('serial.port');
    expect(c.configured).toBe('/dev/tty.usbserial-X');
    expect(c.actual).toBeNull();
    expect(c.severity).toBe('warn');
    expect(c.message).toMatch(/serial port/);
  });

  it('clears serial.port conflict when evidence contains the path', () => {
    const cfg: WorkspaceConfig = {
      ...baseConfig,
      serial: { port: '/dev/tty.usbserial-A', baudRate: 9600, mode: 'terminal' },
    };
    const r = detectConflicts(cfg, {
      serialPorts: [{ path: '/dev/tty.usbserial-A' }, { path: '/dev/tty.OtherDevice' }],
    });
    expect(r.conflicts).toEqual([]);
  });

  it('only reports missingFields for fields not present', () => {
    const cfg: WorkspaceConfig = {
      ...baseConfig,
      chip: { family: 'STM32F4', part: 'X' },
      flash: { tool: 'jlink' },
    };
    const r = detectConflicts(cfg, emptyEvidence);
    expect(r.missingFields).toEqual(['debug', 'rtt', 'serial']);
  });

  it('returns empty missingFields when all 5 sections are populated', () => {
    const cfg: WorkspaceConfig = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      chip: { family: 'STM32F4', part: 'STM32F407' },
      flash: { tool: 'jlink' },
      debug: { tool: 'openocd' },
      rtt: { enabled: false },
      serial: { port: '/dev/tty.A', baudRate: 9600, mode: 'normal' },
    };
    const r = detectConflicts(cfg, { serialPorts: [{ path: '/dev/tty.A' }] });
    expect(r.missingFields).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });

  it('all current conflicts are warn-severity (Phase 8 baseline)', () => {
    const cfg: WorkspaceConfig = {
      ...baseConfig,
      serial: { port: '/dev/missing', baudRate: 9600, mode: 'normal' },
    };
    const r = detectConflicts(cfg, emptyEvidence);
    expect(r.conflicts.every((c) => c.severity === 'warn')).toBe(true);
  });
});
