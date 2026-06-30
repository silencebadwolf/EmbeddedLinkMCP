import { describe, expect, it } from 'vitest';
import {
  classifyJLinkTargetName,
  normalizeJLinkTargetName,
  suggestJLinkTargetName,
} from '@/shared/jlink-target-name.js';

describe('J-Link target name helpers', () => {
  it('suggests the verified SEGGER device name for STM32 full order codes', () => {
    expect(suggestJLinkTargetName('STM32H743IIT6')).toBe('STM32H743II');
    expect(suggestJLinkTargetName('stm32h743iit6')).toBe('STM32H743II');
    expect(suggestJLinkTargetName('STM32H743IIT6TR')).toBe('STM32H743II');
  });

  it('leaves already-canonical SEGGER target names unchanged', () => {
    expect(suggestJLinkTargetName('STM32H743II')).toBeUndefined();
    expect(normalizeJLinkTargetName(' STM32H743II ')).toBe('STM32H743II');
  });

  it('does not rewrite non-STM32 vendor target names', () => {
    expect(suggestJLinkTargetName('AT32F435RGT7')).toBeUndefined();
    expect(normalizeJLinkTargetName('AT32F435RGT7')).toBe('AT32F435RGT7');
  });

  it('classifies STM32 order-code targets with a remediation message', () => {
    const result = classifyJLinkTargetName('STM32H743IIT6');

    expect(result.kind).toBe('stm32-order-code');
    expect(result.normalizedTarget).toBe('STM32H743II');
    expect(result.message).toContain('STM32H743IIT6');
    expect(result.message).toContain('STM32H743II');
    expect(result.message).toContain('SEGGER');
  });
});
