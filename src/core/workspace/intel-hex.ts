export interface IntelHexImage {
  baseAddress: number;
  binary: Buffer;
}

export interface ParseIntelHexOptions {
  maxImageBytes?: number;
}

export class IntelHexParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntelHexParseError';
  }
}

export function parseIntelHex(
  text: string | Buffer,
  options: ParseIntelHexOptions = {},
): IntelHexImage {
  const source = Buffer.isBuffer(text) ? text.toString('utf-8') : text;
  const bytesByAddress = new Map<number, number>();
  let addressBase = 0;
  let minAddress = Number.POSITIVE_INFINITY;
  let maxAddressExclusive = 0;
  let sawEof = false;

  const lines = source.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === '') continue;
    if (sawEof) throw new IntelHexParseError(`Intel HEX data appears after EOF at line ${index + 1}`);
    const record = parseIntelHexRecord(line, index + 1);

    if (record.type === 0x00) {
      for (let offset = 0; offset < record.data.length; offset += 1) {
        const absoluteAddress = addressBase + record.address + offset;
        const value = record.data[offset]!;
        const previous = bytesByAddress.get(absoluteAddress);
        if (previous !== undefined && previous !== value) {
          throw new IntelHexParseError(
            `Intel HEX overlapping data differs at 0x${absoluteAddress.toString(16)}`,
          );
        }
        bytesByAddress.set(absoluteAddress, value);
      }
      if (record.data.length > 0) {
        const start = addressBase + record.address;
        const end = start + record.data.length;
        minAddress = Math.min(minAddress, start);
        maxAddressExclusive = Math.max(maxAddressExclusive, end);
      }
      continue;
    }

    if (record.type === 0x01) {
      if (record.data.length !== 0) {
        throw new IntelHexParseError(`Intel HEX EOF record must not contain data at line ${index + 1}`);
      }
      sawEof = true;
      continue;
    }

    if (record.type === 0x02) {
      if (record.data.length !== 2) {
        throw new IntelHexParseError(
          `Intel HEX extended segment address record must contain 2 bytes at line ${index + 1}`,
        );
      }
      addressBase = ((record.data[0]! << 8) | record.data[1]!) << 4;
      continue;
    }

    if (record.type === 0x04) {
      if (record.data.length !== 2) {
        throw new IntelHexParseError(
          `Intel HEX extended linear address record must contain 2 bytes at line ${index + 1}`,
        );
      }
      addressBase = ((record.data[0]! << 8) | record.data[1]!) * 0x10000;
      continue;
    }

    if (record.type === 0x03 || record.type === 0x05) continue;
    throw new IntelHexParseError(`Unsupported Intel HEX record type 0x${record.type.toString(16)} at line ${index + 1}`);
  }

  if (bytesByAddress.size === 0 || !Number.isFinite(minAddress)) {
    throw new IntelHexParseError('Intel HEX file does not contain data records');
  }
  const imageBytes = maxAddressExclusive - minAddress;
  if (options.maxImageBytes !== undefined && imageBytes > options.maxImageBytes) {
    throw new IntelHexParseError(
      `Intel HEX decoded image exceeds ${options.maxImageBytes} byte limit`,
    );
  }

  const binary = Buffer.alloc(imageBytes, 0xff);
  for (const [absoluteAddress, value] of bytesByAddress) {
    binary[absoluteAddress - minAddress] = value;
  }
  return { baseAddress: minAddress, binary };
}

export function formatHexAddress(address: number): string {
  if (!Number.isSafeInteger(address) || address < 0) {
    throw new IntelHexParseError(`Invalid address: ${address}`);
  }
  return `0x${address.toString(16).padStart(8, '0').toUpperCase()}`;
}

export function isIntelHexPath(filePath: string): boolean {
  return /\.hex$/iu.test(filePath);
}

interface IntelHexRecord {
  address: number;
  type: number;
  data: number[];
}

function parseIntelHexRecord(line: string, lineNumber: number): IntelHexRecord {
  if (!line.startsWith(':')) {
    throw new IntelHexParseError(`Intel HEX record must start with ':' at line ${lineNumber}`);
  }
  const hex = line.slice(1);
  if (!/^[0-9a-fA-F]+$/u.test(hex) || hex.length < 10 || hex.length % 2 !== 0) {
    throw new IntelHexParseError(`Malformed Intel HEX record at line ${lineNumber}`);
  }
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  const byteCount = bytes[0]!;
  const expectedByteLength = 5 + byteCount;
  if (bytes.length !== expectedByteLength) {
    throw new IntelHexParseError(`Intel HEX byte count mismatch at line ${lineNumber}`);
  }
  const checksumTotal = bytes.reduce((acc, value) => (acc + value) & 0xff, 0);
  if (checksumTotal !== 0) {
    throw new IntelHexParseError(`Intel HEX checksum mismatch at line ${lineNumber}`);
  }
  return {
    address: (bytes[1]! << 8) | bytes[2]!,
    type: bytes[3]!,
    data: bytes.slice(4, 4 + byteCount),
  };
}
