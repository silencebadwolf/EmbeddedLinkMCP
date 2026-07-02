import { describe, expect, it } from 'vitest';
import { parseElf } from '../../../../src/core/workspace/elf.js';
import { elf32LeImage } from '../../../fixtures/elf.js';

describe('ELF firmware parsing', () => {
  it('detects the lowest load address and decodes contiguous bytes', () => {
    const image = parseElf(
      elf32LeImage([
        { paddr: 0x08000008, data: [0x01, 0x02, 0x03, 0x04] },
        { paddr: 0x08000010, data: [0xaa, 0xbb] },
      ]),
    );

    expect(image.baseAddress).toBe(0x08000008);
    expect(image.binary).toEqual(
      Buffer.from([0x01, 0x02, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff, 0xaa, 0xbb]),
    );
  });

  it('uses flash physical addresses for RAM-VMA file-backed data segments', () => {
    const image = parseElf(
      elf32LeImage([
        { paddr: 0x08000000, vaddr: 0x08000000, data: [0x01, 0x02, 0x03, 0x04] },
        { paddr: 0x08000004, vaddr: 0x24000000, data: [0xaa, 0xbb] },
      ]),
      { maxImageBytes: 64 },
    );

    expect(image.baseAddress).toBe(0x08000000);
    expect(image.binary).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04, 0xaa, 0xbb]));
  });

  it('rejects files without ELF magic', () => {
    expect(() => parseElf(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toThrow(/ELF/i);
  });
});
