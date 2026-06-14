/**
 * MCP UI surface 工具实现 —— 2 个工具：`ui_configure` / `ui_screenshot`。
 *
 * 设计纲要：
 * 1. **始终注册**：与 J-Link debug surface 的 NullJLinkBackend 模式一致。当 deps.uiBridge / deps.getActiveWindow
 *    返回 null 时一律返回 `UI_NOT_AVAILABLE` 结构化拒绝，不回退到 fallback —— AI 客户端必须始终
 *    看到完整工具清单与契约性失败（req §4.6 等价语义）。
 * 2. **Electron-free**：本文件仅用 `CapturableWindow` / `UiStoreBridge` minimal interface；
 *    实际 BrowserWindow 适配在 `src/main/ipc/index.ts` 内联完成。
 * 3. **错误翻译 inline**：UI surface 仅 1 个域错（UI_NOT_AVAILABLE）+ ZodError + BUFFER_TOO_LARGE，
 *    没必要抽 error-translate 模块。debug surface 抽是因为 8 个 JLinkError 子类。
 * 4. **PNG size cap 复用 `MAX_BINARY_BYTES`**：与 debug surface 同一上限（16 MiB），保证
 *    MCP JSON 通道不被巨型截图撑爆。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError } from 'zod';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import { MAX_BINARY_BYTES } from '../../limits.js';
import {
  registerTool,
  ToolError,
  type ToolHandlerResult,
} from '../../registry.js';
import {
  uiConfigureInputSchema,
  uiScreenshotInputSchema,
  type UiConfigureInput,
  type UiScreenshotInput,
} from './schemas.js';
import type { UiToolsDeps } from './types.js';

/**
 * 把 2 个 MCP UI 工具注册到给定的 McpServer。
 *
 * @param server McpServer 实例
 * @param deps UI bridge + 主窗口 thunk；任一为 null 时工具仍注册但调用全拒。
 */
export function registerUiTools(server: McpServer, deps: UiToolsDeps): void {
  registerTool(server, {
    name: 'ui_configure',
    description:
      'Apply a whitelisted UI patch (locale / connection type / dialog open|close / non-sensitive ' +
      'prefill). Fire-and-forget: returns immediately after broadcasting; AI clients should call ' +
      'ui_screenshot to verify visual outcome. Sensitive fields (sshPassword / sshPrivateKey / ' +
      'sshPassphrase) are rejected by schema strict mode. ' +
      'When the connection dialog is already open, `set_connection_type` only updates the prefill ' +
      'for the next open; the current form is not modified to protect user input. To force-apply, ' +
      'send `close_connection_dialog` then `open_connection_dialog` with `prefill.type`.',
    sensitivity: 'state-affecting',
    inputSchema: uiConfigureInputSchema,
    handler: async (input: UiConfigureInput): Promise<ToolHandlerResult> => {
      try {
        if (!deps.uiBridge) {
          throw new ToolError(
            ERROR_CODES.UI_NOT_AVAILABLE,
            'UI bridge is not available; main process did not inject a renderer broadcast channel.',
          );
        }
        deps.uiBridge.applyPatch(input.patch);
        return {
          success: true,
          evidence: {
            kind: 'ui_screenshot',
            data: { dispatched: input.patch },
            cursor: 0,
          },
        };
      } catch (err) {
        translateUiError(err);
      }
    },
  });

  registerTool(server, {
    name: 'ui_screenshot',
    description:
      'Capture the active window as a PNG and return it inline as base64 (16 MiB cap). ' +
      'Read-only: does not modify any state. UI_NOT_AVAILABLE if the main window is missing or ' +
      'destroyed; BUFFER_TOO_LARGE if the encoded PNG exceeds the cap.',
    sensitivity: 'read-only',
    inputSchema: uiScreenshotInputSchema,
    handler: async (_input: UiScreenshotInput): Promise<ToolHandlerResult> => {
      try {
        const win = deps.getActiveWindow();
        if (!win || win.isDestroyed()) {
          throw new ToolError(
            ERROR_CODES.UI_NOT_AVAILABLE,
            'Main window is not available; either not yet created or already destroyed.',
          );
        }
        const image = await win.webContents.capturePage();
        const png = image.toPNG();
        if (png.byteLength > MAX_BINARY_BYTES) {
          throw new ToolError(
            ERROR_CODES.BUFFER_TOO_LARGE,
            `Screenshot exceeds ${MAX_BINARY_BYTES} bytes (got ${png.byteLength}).`,
            { actualBytes: png.byteLength, maxBytes: MAX_BINARY_BYTES },
          );
        }
        const size = image.getSize();
        return {
          success: true,
          evidence: {
            kind: 'ui_screenshot',
            data: {
              mimeType: 'image/png',
              base64: png.toString('base64'),
              width: size.width,
              height: size.height,
              byteLength: png.byteLength,
            },
            cursor: 0,
          },
        };
      } catch (err) {
        translateUiError(err);
      }
    },
  });
}

/**
 * 把 UI 域错误翻译为 ToolError 抛出。永远不返回（`: never`）。
 *
 * 与 workspace / debug surface 同思路：ZodError 仅暴露 path + message + code（不回显 value），
 * 自定义 ToolError 透传，其它异常落到 INTERNAL（registry 兜底）。
 */
function translateUiError(err: unknown): never {
  if (err instanceof ToolError) {
    throw err;
  }
  if (err instanceof ZodError) {
    const safeIssues = err.issues.map((i) => ({
      path: i.path,
      message: i.message,
      code: i.code,
    }));
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Invalid UI tool payload', {
      issues: safeIssues,
    });
  }
  throw err;
}
