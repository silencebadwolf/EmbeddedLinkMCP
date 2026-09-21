/**
 * MCP 工具的二进制载荷上限（base64 解码后字节数）。
 * 同时约束 debug surface 的 flash/memory 操作与 ui surface 的 PNG 截图。
 */
export const MAX_BINARY_BYTES = 16 * 1024 * 1024;

/**
 * base64 输入字符串长度上限：`ceil(MAX_BINARY_BYTES * 4 / 3)` 向上对齐到 4。
 * Zod 在 schema 层就拒绝超长串，避免分配 GB 级 Buffer。
 */
export const MAX_BASE64_INPUT_LEN = Math.ceil((MAX_BINARY_BYTES * 4) / 3 / 4) * 4;
