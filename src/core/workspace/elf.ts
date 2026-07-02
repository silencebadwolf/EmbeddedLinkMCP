export interface ElfImage {
  baseAddress: number;
  binary: Buffer;
}

export interface ParseElfOptions {
  maxImageBytes?: number;
}

export class ElfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ElfParseError';
  }
}

interface LoadSegment {
  address: number;
  data: Buffer;
}

const ELF32_HEADER_BYTES = 52;
const ELF32_PROGRAM_HEADER_BYTES = 32;
const PT_LOAD = 1;

export function parseElf(input: Buffer, options: ParseElfOptions = {}): ElfImage {
  if (input.byteLength < ELF32_HEADER_BYTES) {
    throw new ElfParseError('ELF file is too small to contain an ELF32 header');
  }
  if (input[0] !== 0x7f || input.toString('ascii', 1, 4) !== 'ELF') {
    throw new ElfParseError('ELF magic header is missing');
  }
  if (input[4] !== 1) throw new ElfParseError('Only ELF32 firmware images are supported');
  if (input[5] !== 1)
    throw new ElfParseError('Only little-endian ELF firmware images are supported');

  const programHeaderOffset = input.readUInt32LE(28);
  const programHeaderEntrySize = input.readUInt16LE(42);
  const programHeaderCount = input.readUInt16LE(44);
  if (programHeaderCount === 0) {
    throw new ElfParseError('ELF file does not contain program headers');
  }
  if (programHeaderEntrySize < ELF32_PROGRAM_HEADER_BYTES) {
    throw new ElfParseError('ELF program header entries are too small');
  }
  assertRangeInside(
    input,
    programHeaderOffset,
    programHeaderEntrySize * programHeaderCount,
    'ELF program header table is outside the file',
  );

  const segments: LoadSegment[] = [];
  for (let index = 0; index < programHeaderCount; index += 1) {
    const offset = programHeaderOffset + index * programHeaderEntrySize;
    const type = input.readUInt32LE(offset);
    if (type !== PT_LOAD) continue;
    const fileOffset = input.readUInt32LE(offset + 4);
    const virtualAddress = input.readUInt32LE(offset + 8);
    const physicalAddress = input.readUInt32LE(offset + 12);
    const fileSize = input.readUInt32LE(offset + 16);
    if (fileSize === 0) continue;
    assertRangeInside(input, fileOffset, fileSize, 'ELF load segment is outside the file');
    const address = physicalAddress !== 0 ? physicalAddress : virtualAddress;
    const end = address + fileSize;
    if (!Number.isSafeInteger(end) || end < address) {
      throw new ElfParseError('ELF load segment address range is invalid');
    }
    segments.push({
      address,
      data: Buffer.from(input.subarray(fileOffset, fileOffset + fileSize)),
    });
  }

  if (segments.length === 0) {
    throw new ElfParseError('ELF file does not contain loadable file-backed segments');
  }
  const baseAddress = Math.min(...segments.map((segment) => segment.address));
  const endAddress = Math.max(
    ...segments.map((segment) => segment.address + segment.data.byteLength),
  );
  const imageBytes = endAddress - baseAddress;
  if (options.maxImageBytes !== undefined && imageBytes > options.maxImageBytes) {
    throw new ElfParseError(`ELF decoded image exceeds ${options.maxImageBytes} byte limit`);
  }

  const binary = Buffer.alloc(imageBytes, 0xff);
  const written = new Uint8Array(imageBytes);
  for (const segment of segments) {
    const start = segment.address - baseAddress;
    for (let offset = 0; offset < segment.data.byteLength; offset += 1) {
      const index = start + offset;
      const value = segment.data[offset]!;
      if (written[index] === 1 && binary[index] !== value) {
        throw new ElfParseError(
          `ELF overlapping load segments differ at 0x${(baseAddress + index).toString(16)}`,
        );
      }
      binary[index] = value;
      written[index] = 1;
    }
  }

  return { baseAddress, binary };
}

export function isElfPath(filePath: string): boolean {
  return /\.elf$/iu.test(filePath);
}

function assertRangeInside(input: Buffer, offset: number, length: number, message: string): void {
  const end = offset + length;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(end) ||
    offset < 0 ||
    length < 0 ||
    end > input.byteLength
  ) {
    throw new ElfParseError(message);
  }
}
