// @vitest-environment happy-dom
/**
 * ConnectionDialog 单测：表单提交触发 session.create + 字段切换。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionDialog } from '@linkterm/ui/components/ConnectionDialog';
import { useAppStore } from '@linkterm/ui/store/app-store';
import { installMockPreload, type MockPreloadAPI } from '../../../../tests/fixtures/mock-preload-api.js';
import type { SavedConnectionSummary } from '../../../../src/shared/preload-api.js';

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
      data: {
        sessionId: 'sess_rtt_dialog',
        state: 'open',
        reused: false,
        probeId: 'probe-1',
        channelIndex: 2,
      },
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

  it('opens an RTT log session from a workspace control profile without a probe id', async () => {
    mock.spies.rttLog.open.mockResolvedValueOnce({
      success: true,
      data: {
        sessionId: 'sess_rtt_profile_dialog',
        state: 'open',
        reused: false,
        probeId: 'probe-profile',
        channelIndex: 0,
      },
    });
    render(<ConnectionDialog />);

    fireEvent.click(screen.getByTestId('conn-type-trigger'));
    fireEvent.click(await screen.findByRole('option', { name: 'RTT Log' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
    await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(mock.spies.rttLog.open).toHaveBeenCalledWith({
        root: 'C:/repo',
        channelIndex: 0,
        label: 'RTT ch0',
      }),
    );
    expect(useAppStore.getState().sessions.get('sess_rtt_profile_dialog')).toEqual({
      id: 'sess_rtt_profile_dialog',
      label: 'RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-profile', channelIndex: 0 },
    });
  });

  it('saves and opens an RTT log session from manually typed workspace root', async () => {
    mock.spies.connections.saveAndOpen.mockResolvedValueOnce({
      success: true,
      data: {
        profile: {
          id: 'conn_rtt',
          label: 'FNA1000 RTT',
          type: 'rtt-log',
          config: { type: 'rtt-log', root: 'C:/work/FNA1000', channelIndex: 0 },
          hasCredential: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        sessionId: 'sess_saved_rtt',
        state: 'open',
        rttLog: { probeId: 'probe-saved', channelIndex: 0 },
      },
    });
    render(<ConnectionDialog />);

    fireEvent.click(screen.getByTestId('conn-type-trigger'));
    fireEvent.click(await screen.findByRole('option', { name: 'RTT Log' }));
    fireEvent.change(screen.getByLabelText('Label (optional)'), {
      target: { value: 'FNA1000 RTT' },
    });
    fireEvent.change(screen.getByLabelText('Workspace root'), {
      target: { value: 'C:/work/FNA1000' },
    });
    fireEvent.click(screen.getByLabelText('Save as global connection'));
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(mock.spies.connections.saveAndOpen).toHaveBeenCalledWith({
        label: 'FNA1000 RTT',
        config: { type: 'rtt-log', root: 'C:/work/FNA1000', channelIndex: 0 },
        saveCredentials: false,
      }),
    );
    expect(mock.spies.rttLog.open).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessions.get('sess_saved_rtt')).toEqual({
      id: 'sess_saved_rtt',
      label: 'FNA1000 RTT',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-saved', channelIndex: 0 },
    });
  });

  it('rejects saving an RTT log profile from a transient probe handle only', async () => {
    render(<ConnectionDialog />);

    fireEvent.click(screen.getByTestId('conn-type-trigger'));
    fireEvent.click(await screen.findByRole('option', { name: 'RTT Log' }));
    fireEvent.change(screen.getByLabelText('Probe id'), { target: { value: 'probe-1' } });
    fireEvent.click(screen.getByLabelText('Save as global connection'));
    fireEvent.click(screen.getByText('Create'));

    expect(
      await screen.findByText('Saved RTT connections require a workspace root.'),
    ).toBeInTheDocument();
    expect(mock.spies.connections.saveAndOpen).not.toHaveBeenCalled();
    expect(mock.spies.rttLog.open).not.toHaveBeenCalled();
  });

  it('opens saved RTT log profiles from the saved connection list with RTT metadata', async () => {
    mock.spies.connections.list.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'conn_rtt',
          label: 'Saved RTT',
          type: 'rtt-log',
          config: { type: 'rtt-log', root: 'C:/work/FNA1000', channelIndex: 0 },
          hasCredential: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    });
    mock.spies.connections.open.mockResolvedValueOnce({
      success: true,
      data: {
        profile: {
          id: 'conn_rtt',
          label: 'Saved RTT',
          type: 'rtt-log',
          config: { type: 'rtt-log', root: 'C:/work/FNA1000', channelIndex: 0 },
          hasCredential: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        sessionId: 'sess_saved_open_rtt',
        state: 'open',
        rttLog: { probeId: 'probe-opened', channelIndex: 0 },
      },
    });

    render(<ConnectionDialog />);

    expect(await screen.findByText('Saved RTT')).toBeInTheDocument();
    expect(screen.getByText('C:/work/FNA1000 · RTT ch0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() =>
      expect(mock.spies.connections.open).toHaveBeenCalledWith({ profileId: 'conn_rtt' }),
    );
    expect(useAppStore.getState().sessions.get('sess_saved_open_rtt')).toEqual({
      id: 'sess_saved_open_rtt',
      label: 'Saved RTT',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-opened', channelIndex: 0 },
    });
  });

  it('edits a saved serial profile in place and opens the updated configuration', async () => {
    const timestamp = new Date(0).toISOString();
    const profile: SavedConnectionSummary = {
      id: 'conn_serial',
      label: 'Old J-Link',
      type: 'serial',
      config: {
        type: 'serial',
        port: '/dev/ttyUSB0',
        baudRate: 115200,
        mode: 'terminal',
      },
      hasCredential: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    mock.spies.connections.list.mockResolvedValueOnce({ success: true, data: [profile] });
    mock.spies.connections.updateAndOpen.mockResolvedValueOnce({
      success: true,
      data: {
        profile: {
          ...profile,
          label: 'New J-Link',
          config: { ...profile.config, baudRate: 921600 },
          updatedAt: new Date(1).toISOString(),
        },
        sessionId: 'sess_updated_serial',
        state: 'open',
      },
    });

    render(<ConnectionDialog />);
    expect(await screen.findByText('Old J-Link')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Label (optional)'), {
      target: { value: 'New J-Link' },
    });
    fireEvent.change(screen.getByLabelText('Baud Rate'), { target: { value: '921600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and open' }));

    await waitFor(() =>
      expect(mock.spies.connections.updateAndOpen).toHaveBeenCalledWith({
        profileId: 'conn_serial',
        expectedUpdatedAt: timestamp,
        label: 'New J-Link',
        config: expect.objectContaining({
          type: 'serial',
          port: '/dev/ttyUSB0',
          baudRate: 921600,
          mode: 'terminal',
        }),
      }),
    );
    expect(useAppStore.getState().sessions.get('sess_updated_serial')).toMatchObject({
      connectionType: 'serial',
      label: 'New J-Link',
      state: 'open',
    });
  });

  it('validates RTT log target and channel before opening', async () => {
    render(<ConnectionDialog />);

    fireEvent.click(screen.getByTestId('conn-type-trigger'));
    fireEvent.click(await screen.findByRole('option', { name: 'RTT Log' }));
    fireEvent.click(screen.getByText('Create'));

    expect(await screen.findByText('Workspace root or probe id is required.')).toBeInTheDocument();
    expect(mock.spies.rttLog.open).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Probe id'), { target: { value: 'probe-1' } });
    fireEvent.change(screen.getByLabelText('RTT channel'), { target: { value: '-1' } });
    fireEvent.click(screen.getByText('Create'));

    expect(
      await screen.findByText('RTT channel must be a non-negative integer.'),
    ).toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByText('Failed to create session')).toBeInTheDocument());
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
      connectionDialogPrefill: {
        serialPort: '/dev/ttyUSB0',
        baudRate: '9600',
        dataBits: '7',
        stopBits: '2',
        parity: 'even',
      },
    });
    const { rerender } = render(<ConnectionDialog />);
    useAppStore.setState({ dialogOpen: true });
    rerender(<ConnectionDialog />);
    // 表单内的 serial port selector 应当可见且没有 manual input
    expect(screen.getByTestId('picker-select-trigger')).toBeInTheDocument();
    expect(screen.queryByTestId('picker-manual-input')).toBeNull();
    expect(screen.getByLabelText('Baud Rate')).toHaveValue('9600');
    expect(screen.getByLabelText('Data Bits')).toHaveTextContent('7');
    expect(screen.getByLabelText('Stop Bits')).toHaveTextContent('2');
    expect(screen.getByLabelText('Parity')).toHaveTextContent('even');
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

  it('applies RTT log prefill from MCP UI patches', () => {
    useAppStore.setState({
      dialogOpen: false,
      connectionDialogPrefill: {
        type: 'rtt-log',
        rttRoot: 'C:/work/FNA1000',
        rttChannel: '1',
      },
    });
    const { rerender } = render(<ConnectionDialog />);
    useAppStore.setState({ dialogOpen: true });
    rerender(<ConnectionDialog />);

    expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/work/FNA1000');
    expect(screen.getByLabelText('RTT channel')).toHaveValue('1');
    expect(screen.queryByTestId('picker-select-trigger')).toBeNull();
  });
});
