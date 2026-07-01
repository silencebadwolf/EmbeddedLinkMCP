import { describe, expect, it } from 'vitest';
import {
  formatHexAddress,
  parseIntelHex,
} from '../../../../src/core/workspace/intel-hex.js';
import { intelHexRecord, intelHexText } from '../../../fixtures/intel-hex.js';

describe('Intel HEX firmware parsing', () => {
  it('detects the lowest absolute data address and decodes contiguous bytes', () => {
    const hex = intelHexText([
      intelHexRecord(0, 0x04, [0x08, 0x00]),
      intelHexRecord(0x0010, 0x00, [0xaa, 0xbb]),
      intelHexRecord(0x0008, 0x00, [0x01, 0x02, 0x03, 0x04]),
      intelHexRecord(0, 0x01, []),
    ]);

    const image = parseIntelHex(hex);

    expect(image.baseAddress).toBe(0x08000008);
    expect(formatHexAddress(image.baseAddress)).toBe('0x08000008');
    expect(image.binary).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff, 0xaa, 0xbb]));
  });

  it('supports extended segment address records', () => {
    const hex = intelHexText([
      intelHexRecord(0, 0x02, [0x10, 0x00]),
      intelHexRecord(0x0020, 0x00, [0x55]),
      intelHexRecord(0, 0x01, []),
    ]);

    expect(parseIntelHex(hex).baseAddress).toBe(0x00010020);
  });

  it('rejects records with invalid checksums', () => {
    const valid = intelHexRecord(0x0000, 0x00, [0x01]);
    const invalid = `${valid.slice(0, -2)}00`;

    expect(() => parseIntelHex(intelHexText([invalid, intelHexRecord(0, 0x01, [])]))).toThrow(
      /checksum/i,
    );
  });

  it('rejects hex files without data records', () => {
    expect(() => parseIntelHex(intelHexText([intelHexRecord(0, 0x01, [])]))).toThrow(
      /data/i,
    );
  });
});
