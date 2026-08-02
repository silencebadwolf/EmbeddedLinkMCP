import { describe, expect, it } from 'vitest';
import { parseSeggerVcomChange, parseSeggerVcomInspection } from '@/jlink/segger-vcom-control.js';

const result = (stdout: string, exitCode = 0) => ({
  exitCode,
  signal: null,
  stdout,
  stderr: '',
});

describe('SEGGER VCOM output parser', () => {
  it('recognizes disabled VCOM and firmware-update evidence', () => {
    expect(parseSeggerVcomInspection(result('Updating firmware: O.K.\nVCOM is disabled'))).toEqual({
      supported: true,
      state: 'disabled',
      requiresPowerCycle: true,
      firmwareUpdateObserved: true,
    });
  });

  it('fails closed when enable output does not positively confirm VCOM', () => {
    expect(() => parseSeggerVcomChange(result('Command completed'), true)).toThrow(
      /did not confirm/iu,
    );
  });

  it('reports unsupported Commander firmware without treating it as enabled', () => {
    expect(parseSeggerVcomInspection(result('Unknown command: vcom', 1))).toMatchObject({
      supported: false,
      state: 'unknown',
    });
  });
});
