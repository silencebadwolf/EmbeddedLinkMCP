import { ERROR_CODES } from '@linkterm/contracts/error-codes';
import { ToolError } from '../core/errors.js';

const CORTEX_M_VECTOR_TABLE_BYTES = 8;
const THUMB_BIT = 0x1;

export interface FirmwareVectorTableCheck {
  status: 'pass' | 'fail' | 'skipped';
  resetVector?: number;
  resetAddress?: number;
  imageStart: number;
  imageEndExclusive: number;
  message?: string;
}

export function checkFirmwareVectorTable(binary: Buffer, baseAddress: number): FirmwareVectorTableCheck {
  const imageStart = baseAddress;
  const imageEndExclusive = baseAddress + binary.byteLength;
  if (binary.byteLength < CORTEX_M_VECTOR_TABLE_BYTES) {
    return { status: 'skipped', imageStart, imageEndExclusive, message: 'firmware is too small to contain a Cortex-M vector table' };
  }
  const resetVector = binary.readUInt32LE(4);
  if ((resetVector & THUMB_BIT) !== THUMB_BIT) {
    return { status: 'skipped', imageStart, imageEndExclusive, resetVector, message: 'reset vector is not a Thumb address' };
  }
  const resetAddress = resetVector & ~THUMB_BIT;
  if (resetAddress < imageStart || resetAddress >= imageEndExclusive) {
    return {
      status: 'fail',
      resetVector,
      resetAddress,
      imageStart,
      imageEndExclusive,
      message:
        `firmware reset vector 0x${resetVector.toString(16).padStart(8, '0')} does not point inside the image range ` +
        `0x${imageStart.toString(16).padStart(8, '0')}-0x${(imageEndExclusive - 1).toString(16).padStart(8, '0')}; ` +
        'check firmware.baseAddress/profile.flash.baseAddress before flashing',
    };
  }
  return { status: 'pass', resetVector, resetAddress, imageStart, imageEndExclusive };
}

export function validateFirmwareVectorTable(binary: Buffer, baseAddress: number): void {
  const check = checkFirmwareVectorTable(binary, baseAddress);
  if (check.status === 'fail') {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      check.message ?? 'firmware reset vector does not point inside the configured image range',
    );
  }
}
