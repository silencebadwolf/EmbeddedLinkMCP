/**
 * 订阅 MCP `ui_configure` 推送 → dispatch Zustand store action。
 *
 * 启动序：mount 时调用 `linkterm.ui.onStatePatch(handler)`，handler 按 `patch.action`
 * 分派到 store 的对应 action。unmount 时调用 unsubscribe。
 *
 * 在 `App.tsx` 一次性挂载即可（与 `useSerialDiscovery` 同级），不需要挂在 dialog/页面层 ——
 * patch 推送是全局信号，子组件再各自从 store 读取自己关心的字段。
 *
 * 与 transcript subscriber 不同：UI patch 没有"历史快照"概念，纯增量推送，不需要 read+subscribe
 * 复合启动序。
 */

import { useEffect } from 'react';
import { useAppStore } from '../store/app-store.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import type { UiStatePatch } from '../../shared/preload-api.js';

/**
 * Hook：订阅 UI patch 推送并转发到 store。
 *
 * 调用方在根组件 `<App />` 一次性使用；多次挂载会注册多个监听器（preload 不去重，
 * 由 mount/unmount 控制）。
 */
export function useUiPatchSubscription(): void {
  const setLocale = useAppStore((s) => s.setLocale);
  const openDialog = useAppStore((s) => s.openDialog);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const setPrefill = useAppStore((s) => s.setConnectionDialogPrefill);

  useEffect(() => {
    const api = getLinkterm();
    if (!api) return;
    const unsubscribe = api.ui.onStatePatch((patch: UiStatePatch) => {
      switch (patch.action) {
        case 'set_locale':
          setLocale(patch.locale);
          return;
        case 'set_connection_type':
          // 仅写 prefill.type；dialog 当前打开则不会立刻生效（保护用户输入）。
          // 与 useEffect `[open]` 边沿读取的语义对齐。
          setPrefill({ type: patch.type });
          return;
        case 'open_connection_dialog':
          if (patch.prefill !== undefined) {
            setPrefill(patch.prefill);
          } else {
            setPrefill(null);
          }
          openDialog();
          return;
        case 'close_connection_dialog':
          setPrefill(null);
          closeDialog();
          return;
      }
    });
    return () => {
      unsubscribe();
    };
  }, [setLocale, openDialog, closeDialog, setPrefill]);
}
