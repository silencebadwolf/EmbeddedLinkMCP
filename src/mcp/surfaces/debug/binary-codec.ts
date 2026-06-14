/**
 * 二进制载荷的 base64 解码 + 大小上限校验。
 *
 * MCP 协议是 JSON，二进制必须 base64 编码。该模块集中处理：
 * 1. 严格 base64 字符校验（`Buffer.from('xxx', 'base64')` 对非法字符宽容地丢弃，会让
 *    AI 端写入 "成功但字节错"）；
 * 2. 16 MiB 上限（Cortex-M flash 一般 ≤ 4 MiB，4× 余量；防 MCP JSON 消息溢出）；
 * 3. **解码前先按字符串长度估算**，避免对超大输入先 `Buffer.from` 后再校验长度
 *    （会真分配 ~1 GiB 内存，DoS 面）。
 *
 * 该文件是 debug surface 的二进制 decoder 唯一来源。新加涉及 base64 的工具时**复用**
 * `decodeBase64Capped`，编码用 `buf.toString('base64')` 内联——不要在 handler 内 inline
 * `Buffer.from(...)`。
 */

import { JLinkBufferTooLargeError } from '../../../jlink/errors.js';
import { ToolError } from '../../registry.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import { MAX_BINARY_BYTES, MAX_BASE64_INPUT_LEN } from '../../limits.js';

export { MAX_BINARY_BYTES, MAX_BASE64_INPUT_LEN };

/**
 * 严格解码 base64 字符串为 Buffer，并对长度进行上限校验。
 *
 * 实现顺序：strip whitespace → length precheck → 字符集/padding 校验 → Buffer.from。
 * 长度 precheck 在分配 Buffer 之前完成，超出 16 MiB 立即抛 BUFFER_TOO_LARGE，避免
 * 触发大块内存分配。
 *
 * @param b64 base64 字符串（允许 \r\n\t/空格作为换行噪声）
 * @param fieldName 字段名，用于失败消息
 * @returns 解码后的 Buffer
 * @throws ToolError(INVALID_ARGUMENT) 字符不合法、padding 错误、或为空
 * @throws JLinkBufferTooLargeError 解码后超过 16 MiB
 */
export function decodeBase64Capped(b64: string, fieldName: string): Buffer {
  const stripped = b64.replace(/[\r\n\t ]/g, '');
  if (stripped.length === 0) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      `Invalid base64 in field "${fieldName}": empty after stripping whitespace`,
      { field: fieldName },
    );
  }
  // base64 长度 precheck：4 字符 → 3 字节，超出上限直接拒绝，避免分配大 Buffer。
  const maxStripped = Math.ceil(MAX_BINARY_BYTES / 3) * 4;
  if (stripped.length > maxStripped) {
    const estimatedBytes = Math.floor((stripped.length * 3) / 4);
    throw new JLinkBufferTooLargeError(estimatedBytes, MAX_BINARY_BYTES);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(stripped) || stripped.length % 4 !== 0) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      `Invalid base64 in field "${fieldName}": contains non-base64 characters or wrong padding`,
      { field: fieldName },
    );
  }
  const buf = Buffer.from(stripped, 'base64');
  if (buf.byteLength > MAX_BINARY_BYTES) {
    throw new JLinkBufferTooLargeError(buf.byteLength, MAX_BINARY_BYTES);
  }
  return buf;
}
