/**
 * MCP UI surface schemas — strict mode + sensitive field rejection.
 */

import { describe, it, expect } from 'vitest';
import {
  uiConfigureInputSchema,
  nonSensitivePrefillSchema,
  uiScreenshotInputSchema,
} from '@/mcp/surfaces/ui/schemas.js';

describe('uiConfigureInputSchema', () => {
  it('accepts set_locale patch', () => {
    const r = uiConfigureInputSchema.safeParse({
      patch: { action: 'set_locale', locale: 'zh' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown action', () => {
    const r = uiConfigureInputSchema.safeParse({
      patch: { action: 'eval_code', code: 'x' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown top-level field via .strict()', () => {
    const r = uiConfigureInputSchema.safeParse({
      patch: { action: 'set_locale', locale: 'en' },
      mystery: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown field inside patch', () => {
    const r = uiConfigureInputSchema.safeParse({
      patch: { action: 'set_locale', locale: 'en', extra: 1 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid locale', () => {
    const r = uiConfigureInputSchema.safeParse({
      patch: { action: 'set_locale', locale: 'fr' },
    });
    expect(r.success).toBe(false);
  });
});

describe('nonSensitivePrefillSchema', () => {
  it('accepts a fully populated whitelisted prefill', () => {
    const r = nonSensitivePrefillSchema.safeParse({
      type: 'ssh',
      label: 'gw',
      sshHost: '10.0.0.1',
      sshPort: '22',
      sshUsername: 'root',
      sshAuth: 'privateKey',
    });
    expect(r.success).toBe(true);
  });

  it('rejects sshPassword (sensitive)', () => {
    const r = nonSensitivePrefillSchema.safeParse({ sshPassword: 'leak' });
    expect(r.success).toBe(false);
  });

  it('rejects sshPrivateKey (sensitive)', () => {
    const r = nonSensitivePrefillSchema.safeParse({ sshPrivateKey: '-----BEGIN-----' });
    expect(r.success).toBe(false);
  });

  it('rejects sshPassphrase (sensitive)', () => {
    const r = nonSensitivePrefillSchema.safeParse({ sshPassphrase: 'leak' });
    expect(r.success).toBe(false);
  });

  it('rejects non-numeric baudRate string', () => {
    const r = nonSensitivePrefillSchema.safeParse({ baudRate: 'fast' });
    expect(r.success).toBe(false);
  });

  it('rejects non-numeric sshPort string', () => {
    const r = nonSensitivePrefillSchema.safeParse({ sshPort: 'twenty-two' });
    expect(r.success).toBe(false);
  });
});

describe('uiScreenshotInputSchema', () => {
  it('accepts empty input', () => {
    const r = uiScreenshotInputSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts correlationId', () => {
    const r = uiScreenshotInputSchema.safeParse({ correlationId: 'c1' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown field', () => {
    const r = uiScreenshotInputSchema.safeParse({ rect: { x: 0, y: 0, w: 100, h: 100 } });
    expect(r.success).toBe(false);
  });
});
