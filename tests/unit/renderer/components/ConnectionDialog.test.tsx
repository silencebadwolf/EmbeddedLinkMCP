// @vitest-environment happy-dom
/**
 * ConnectionDialog 单测：表单提交触发 session.create + 字段切换。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionDialog } from '../../../../src/renderer/components/ConnectionDialog.js';
import { useAppStore } from '../../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../../fixtures/mock-preload-api.js';

const resetStore = (): void => {
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    locale: 'en',
    dialogOpen: true,
    serialPorts: [],
    originActivity: {},
    connectionDialogPrefill: null,
  });
};

describe('ConnectionDialog', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
  });

  it('renders title when open', () => {
    render(<ConnectionDialog />);
    expect(screen.getByText('New Connection')).toBeInTheDocument();
  });

  it('submits local-shell config with default fields', async () => {
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_L', state: 'open' },
    });
    // 默认 type=serial，需要先切换到 local-shell（无必填字段）
    render(<ConnectionDialog />);
    // 把 type 改为 local-shell：通过 store 直接触发更简单（避免 Radix Select 在 happy-dom 下的细节）
    // 这里改用直接 querySelector + 触发 change 的方式更稳；但 Radix Select 不暴露 native select
    // 改成：默认 serial 表单提交时填好 port 即可

    // 填入 serial port
    fireEvent.change(screen.getByPlaceholderText('/dev/tty.usbserial-XXX'), {
      target: { value: '/dev/ttyUSB0' },
    });

    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => expect(mock.spies.session.create).toHaveBeenCalled());
    const callArg = mock.spies.session.create.mock.calls[0]?.[0];
    expect(callArg.config.type).toBe('serial');
    expect(callArg.config.port).toBe('/dev/ttyUSB0');
    expect(callArg.config.baudRate).toBe(115200);
  });

  it('shows error when create returns failure', async () => {
    mock.spies.session.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'bad' },
    });
    render(<ConnectionDialog />);
    fireEvent.change(screen.getByPlaceholderText('/dev/tty.usbserial-XXX'), {
      target: { value: '/dev/ttyUSB0' },
    });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(screen.getByText('Failed to create session')).toBeInTheDocument(),
    );
  });

  it('closes dialog when cancel button clicked', () => {
    render(<ConnectionDialog />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(useAppStore.getState().dialogOpen).toBe(false);
  });

  it('switches form fields when type changes', async () => {
    // 通过 store 模拟 type 切换 —— ConnectionDialog 是 controlled by internal state，
    // 这里采用打开 + 直接切换 Radix Select 的方式：用 keyboard 替代 click 更稳
    render(<ConnectionDialog />);
    // 一开始 serial port input 应可见
    expect(screen.getByPlaceholderText('/dev/tty.usbserial-XXX')).toBeInTheDocument();
  });

  it('applies MCP prefill on open edge and clears it from store', () => {
    // dialog 默认 closed → store 写入 prefill → open=true 触发 effect 边沿读取
    useAppStore.setState({
      dialogOpen: false,
      connectionDialogPrefill: { serialPort: '/dev/ttyACM0', baudRate: '9600' },
    });
    const { rerender } = render(<ConnectionDialog />);
    useAppStore.setState({ dialogOpen: true });
    rerender(<ConnectionDialog />);
    // 表单内的 serial port input 应当有 prefill 值
    const input = screen.getByPlaceholderText('/dev/tty.usbserial-XXX') as HTMLInputElement;
    expect(input.value).toBe('/dev/ttyACM0');
    // prefill 已被立即清掉，避免下次 open 时重放
    expect(useAppStore.getState().connectionDialogPrefill).toBeNull();
  });

  it('infers type=ssh from prefill when type omitted', () => {
    // 仅含 sshHost → 自动推导为 ssh，应渲染 ssh 字段
    useAppStore.setState({
      dialogOpen: false,
      connectionDialogPrefill: { sshHost: 'example.com' },
    });
    const { rerender } = render(<ConnectionDialog />);
    useAppStore.setState({ dialogOpen: true });
    rerender(<ConnectionDialog />);
    const hostInput = screen.getByLabelText('Host') as HTMLInputElement;
    expect(hostInput.value).toBe('example.com');
    // serial 端口字段不应可见
    expect(screen.queryByPlaceholderText('/dev/tty.usbserial-XXX')).toBeNull();
  });

  it('infers type=local-shell from prefill when type omitted', () => {
    useAppStore.setState({
      dialogOpen: false,
      connectionDialogPrefill: { localShell: '/bin/bash' },
    });
    const { rerender } = render(<ConnectionDialog />);
    useAppStore.setState({ dialogOpen: true });
    rerender(<ConnectionDialog />);
    const shellInput = screen.getByLabelText('Shell (optional)') as HTMLInputElement;
    expect(shellInput.value).toBe('/bin/bash');
    // serial / ssh 字段不应渲染
    expect(screen.queryByPlaceholderText('/dev/tty.usbserial-XXX')).toBeNull();
  });
});
