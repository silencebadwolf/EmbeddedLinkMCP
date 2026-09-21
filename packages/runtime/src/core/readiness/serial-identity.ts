import { createHash } from 'node:crypto';
import type { SerialPortInfo, StableSerialIdentity } from '@linkterm/contracts/types';

const IDENTITY_PREFIX = 'sha256:';

/** 从 Main-owned 串口事实生成不可逆稳定身份；不会返回原始 USB 序列号。 */
export function deriveStableSerialIdentity(port: SerialPortInfo): StableSerialIdentity {
  const serialNumber = normalize(port.serialNumber);
  const vendorId = normalize(port.vendorId);
  const productId = normalize(port.productId);
  return {
    ...(serialNumber !== undefined && vendorId !== undefined && productId !== undefined
      ? { hardwareIdentity: digest(`device\0${vendorId}\0${productId}\0${serialNumber}`) }
      : {}),
    ...(serialNumber !== undefined ? { parentIdentity: digest(`parent\0${serialNumber}`) } : {}),
  };
}

/** 按当前 OS path 找端口并只返回哈希身份。 */
export function findStableSerialIdentity(
  portPath: string,
  ports: readonly SerialPortInfo[],
): StableSerialIdentity | undefined {
  const port = ports.find((candidate) => candidate.path === portPath);
  if (port === undefined) return undefined;
  const identity = deriveStableSerialIdentity(port);
  return identity.hardwareIdentity === undefined && identity.parentIdentity === undefined
    ? undefined
    : identity;
}

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function digest(value: string): string {
  return `${IDENTITY_PREFIX}${createHash('sha256').update(value).digest('hex')}`;
}
