// @vitest-environment happy-dom
/**
 * Phase 12 — 边界场景 6：ConnectionDialog 在不同 connectionType 之间的字段处理。
 *
 * 现状：connection-dialog 单测（`tests/unit/renderer/components/ConnectionDialog.test.tsx`）
 * 已经覆盖 prefill / submit / cancel / 字段渲染基础路径，但没有专门验证"用户在 SSH
 * 必填字段空缺时点 Submit 不会调 IPC + 显示错误"以及"通过 prefill 切换类型时字段独立
 * 渲染、互不污染"这两条 PROJECT_REQUIREMENTS §6 场景 6 关键的故事。
 *
 * Radix Select 在 happy-dom 下的下拉列表无法稳定点击（与现有单测 #5 注释一致），所以
 * 类型切换通过 Zustand `connectionDialogPrefill` + dialogOpen 的 effect 边沿来模拟
 * —— 这是实际产品中 MCP `ui_configure({action:'open_connection_dialog', prefill})`
 * 触发的同一路径，覆盖端到端语义。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, type RenderResult } from '@testing-library/react';
import type { NonSensitivePrefill } from '../../src/shared/preload-api.js';
import { ConnectionDialog } from '../../src/renderer/components/ConnectionDialog.js';
import { useAppStore } from '../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../fixtures/mock-preload-api.js';

const resetStore = (): void => {
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    locale: 'en',
    dialogOpen: false,
    serialPorts: [],
    originActivity: {},
    connectionDialogPrefill: null,
  });
};

/**
 * 模拟"AI 通过 ui_configure 打开预填好的 ConnectionDialog"完整仪式：
 * 先把 dialogOpen 置 false 并设置 prefill，render 一次（让 effect 注册），
 * 然后翻转 dialogOpen 为 true 并 rerender —— 这是 ConnectionDialog
 * `useEffect([open])` 边沿触发的唯一稳定路径。
 *
 * @param prefill 要预填的连接表单字段（type 可选，字段缺省走自动推断）
 * @returns testing-library 的 RenderResult，调用方可继续 rerender / 查询
 */
function openDialogWithPrefill(prefill: NonSensitivePrefill): RenderResult {
  useAppStore.setState({ dialogOpen: false, connectionDialogPrefill: prefill });
  const result = render(<ConnectionDialog />);
  useAppStore.setState({ dialogOpen: true });
  result.rerender(<ConnectionDialog />);
  return result;
}

describe('Phase 12 / scenario 6 — connection dialog type switching', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
  });

  it('SSH prefill 渲染 SSH 字段且 host/username 保留（用户已填的内容不丢）', () => {
    openDialogWithPrefill({
      type: 'ssh',
      sshHost: 'example.com',
      sshUsername: 'admin',
      sshPort: '2222',
    });

    // SSH 字段应当渲染并保留 prefill 值
    const host = screen.getByLabelText('Host') as HTMLInputElement;
    const user = screen.getByLabelText('Username') as HTMLInputElement;
    expect(host.value).toBe('example.com');
    expect(user.value).toBe('admin');

    // 用户继续修改 host 字段（模拟在 SSH 模式下手动输入）
    fireEvent.change(host, { target: { value: 'edited.example.com' } });
    expect(host.value).toBe('edited.example.com');

    // 串口字段不应当出现 —— 类型切换的视觉一致性
    expect(screen.queryByPlaceholderText('/dev/tty.usbserial-XXX')).toBeNull();
  });

  it('SSH host 必填字段缺失时点 Submit 不调 session.create 且显示错误', async () => {
    // 用 prefill 进入 SSH 模式但故意留空 sshHost
    openDialogWithPrefill({
      type: 'ssh',
      sshUsername: 'admin', // host 缺失
    });

    const host = screen.getByLabelText('Host') as HTMLInputElement;
    const user = screen.getByLabelText('Username') as HTMLInputElement;
    expect(host.value).toBe(''); // host 没被预填
    expect(user.value).toBe('admin');

    // 点 Submit
    fireEvent.click(screen.getByText('Create'));

    // 关键断言：session.create 完全没被触发（buildConfig 返回 null 早于 IPC）
    expect(mock.spies.session.create).not.toHaveBeenCalled();
    // 错误文案应当可见
    expect(screen.getByText('Failed to create session')).toBeInTheDocument();
    // dialog 仍然 open（不因失败而关闭）—— 通过 DOM 中 role=dialog 仍然存在断言
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('从 SSH prefill 切到 local-shell prefill：旧 SSH 字段不再渲染', () => {
    // 第一次打开：SSH
    const { rerender } = openDialogWithPrefill({
      type: 'ssh',
      sshHost: 'host-A',
      sshUsername: 'user-A',
    });
    expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('host-A');

    // 关闭 → SSH 字段消失（form 被 reset）
    useAppStore.setState({ dialogOpen: false });
    rerender(<ConnectionDialog />);

    // 再开：local-shell prefill —— 复用打开仪式
    useAppStore.setState({
      dialogOpen: false,
      connectionDialogPrefill: { type: 'local-shell', localShell: '/bin/bash' },
    });
    rerender(<ConnectionDialog />);
    useAppStore.setState({ dialogOpen: true });
    rerender(<ConnectionDialog />);

    // local-shell 字段应当渲染，SSH 字段应当消失
    const shell = screen.getByLabelText('Shell (optional)') as HTMLInputElement;
    expect(shell.value).toBe('/bin/bash');
    expect(screen.queryByLabelText('Host')).toBeNull();
    expect(screen.queryByLabelText('Username')).toBeNull();
  });

  it('local-shell 模式下 Submit 走 IPC（无必填字段）', async () => {
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_local', state: 'open' },
    });
    openDialogWithPrefill({ type: 'local-shell', localShell: '/bin/zsh' });

    fireEvent.click(screen.getByText('Create'));

    // IPC 被触发，且 config.type === 'local-shell'
    await waitFor(() => expect(mock.spies.session.create).toHaveBeenCalledTimes(1));
    const callArg = mock.spies.session.create.mock.calls[0]?.[0];
    expect(callArg.config.type).toBe('local-shell');
    expect(callArg.config.shell).toBe('/bin/zsh');
  });
});
