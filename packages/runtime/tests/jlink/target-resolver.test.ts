import { describe, expect, it, vi } from 'vitest';
import type { JLinkDeviceCatalog } from '@linkterm/runtime/jlink/device-catalog';
import { resolveJLinkTarget } from '@linkterm/runtime/jlink/target-resolver';

function catalog(options: {
  available?: boolean;
  has?: boolean;
  devices?: Array<{ name: string; vendor?: string }>;
}): JLinkDeviceCatalog {
  return {
    search: vi.fn(async ({ query }) => ({
      available: options.available ?? true,
      sourceFiles: options.available === false ? [] : ['JLinkDevices.xml'],
      devices: (options.devices ?? []).map((device) => ({
        ...device,
        sourceFile: 'JLinkDevices.xml',
        flashBanks: [],
      })),
      ...(query === 'STM32H743II'
        ? { queryNormalization: { originalQuery: 'STM32H743IIT6', normalizedQuery: 'STM32H743II' } }
        : {}),
    })),
    get: vi.fn(async () => undefined),
    has: vi.fn(async () => options.has ?? false),
    refresh: vi.fn(async () => undefined),
  };
}

describe('resolveJLinkTarget', () => {
  it('returns normalized target and catalog match evidence when local catalog contains it', async () => {
    const result = await resolveJLinkTarget(' -AT32F435RGT7 ', catalog({ has: true }));

    expect(result.target).toBe('-AT32F435RGT7');
    expect(result.catalog?.available).toBe(true);
    expect(result.catalog?.matched).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('keeps catalog misses advisory so SEGGER built-in targets can still be tried at runtime', async () => {
    const result = await resolveJLinkTarget('STM32H743II', catalog({
      has: false,
      devices: [{ name: 'STM32H743ZI', vendor: 'ST' }],
    }));

    expect(result.target).toBe('STM32H743II');
    expect(result.catalog?.matched).toBe(false);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        kind: 'jlink_target_not_in_catalog',
        target: 'STM32H743II',
        suggestions: [expect.objectContaining({ name: 'STM32H743ZI' })],
      }),
    ]);
  });

  it('does not warn when no local catalog database is available', async () => {
    const result = await resolveJLinkTarget('CUSTOM_TARGET', catalog({ available: false }));

    expect(result.target).toBe('CUSTOM_TARGET');
    expect(result.catalog?.available).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('records STM32 order-code normalization evidence', async () => {
    const result = await resolveJLinkTarget('STM32H743IIT6', catalog({ has: false }));

    expect(result.target).toBe('STM32H743II');
    expect(result.normalization).toMatchObject({
      originalTarget: 'STM32H743IIT6',
      normalizedTarget: 'STM32H743II',
      kind: 'stm32-order-code',
    });
  });
});
