/**
 * MCP debug surface 工具实现 —— 二进制载荷部分（8 个）。
 *
 * 包含：
 * - memory_read / memory_write
 * - flash_download / flash_write / flash_verify
 * - rtt_read / rtt_search
 * - snapshot_capture
 *
 * 这些工具都涉及 `Buffer` ↔ base64 翻译，集中在本文件以便审计。所有 base64
 * 解码都通过 {@link decodeBase64Capped}（含 16 MiB 上限）；编码直接 inline
 * `buf.toString('base64')`（一行调用、无需独立 helper）。
 *
 * 长操作（flash_download / flash_verify）通过 {@link withAbortableTimeout} 把
 * 入参的 `timeoutMs` 翻译为 AbortSignal 传递给 backend；backend 抛
 * `JLinkAbortedError` 时由 `runJLink` 翻译为 ABORTED。
 *
 * **注册入口**：{@link registerDebugBinaryTools}。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolHandlerResult } from '../../registry.js';
import { decodeBase64Capped } from './binary-codec.js';
import { ok, runJLink, withAbortableTimeout, ConfirmationRequiredError } from './error-translate.js';
import type { DebugToolsDeps } from './tools.js';
import {
  flashDownloadInputSchema,
  flashVerifyInputSchema,
  flashWriteInputSchema,
  memoryReadInputSchema,
  memoryWriteInputSchema,
  rttReadInputSchema,
  rttSearchInputSchema,
  snapshotCaptureInputSchema,
  type FlashDownloadInput,
  type FlashVerifyInput,
  type FlashWriteInput,
  type MemoryReadInput,
  type MemoryWriteInput,
  type RttReadInput,
  type RttSearchInput,
  type SnapshotCaptureInput,
} from './schemas.js';

/**
 * 注册二进制 debug 工具到 McpServer（8 个）。
 *
 * @param server McpServer 实例
 * @param deps 共享依赖（与 registerDebugTools 同源；通常传同一对象）
 */
export function registerDebugBinaryTools(server: McpServer, deps: DebugToolsDeps): void {
  const { jlinkBackend } = deps;

  // -- memory ---------------------------------------------------------

  registerTool(server, {
    name: 'memory_read',
    description:
      'Read a contiguous memory range. Returns dataBase64 (server-side base64 of raw bytes).',
    sensitivity: 'read-only',
    inputSchema: memoryReadInputSchema,
    handler: async (input: MemoryReadInput): Promise<ToolHandlerResult> => {
      const buf = await runJLink(() =>
        jlinkBackend.memoryRead(input.probeId, {
          address: input.address,
          length: input.length,
        }),
      );
      return ok({
        evidence: {
          kind: 'debug_output',
          data: {
            address: input.address,
            length: buf.byteLength,
            dataBase64: buf.toString('base64'),
          },
          cursor: 0,
        },
      });
    },
  });

  registerTool(server, {
    name: 'memory_write',
    description: 'Write bytes to a memory address. dataBase64 is decoded server-side.',
    sensitivity: 'state-affecting',
    inputSchema: memoryWriteInputSchema,
    handler: async (input: MemoryWriteInput): Promise<ToolHandlerResult> => {
      return runJLink(async () => {
        const buf = decodeBase64Capped(input.dataBase64, 'dataBase64');
        await jlinkBackend.memoryWrite(input.probeId, input.address, buf);
        return ok({
          evidence: {
            kind: 'debug_output',
            data: {
              address: input.address,
              bytesWritten: buf.byteLength,
            },
            cursor: 0,
          },
        });
      });
    },
  });

  // -- flash ----------------------------------------------------------

  registerTool(server, {
    name: 'flash_download',
    description:
      'Download a binary image to flash. binaryBase64 is decoded server-side and capped at 16 MiB. ' +
      'timeoutMs aborts long downloads. ' +
      'High-impact: requires confirm=true; otherwise CONFIRMATION_REQUIRED is returned (no decode, no backend call). ' +
      'No external CLI fallback.',
    sensitivity: 'state-affecting',
    inputSchema: flashDownloadInputSchema,
    handler: async (input: FlashDownloadInput): Promise<ToolHandlerResult> => {
      return runJLink(async () => {
        if (input.confirm !== true) throw new ConfirmationRequiredError('flash_download');
        const binary = decodeBase64Capped(input.binaryBase64, 'binaryBase64');
        const opts: { address?: number; verify?: boolean } = {};
        if (input.address !== undefined) opts.address = input.address;
        if (input.verify !== undefined) opts.verify = input.verify;
        const result = await withAbortableTimeout(input.timeoutMs, (signal) =>
          jlinkBackend.flashDownload(
            input.probeId,
            binary,
            Object.keys(opts).length > 0 ? opts : undefined,
            signal,
          ),
        );
        return ok({
          evidence: {
            kind: 'debug_output',
            data: {
              bytesWritten: result.bytesWritten,
              verified: result.verified,
            },
            cursor: 0,
          },
        });
      });
    },
  });

  registerTool(server, {
    name: 'flash_write',
    description:
      'Write bytes to a flash address (no erase). ' +
      'High-impact: requires confirm=true; otherwise CONFIRMATION_REQUIRED is returned. ' +
      'No external CLI fallback.',
    sensitivity: 'state-affecting',
    inputSchema: flashWriteInputSchema,
    handler: async (input: FlashWriteInput): Promise<ToolHandlerResult> => {
      return runJLink(async () => {
        if (input.confirm !== true) throw new ConfirmationRequiredError('flash_write');
        const buf = decodeBase64Capped(input.dataBase64, 'dataBase64');
        await jlinkBackend.flashWrite(input.probeId, input.address, buf);
        return ok({
          evidence: {
            kind: 'debug_output',
            data: { address: input.address, bytesWritten: buf.byteLength },
            cursor: 0,
          },
        });
      });
    },
  });

  registerTool(server, {
    name: 'flash_verify',
    description:
      'Verify flash content against the given binary; returns ok=true or the first mismatch ' +
      'address. timeoutMs aborts long verifications.',
    sensitivity: 'state-affecting',
    inputSchema: flashVerifyInputSchema,
    handler: async (input: FlashVerifyInput): Promise<ToolHandlerResult> => {
      return runJLink(async () => {
        const binary = decodeBase64Capped(input.binaryBase64, 'binaryBase64');
        const opts: { address?: number } = {};
        if (input.address !== undefined) opts.address = input.address;
        const result = await withAbortableTimeout(input.timeoutMs, (signal) =>
          jlinkBackend.flashVerify(
            input.probeId,
            binary,
            Object.keys(opts).length > 0 ? opts : undefined,
            signal,
          ),
        );
        return ok({
          evidence: {
            kind: 'debug_output',
            data: result,
            cursor: 0,
          },
        });
      });
    },
  });

  // -- RTT ------------------------------------------------------------

  registerTool(server, {
    name: 'rtt_read',
    description:
      'Read up to maxBytes from an RTT up channel; advances the hardware read pointer. ' +
      'Returns dataBase64 + truncated flag.',
    sensitivity: 'state-affecting',
    inputSchema: rttReadInputSchema,
    handler: async (input: RttReadInput): Promise<ToolHandlerResult> => {
      const result = await runJLink(() =>
        jlinkBackend.rttRead(input.probeId, input.channelIndex, input.maxBytes),
      );
      return ok({
        evidence: {
          kind: 'debug_output',
          data: {
            channelIndex: result.channelIndex,
            dataBase64: result.data.toString('base64'),
            truncated: result.truncated,
          },
          cursor: 0,
        },
      });
    },
  });

  registerTool(server, {
    name: 'rtt_search',
    description:
      'Search the current RTT channel buffer for a literal pattern without consuming data; ' +
      'returns matchAt offset (or null) plus a base64-encoded preview.',
    sensitivity: 'read-only',
    inputSchema: rttSearchInputSchema,
    handler: async (input: RttSearchInput): Promise<ToolHandlerResult> => {
      const result = await runJLink(() =>
        jlinkBackend.rttSearch(input.probeId, input.channelIndex, input.pattern, input.maxBytes),
      );
      return ok({
        evidence: {
          kind: 'debug_output',
          data: {
            matchAt: result.matchAt,
            previewBase64: result.preview.toString('base64'),
          },
          cursor: 0,
        },
      });
    },
  });

  // -- diagnostics ----------------------------------------------------

  registerTool(server, {
    name: 'snapshot_capture',
    description:
      'Capture a CPU + memory snapshot for offline analysis. memorySnippets carry base64-encoded bytes.',
    sensitivity: 'read-only',
    inputSchema: snapshotCaptureInputSchema,
    handler: async (input: SnapshotCaptureInput): Promise<ToolHandlerResult> => {
      const result = await runJLink(() =>
        jlinkBackend.snapshotCapture(input.probeId, input.ranges),
      );
      return ok({
        evidence: {
          kind: 'debug_output',
          data: {
            pc: result.pc,
            sp: result.sp,
            registers: result.registers,
            memorySnippets: result.memorySnippets.map((s) => ({
              address: s.address,
              dataBase64: s.data.toString('base64'),
            })),
            capturedAt: result.capturedAt,
          },
          cursor: 0,
        },
      });
    },
  });
}
