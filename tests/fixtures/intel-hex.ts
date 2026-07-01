export function intelHexRecord(address: number, type: number, bytes: ReadonlyArray<number>): string {
  const fields = [bytes.length, (address >> 8) & 0xff, address & 0xff, type, ...bytes];
  const sum = fields.reduce((acc, value) => (acc + value) & 0xff, 0);
  const checksum = ((~sum + 1) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const body = fields.map((value) => value.toString(16).padStart(2, '0').toUpperCase()).join('');
  return `:${body}${checksum}`;
}

export function intelHexText(records: ReadonlyArray<string>): string {
  return `${records.join('\n')}\n`;
}
