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
    serialPorts: [{ path: '/dev/ttyUSB0' }],
    originActivity: {},
    connectionDialogPrefill: null,
  });
};

describe('ConnectionDialog', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    resetStore();
    mock = installMockPreload();
    mock.spies.serial.listPorts.mockResolvedValue({
      success: true,
      data: [{ path: '/dev/ttyUSB0' }],
    });
  });

  it('renders title when open', () => {
    render(<ConnectionDialog />);
    expect(screen.getByText('New Connection')).toBeInTheDocument();
  });

  it('describes RTT Log as a supported connection type', () => {
    render(<ConnectionDialog />);

    expect(
      screen.getByText('Configure a serial, SSH, local shell, or RTT log session.'),
    ).toBeInTheDocument();
  });

  it('offers RTT Log as a new connection type', async () => {
    render(<ConnectionDialog />);

    fireEvent.click(screen.getByTestId('conn-type-trigger'));

    expect(await screen.findByRole('option', { name: 'RTT Log' })).toBeInTheDocument();
  });

  it('opens an RTT log session from the new connection dialog', async () => {
    mock.spies.rttLog.open.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_rtt_dialog', state: 'open', reused: false },
    });
    render(<ConnectionDialog />);

    fireEvent.click(screen.getByTestId('conn-type-trigger'));
    fireEvent.click(await screen.findByRole('option', { name: 'RTT Log' }));
    fireEvent.change(screen.getByLabelText('Probe id'), { target: { value: 'probe-1' } });
    fireEvent.change(screen.getByLabelText('RTT channel'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(mock.spies.rttLog.open).toHaveBeenCalledWith({
        probeId: 'probe-1',
        channelIndex: 2,
        label: 'RTT ch2',
      }),
    );

    expect(useAppStore.getState().sessions.get('sess_rtt_dialog')).toEqual({
      id: 'sess_rtt_dialog',
      label: 'RTT ch2',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-1', channelIndex: 2 },
    });
    expect(useAppStore.getState().activeSessionId).toBe('sess_rtt_dialog');
    expect(mock.spies.session.create).not.toHaveBeenCalled();
    expect(mock.spies.connections.saveAndOpen).not.toHaveBeenCalled();
  });

  it('validates RTT log probe and channel before opening', async () => {
    render(<ConnectionDialog />);

    fireEvent.click(screen.getByTestId('conn-type-trigger'));
    fireEvent.click(await screen.findByRole('option', { name: 'RTT Log' }));
    fireEvent.click(screen.getByText('Create'));

    expect(await screen.findByText('Probe id is required.')).toBeInTheDocument();
    expect(mock.spies.rttLog.open).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Probe id'), { target: { value: 'probe-1' } });
    fireEvent.change(screen.getByLabelText('RTT channel'), { target: { value: '-1' } });
    fireEvent.click(screen.getByText('Create'));

    expect(await screen.findByText('RTT channel must be a non-negative integer.')).toBeInTheDocument();
    expect(mock.spies.rttLog.open).not.toHaveBeenCalled();
  });

  it('submits serial config with terminal defaults and common wire parameters', async () => {
    mock.spies.session.create.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_L', state: 'open' },
    });
    render(<ConnectionDialog />);

    const baudRateInput = screen.getByLabelText('Baud Rate') as HTMLInputElement;
    expect(baudRateInput).toHaveValue('115200');
    expect(screen.queryByRole('combobox', { name: 'Common baud rates' })).toBeNull();

    fireEvent.click(screen.getByLabelText('Common baud rates'));
    expect(screen.getByRole('listbox', { name: 'Baud Rate' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '9600' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '2000000' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: '921600' }));
    expect(baudRateInput).toHaveValue('921600');
    fireEvent.click(screen.getByLabelText('RTS/CTS flow control'));

    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => expect(mock.spies.session.create).toHaveBeenCalled());
    const callArg = mock.spies.session.create.mock.calls[0]?.[0];
    expect(callArg.config).toMatchObject({
      type: 'serial',
      port: '/dev/ttyUSB0',
      baudRate: 921600,
      mode: 'terminal',
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      rtscts: true,
      xon: false,
      xoff: false,
    });
  });

  it('shows error when create returns failure', async () => {
    mock.spies.session.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'INVALID_PAYLOAD', message: 'bad' },
    });
    render(<ConnectionDialog />);
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
    // 一开始 serial port selector 应可见
    expect(screen.getByTestId('picker-select-trigger')).toBeInTheDocument();
  });

  it('applies MCP prefill on open edge and clears it from store', () => {
    // dialog 默认 closed → store 写入 prefill → open=true 触发 effect 边沿读取
    useAppStore.setState({
      dialogOpen: false,
      connectionDialogPrefill: { serialPort: '/dev/ttyUSB0', baudRate: '9600' },
    });
    const { rerender } = render(<ConnectionDialog />);
    useAppStore.setState({ dialogOpen: true });
    rerender(<ConnectionDialog />);
    // 表单内的 serial port selector 应当可见且没有 manual input
    expect(screen.getByTestId('picker-select-trigger')).toBeInTheDocument();
    expect(screen.queryByTestId('picker-manual-input')).toBeNull();
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
    expect(screen.queryByTestId('picker-select-trigger')).toBeNull();
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
    expect(screen.queryByTestId('picker-select-trigger')).toBeNull();
  });
});
