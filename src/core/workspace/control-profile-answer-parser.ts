/** Parse human answers into workspace-local control profile patches. */

import type { ControlProfile } from './control-profile-types.js';
import type { ControlProfileBody } from './control-profile-schema.js';
import { normalizeJLinkTargetName } from '../../shared/jlink-target-name.js';

/** 控制配置向导关注的字段名。 */
export type ControlProfileField =
  | 'observation.channel'
  | 'serial.port'
  | 'serial.baudRate'
  | 'jlink.target'
  | 'jlink.interface'
  | 'jlink.speedKHz'
  | 'flash.binary'
  | 'flash.baseAddress'
  | 'rtt.enabled';

/** 被识别但拒绝写入的字段。 */
export interface RejectedControlProfileField {
  field: ControlProfileField;
  reason: 'decimal-address';
  value: string;
}

/** 自然语言回答解析结果。 */
export interface ParsedControlProfileAnswer {
  patch: ControlProfileBody;
  parsedFields: ControlProfileField[];
  rejectedFields: RejectedControlProfileField[];
}

/** 控制配置完整性报告。 */
export interface ControlProfileCompletenessReport {
  complete: boolean;
  missingFields: ControlProfileField[];
}

/**
 * 从人的一句话回答中解析控制配置 patch。
 *
 * @param answer 用户输入的自然语言/逗号分隔回答
 * @returns 结构化控制配置 patch、已解析字段和被拒绝字段
 */
export function parseControlProfileAnswer(answer: string): ParsedControlProfileAnswer {
  const parsedFields: ControlProfileField[] = [];
  const rejectedFields: RejectedControlProfileField[] = [];
  const patch: ControlProfileBody = {};

  const wantsRtt = extractRttEnabled(answer);
  if (wantsRtt) {
    patch.rtt = { enabled: true, channels: [0] };
    parsedFields.push('rtt.enabled');
  }

  const port = wantsRtt ? undefined : extractSerialPort(answer);
  const baudRate = extractBaudRate(answer);
  if (!wantsRtt && (port !== undefined || baudRate !== undefined)) {
    patch.serial = { enabled: true, mode: 'terminal' };
    if (port !== undefined) {
      patch.serial.port = port;
      parsedFields.push('serial.port');
    }
    if (baudRate !== undefined) {
      patch.serial.baudRate = baudRate;
      parsedFields.push('serial.baudRate');
    }
  }

  const target = extractJLinkTarget(answer);
  const iface = extractJLinkInterface(answer);
  const speedKHz = extractJLinkSpeedKHz(answer);
  if (target !== undefined || iface !== undefined || speedKHz !== undefined) {
    patch.jlink = { enabled: true };
    if (target !== undefined) {
      patch.jlink.target = normalizeJLinkTargetName(target);
      parsedFields.push('jlink.target');
    }
    if (iface !== undefined) {
      patch.jlink.interface = iface;
      parsedFields.push('jlink.interface');
    }
    if (speedKHz !== undefined) {
      patch.jlink.speedKHz = speedKHz;
      parsedFields.push('jlink.speedKHz');
    }
  }

  const binary = extractBinaryPath(answer);
  const hexAddress = extractHexAddress(answer);
  if (binary !== undefined || hexAddress !== undefined) {
    patch.flash = { verify: true };
    if (binary !== undefined) {
      patch.flash.binary = binary;
      parsedFields.push('flash.binary');
    }
    if (hexAddress !== undefined) {
      patch.flash.baseAddress = hexAddress;
      parsedFields.push('flash.baseAddress');
    }
  }

  if (hexAddress === undefined) {
    const decimalAddress = extractDecimalAddress(answer);
    if (decimalAddress !== undefined) {
      rejectedFields.push({
        field: 'flash.baseAddress',
        reason: 'decimal-address',
        value: decimalAddress,
      });
    }
  }

  return { patch, parsedFields, rejectedFields };
}

/**
 * 检查控制配置是否包含快速拉起所需字段。
 *
 * @param profile 已存在的控制配置；undefined 表示文件不存在
 * @returns 完整性报告
 */
export function inspectControlProfileCompleteness(
  profile: ControlProfile | undefined,
): ControlProfileCompletenessReport {
  const missingFields: ControlProfileField[] = [];

  const hasSerialObservation =
    profile?.serial?.enabled === true &&
    profile.serial.port !== undefined &&
    profile.serial.baudRate !== undefined;
  const hasRttObservation = profile?.rtt?.enabled === true;
  if (!hasSerialObservation && !hasRttObservation) {
    missingFields.push('observation.channel');
  }
  if (profile?.jlink?.enabled !== true || profile.jlink.target === undefined) {
    missingFields.push('jlink.target');
  }
  if (profile?.jlink?.enabled !== true || profile.jlink.interface === undefined) {
    missingFields.push('jlink.interface');
  }
  if (profile?.jlink?.enabled !== true || profile.jlink.speedKHz === undefined) {
    missingFields.push('jlink.speedKHz');
  }
  if (profile?.flash?.binary === undefined) {
    missingFields.push('flash.binary');
  }
  if (profile?.flash?.baseAddress === undefined) {
    missingFields.push('flash.baseAddress');
  }

  return { complete: missingFields.length === 0, missingFields };
}

/**
 * 根据缺失字段生成给人的简短问题。
 *
 * @param report 控制配置完整性报告
 * @returns 可直接展示给人的问题文本
 */
export function buildControlProfileQuestion(report: ControlProfileCompletenessReport): string {
  if (report.complete) {
    return '当前工作区控制配置已完整，可以直接调用 activate_control_profile 拉起控制。';
  }
  return (
    '请告诉我这些控制参数：观察通道（串口或 RTT 日志）、芯片型号、SWD/JTAG、J-Link 速度、bin/hex/elf 路径、flash 起始地址。' +
    '串口模式请提供串口号和波特率，例如：COM3，115200，AT32F435RGT7，SWD，4000kHz，build/app.elf，0x08000000。' +
    'RTT 模式可以回答：RTT 日志，AT32F435RGT7，SWD，4000kHz，build/app.elf，0x08000000。' +
    `当前缺失字段：${report.missingFields.join(', ')}`
  );
}

function extractRttEnabled(answer: string): boolean {
  return /\bRTT\b|RTT\s*日志|RTT\s*log/i.test(answer);
}

/**
 * 提取 Windows/Unix 串口路径。
 *
 * @param answer 用户回答
 * @returns 串口路径；未找到时 undefined
 */
function extractSerialPort(answer: string): string | undefined {
  return answer.match(/\bCOM\d+\b/i)?.[0].toUpperCase() ?? answer.match(/\/dev\/[\w./-]+/i)?.[0];
}

/**
 * 提取波特率，避免把 kHz/MHz 调试速度当成波特率。
 *
 * @param answer 用户回答
 * @returns 波特率；未找到时 undefined
 */
function extractBaudRate(answer: string): number | undefined {
  const matches = answer.matchAll(/(?<!0x)\b\d{4,8}\b(?!\s*(?:kHz|MHz))/gi);
  for (const match of matches) {
    const value = Number(match[0]);
    if (value >= 9_600 && value <= 10_000_000) return value;
  }
  return undefined;
}

/**
 * 提取常见 MCU target token。
 *
 * @param answer 用户回答
 * @returns J-Link target；未找到时 undefined
 */
function extractJLinkTarget(answer: string): string | undefined {
  return answer.match(/\b(?:AT32|STM32|GD32|NRF|nRF|ESP32|RP2040)[A-Za-z0-9_-]*\b/)?.[0];
}

/**
 * 提取调试接口。
 *
 * @param answer 用户回答
 * @returns swd/jtag；未找到时 undefined
 */
function extractJLinkInterface(answer: string): 'swd' | 'jtag' | undefined {
  if (/\bSWD\b/i.test(answer)) return 'swd';
  if (/\bJTAG\b/i.test(answer)) return 'jtag';
  return undefined;
}

/**
 * 提取 J-Link 速度并统一为 kHz。
 *
 * @param answer 用户回答
 * @returns kHz 速度或 auto；未找到时 undefined
 */
function extractJLinkSpeedKHz(answer: string): number | 'auto' | undefined {
  if (/(?:\bauto\b|自动|最高速|最快)/i.test(answer)) return 'auto';
  const match = answer.match(/\b(\d+(?:\.\d+)?)\s*(kHz|MHz)\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit === 'mhz' ? Math.round(value * 1000) : Math.round(value);
}

/**
 * 提取固件二进制路径。
 *
 * @param answer 用户回答
 * @returns bin/hex/elf 路径；未找到时 undefined
 */
function extractBinaryPath(answer: string): string | undefined {
  return answer.match(/[^\s,，;；"'“”]+\.(?:bin|hex|elf)\b/i)?.[0];
}

/**
 * 提取十六进制 flash 地址。
 *
 * @param answer 用户回答
 * @returns 十六进制地址；未找到时 undefined
 */
function extractHexAddress(answer: string): string | undefined {
  return answer.match(/0x[0-9a-fA-F]+/)?.[0];
}

/**
 * 在明显地址语境下提取被拒绝的十进制地址。
 *
 * @param answer 用户回答
 * @returns 十进制地址字符串；未找到时 undefined
 */
function extractDecimalAddress(answer: string): string | undefined {
  return answer.match(/(?:地址|address|baseAddress|base\s*address|flash\s*base)\D*(\d{7,})/i)?.[1];
}
