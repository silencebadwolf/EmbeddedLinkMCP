import { describe, expect, it } from 'vitest';
import {
  buildControlProfileQuestion,
  inspectControlProfileCompleteness,
  parseControlProfileAnswer,
} from '@/core/workspace/index.js';

describe('control profile answer parser', () => {
  it('parses a one-line human answer into a complete control profile patch', () => {
    const parsed = parseControlProfileAnswer(
      'COM7，921600，AT32F435RGT7，SWD，4000kHz，build/app.bin，0x08000000',
    );

    expect(parsed.patch).toEqual({
      serial: { enabled: true, port: 'COM7', baudRate: 921600, mode: 'terminal' },
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
    });
    expect(parsed.parsedFields).toEqual([
      'serial.port',
      'serial.baudRate',
      'jlink.target',
      'jlink.interface',
      'jlink.speedKHz',
      'flash.binary',
      'flash.baseAddress',
    ]);
    expect(parsed.rejectedFields).toEqual([]);
  });

  it('parses RTT observation as an alternative to serial fields', () => {
    const parsed = parseControlProfileAnswer(
      'RTT 日志，AT32F435RGT7，SWD，4000kHz，build/app.bin，0x08000000',
    );

    expect(parsed.patch).toEqual({
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      rtt: { enabled: true, channels: [0] },
    });
    expect(parsed.parsedFields).toContain('rtt.enabled');
  });

  it('normalizes STM32 full order codes to SEGGER J-Link target names in human answers', () => {
    const parsed = parseControlProfileAnswer(
      'COM7 115200 STM32H743IIT6 SWD 4000kHz build/rtthread.bin 0x08000000',
    );

    expect(parsed.patch.jlink?.target).toBe('STM32H743II');
    expect(parsed.parsedFields).toContain('jlink.target');
  });

  it('rejects decimal flash addresses instead of guessing', () => {
    const parsed = parseControlProfileAnswer(
      'COM7 115200 STM32F407VG SWD 4000kHz build/app.bin 地址 134217728',
    );

    expect(parsed.patch.flash?.baseAddress).toBeUndefined();
    expect(parsed.rejectedFields).toEqual([
      { field: 'flash.baseAddress', reason: 'decimal-address', value: '134217728' },
    ]);
  });

  it('parses auto J-Link speed without guessing a number', () => {
    const parsed = parseControlProfileAnswer(
      'COM7 115200 STM32F407VG SWD auto build/app.bin 0x08000000',
    );

    expect(parsed.patch.jlink?.speedKHz).toBe('auto');
    expect(parsed.parsedFields).toContain('jlink.speedKHz');
  });

  it('inspects missing fields and builds a concise human question', () => {
    const report = inspectControlProfileCompleteness({
      schemaVersion: 'linkterm-control/1.0.0',
      serial: { enabled: false },
      jlink: { enabled: false },
      flash: { binary: 'build/app.bin' },
    });

    expect(report.complete).toBe(false);
    expect(report.missingFields).toEqual([
      'observation.channel',
      'jlink.target',
      'jlink.interface',
      'jlink.speedKHz',
      'flash.baseAddress',
    ]);
    const question = buildControlProfileQuestion(report);
    expect(question).toContain('0x08000000');
    expect(question).toContain('RTT');
  });

  it('treats RTT observation as complete without serial port fields', () => {
    const report = inspectControlProfileCompleteness({
      schemaVersion: 'linkterm-control/1.0.0',
      rtt: { enabled: true, channels: [0] },
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
    });

    expect(report.complete).toBe(true);
    expect(report.missingFields).toEqual([]);
  });
});
