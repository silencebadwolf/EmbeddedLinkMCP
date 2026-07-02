export interface ElfLoadSegmentFixture {
  paddr: number;
  data: Buffer | ReadonlyArray<number>;
  vaddr?: number;
  flags?: number;
}

const ELF_HEADER_BYTES = 52;
const PROGRAM_HEADER_BYTES = 32;
const PT_LOAD = 1;
const EM_ARM = 40;

export function cortexMVectorImage(
  baseAddress: number,
  extra: Buffer = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]),
): Buffer {
  const vector = Buffer.alloc(8);
  vector.writeUInt32LE(0x20000000, 0);
  vector.writeUInt32LE(baseAddress + 0x11, 4);
  return Buffer.concat([
    vector,
    extra,
    Buffer.from([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]),
  ]);
}

export function elf32LeImage(segments: ReadonlyArray<ElfLoadSegmentFixture>): Buffer {
  const segmentData = segments.map((segment) => Buffer.from(segment.data));
  const phoff = ELF_HEADER_BYTES;
  let nextOffset = align(ELF_HEADER_BYTES + segments.length * PROGRAM_HEADER_BYTES, 0x100);
  const layouts = segmentData.map((data) => {
    const offset = nextOffset;
    nextOffset = align(offset + data.byteLength, 4);
    return { offset, data };
  });

  const out = Buffer.alloc(nextOffset, 0);
  out.writeUInt8(0x7f, 0);
  out.write('ELF', 1, 'ascii');
  out.writeUInt8(1, 4);
  out.writeUInt8(1, 5);
  out.writeUInt8(1, 6);
  out.writeUInt16LE(2, 16);
  out.writeUInt16LE(EM_ARM, 18);
  out.writeUInt32LE(1, 20);
  out.writeUInt32LE(segments[0]?.paddr ?? 0, 24);
  out.writeUInt32LE(phoff, 28);
  out.writeUInt32LE(0, 32);
  out.writeUInt32LE(0, 36);
  out.writeUInt16LE(ELF_HEADER_BYTES, 40);
  out.writeUInt16LE(PROGRAM_HEADER_BYTES, 42);
  out.writeUInt16LE(segments.length, 44);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const layout = layouts[index]!;
    const headerOffset = phoff + index * PROGRAM_HEADER_BYTES;
    out.writeUInt32LE(PT_LOAD, headerOffset);
    out.writeUInt32LE(layout.offset, headerOffset + 4);
    out.writeUInt32LE(segment.vaddr ?? segment.paddr, headerOffset + 8);
    out.writeUInt32LE(segment.paddr, headerOffset + 12);
    out.writeUInt32LE(layout.data.byteLength, headerOffset + 16);
    out.writeUInt32LE(layout.data.byteLength, headerOffset + 20);
    out.writeUInt32LE(segment.flags ?? 5, headerOffset + 24);
    out.writeUInt32LE(4, headerOffset + 28);
    layout.data.copy(out, layout.offset);
  }

  return out;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
