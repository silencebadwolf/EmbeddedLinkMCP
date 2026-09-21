import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_SCHEMA_VERSION,
  workspaceConfigSchema,
  workspaceConfigPatchSchema,
  chipSchema,
  flashSchema,
  debugSchema,
  rttSchema,
  serialPersistedSchema,
} from '@linkterm/runtime/core/workspace/index';

describe('workspace config schema', () => {
  describe('schemaVersion literal', () => {
    it('accepts the canonical version string', () => {
      const result = workspaceConfigSchema.safeParse({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
      });
      expect(result.success).toBe(true);
    });

    it('rejects any other version string', () => {
      const result = workspaceConfigSchema.safeParse({
        schemaVersion: 'linkterm-workspace/2.0.0',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing schemaVersion', () => {
      const result = workspaceConfigSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('chipSchema strict mode', () => {
    it('accepts valid chip', () => {
      expect(chipSchema.safeParse({ family: 'STM32F4', part: 'STM32F407' }).success).toBe(true);
    });
    it('rejects unknown keys (e.g. password)', () => {
      const r = chipSchema.safeParse({
        family: 'STM32F4',
        part: 'STM32F407',
        password: 'leak',
      });
      expect(r.success).toBe(false);
    });
    it('rejects empty family', () => {
      expect(chipSchema.safeParse({ family: '', part: 'X' }).success).toBe(false);
    });
  });

  describe('flashSchema strict mode', () => {
    it('accepts minimal flash', () => {
      expect(flashSchema.safeParse({ tool: 'jlink' }).success).toBe(true);
    });
    it('accepts full flash with baseAddress', () => {
      expect(
        flashSchema.safeParse({ tool: 'jlink', binary: 'fw.bin', baseAddress: 0x08000000 })
          .success,
      ).toBe(true);
    });
    it('rejects negative baseAddress', () => {
      expect(flashSchema.safeParse({ tool: 'jlink', baseAddress: -1 }).success).toBe(false);
    });
    it('rejects unknown token field', () => {
      const r = flashSchema.safeParse({ tool: 'jlink', token: 'secret' });
      expect(r.success).toBe(false);
    });
  });

  describe('debugSchema strict mode', () => {
    it('accepts minimal debug', () => {
      expect(debugSchema.safeParse({ tool: 'openocd' }).success).toBe(true);
    });
    it('rejects unknown privateKey field', () => {
      const r = debugSchema.safeParse({ tool: 'openocd', privateKey: '----...' });
      expect(r.success).toBe(false);
    });
  });

  describe('rttSchema strict mode', () => {
    it('accepts enabled with channels', () => {
      expect(rttSchema.safeParse({ enabled: true, channels: [0, 1] }).success).toBe(true);
    });
    it('rejects non-int channel', () => {
      expect(rttSchema.safeParse({ enabled: true, channels: [0.5] }).success).toBe(false);
    });
    it('rejects unknown secret field', () => {
      const r = rttSchema.safeParse({ enabled: true, secret: 'x' });
      expect(r.success).toBe(false);
    });
  });

  describe('serialPersistedSchema strict mode', () => {
    it('accepts valid serial', () => {
      const r = serialPersistedSchema.safeParse({
        port: '/dev/tty.usbserial-1',
        baudRate: 115200,
        mode: 'terminal',
      });
      expect(r.success).toBe(true);
    });
    it('rejects zero baudRate', () => {
      const r = serialPersistedSchema.safeParse({ port: '/dev/x', baudRate: 0, mode: 'normal' });
      expect(r.success).toBe(false);
    });
    it('rejects unknown mode', () => {
      const r = serialPersistedSchema.safeParse({
        port: '/dev/x',
        baudRate: 9600,
        mode: 'binary',
      });
      expect(r.success).toBe(false);
    });
    it('rejects unknown password field', () => {
      const r = serialPersistedSchema.safeParse({
        port: '/dev/x',
        baudRate: 9600,
        mode: 'normal',
        password: 'nope',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('workspaceConfigSchema root strict mode', () => {
    it('accepts a fully populated config', () => {
      const r = workspaceConfigSchema.safeParse({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        chip: { family: 'STM32F4', part: 'STM32F407' },
        flash: { tool: 'jlink', binary: 'fw.bin' },
        debug: { tool: 'openocd', connection: 'swd' },
        rtt: { enabled: true, channels: [0] },
        serial: { port: '/dev/tty.usbserial-1', baudRate: 115200, mode: 'terminal' },
      });
      expect(r.success).toBe(true);
    });
    it('rejects an unknown top-level field', () => {
      const r = workspaceConfigSchema.safeParse({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        credentials: { password: 'leak' },
      });
      expect(r.success).toBe(false);
    });
  });

  describe('workspaceConfigPatchSchema', () => {
    it('accepts an empty patch', () => {
      expect(workspaceConfigPatchSchema.safeParse({}).success).toBe(true);
    });
    it('accepts partial patch', () => {
      expect(
        workspaceConfigPatchSchema.safeParse({
          chip: { family: 'STM32F4', part: 'STM32F407' },
        }).success,
      ).toBe(true);
    });
    it('rejects schemaVersion in patch', () => {
      const r = workspaceConfigPatchSchema.safeParse({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
      });
      expect(r.success).toBe(false);
    });
    it('rejects unknown patch keys (token / secret)', () => {
      const r = workspaceConfigPatchSchema.safeParse({ token: 'secret' });
      expect(r.success).toBe(false);
    });
    it('rejects nested unknown key inside chip', () => {
      const r = workspaceConfigPatchSchema.safeParse({
        chip: { family: 'STM32F4', part: 'X', password: 'leak' },
      });
      expect(r.success).toBe(false);
    });
  });
});
