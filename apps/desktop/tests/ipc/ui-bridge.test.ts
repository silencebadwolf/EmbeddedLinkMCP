/**
 * 简化烟雾测试：确保 mock-preload-api 的 ui 命名空间与 emitUiPatch 工作。
 *
 * 真实 main 进程 createUiBridge 涉及 `BrowserWindow.getAllWindows()`，无法在
 * Vitest（无 Electron 主进程）下直接验证；通过 MCP tools.test.ts 的端到端断言
 * 间接覆盖。本文件仅校验 fixture 自身契约。
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest';
import { createMockPreloadAPI } from '../../../../tests/fixtures/mock-preload-api.js';
import type { UiStatePatch } from '@linkterm/contracts/preload-api';
import { createUiBridge, type UiPatchTarget } from '../../src/main/ipc/ui-bridge.js';

describe('mock preload UI namespace', () => {
  it('onStatePatch receives emitted patches', () => {
    const mock = createMockPreloadAPI();
    const received: UiStatePatch[] = [];
    const unsub = mock.api.ui.onStatePatch((p) => received.push(p));
    mock.emitUiPatch({ action: 'set_locale', locale: 'zh' });
    expect(received).toEqual([{ action: 'set_locale', locale: 'zh' }]);
    unsub();
    mock.emitUiPatch({ action: 'set_locale', locale: 'en' });
    expect(received).toHaveLength(1);
  });

  it('multiple subscribers receive the same patch', () => {
    const mock = createMockPreloadAPI();
    const a: UiStatePatch[] = [];
    const b: UiStatePatch[] = [];
    mock.api.ui.onStatePatch((p) => a.push(p));
    mock.api.ui.onStatePatch((p) => b.push(p));
    mock.emitUiPatch({ action: 'close_connection_dialog' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe('createUiBridge', () => {
  it('skips destroyed wc and continues when send throws', () => {
    const goodReceived: UiStatePatch[] = [];
    const goodWc: UiPatchTarget = {
      isDestroyed: () => false,
      send: (_channel, payload) => {
        goodReceived.push(payload as UiStatePatch);
      },
    };
    const throwingWc: UiPatchTarget = {
      isDestroyed: () => false,
      send: () => {
        throw new Error('Object has been destroyed');
      },
    };
    const destroyedWc: UiPatchTarget = {
      isDestroyed: () => true,
      send: vi.fn(),
    };
    const bridge = createUiBridge(() => [throwingWc, destroyedWc, goodWc]);
    const patch: UiStatePatch = { action: 'set_locale', locale: 'zh' };
    expect(() => bridge.applyPatch(patch)).not.toThrow();
    expect(goodReceived).toEqual([patch]);
    expect(destroyedWc.send).not.toHaveBeenCalled();
  });
});

