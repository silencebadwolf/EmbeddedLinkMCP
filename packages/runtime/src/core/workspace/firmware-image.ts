import { IntelHexParseError, isIntelHexPath, parseIntelHex } from './intel-hex.js';
import { ElfParseError, isElfPath, parseElf } from './elf.js';

export type FirmwareImageFormat = 'raw-binary' | 'intel-hex' | 'elf';

export interface DecodedFirmwareImage {
  binary: Buffer;
  format: FirmwareImageFormat;
  baseAddress?: number;
}

export interface DecodeFirmwareImageOptions {
  maxImageBytes?: number;
}

export type FirmwareImageParseError = IntelHexParseError | ElfParseError;

export function decodeFirmwareImageByPath(
  filePath: string,
  raw: Buffer,
  options: DecodeFirmwareImageOptions = {},
): DecodedFirmwareImage {
  if (isIntelHexPath(filePath)) {
    const image = parseIntelHex(raw, { maxImageBytes: options.maxImageBytes });
    return { binary: image.binary, format: 'intel-hex', baseAddress: image.baseAddress };
  }
  if (isElfPath(filePath)) {
    const image = parseElf(raw, { maxImageBytes: options.maxImageBytes });
    return { binary: image.binary, format: 'elf', baseAddress: image.baseAddress };
  }
  return { binary: raw, format: 'raw-binary' };
}

export function isSelfDescribingFirmwareImagePath(filePath: string): boolean {
  return isIntelHexPath(filePath) || isElfPath(filePath);
}

export function isFirmwareImageParseError(err: unknown): err is FirmwareImageParseError {
  return err instanceof IntelHexParseError || err instanceof ElfParseError;
}
