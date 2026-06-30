// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ControlProfilePanel } from '../../../../src/renderer/components/ControlProfilePanel.js';
import { useAppStore } from '../../../../src/renderer/store/app-store.js';
import { installMockPreload, type MockPreloadAPI } from '../../../fixtures/mock-preload-api.js';

const onOpenChange = vi.fn();

function resetStore(): void {
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    locale: 'en',
    dialogOpen: false,
    serialPorts: [{ path: 'COM7', friendlyName: 'USB Serial' }],
    originActivity: {},
    connectionDialogPrefill: null,
  });
}

describe('ControlProfilePanel', () => {
  let mock: MockPreloadAPI;

  beforeEach(() => {
    onOpenChange.mockClear();
    resetStore();
    mock = installMockPreload();
    mock.spies.serial.listPorts.mockResolvedValue({
      success: true,
      data: [{ path: 'COM7', friendlyName: 'USB Serial' }],
    });
  });

  it('saves selected serial and flash/J-Link facts into workspace control profile', async () => {
    mock.spies.controlProfile.pickWorkspaceRoot.mockResolvedValueOnce({ success: true, data: { root: 'C:/repo' } });
    mock.spies.controlProfile.pickFirmwareFile.mockResolvedValueOnce({ success: true, data: { path: 'build/app.bin' } });
    mock.spies.serial.listPorts.mockResolvedValue({
      success: true,
      data: [{ path: 'COM7', friendlyName: 'USB Serial' }],
    });
    mock.spies.controlProfile.save.mockResolvedValueOnce({
      success: true,
      data: {
        path: 'C:/repo/.linkterm/control-profile.json',
        profile: {
          schemaVersion: 'linkterm-control/1.0.0',
          serial: { enabled: true, port: 'COM7', baudRate: 1234567, mode: 'terminal' },
          jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
          flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
        },
      },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
    await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));
    fireEvent.click(screen.getByRole('button', { name: 'Browse firmware' }));
    await waitFor(() => expect(screen.getByLabelText('Firmware path')).toHaveValue('build/app.bin'));

    const baudInput = screen.getByLabelText('Baud rate');
    fireEvent.change(baudInput, { target: { value: '1234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Common baud rates' }));
    expect(await screen.findByRole('option', { name: '921600' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('J-Link device name'), { target: { value: 'AT32F435RGT7' } });
    const speedSelect = screen.getByLabelText('J-Link speed');
    expect(within(speedSelect).getByRole('option', { name: 'Auto (probe maximum)' })).toBeInTheDocument();
    fireEvent.change(speedSelect, { target: { value: 'auto' } });
    fireEvent.change(screen.getByLabelText('Flash base address'), { target: { value: '0x08000000' } });

    await waitFor(() => expect(screen.getByText('COM7 (USB Serial)')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save to workspace' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.save).toHaveBeenCalledWith({
        root: 'C:/repo',
        profile: {
          serial: { enabled: true, port: 'COM7', baudRate: 1234567, mode: 'terminal' },
          jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
          flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
        },
      }),
    );
    expect(await screen.findByText(/Saved:/)).toBeInTheDocument();
  });

  it('saves RTT log observation without requiring a manual probe id', async () => {
    mock.spies.controlProfile.pickWorkspaceRoot.mockResolvedValueOnce({ success: true, data: { root: 'C:/repo' } });
    mock.spies.controlProfile.save.mockResolvedValueOnce({
      success: true,
      data: {
        path: 'C:/repo/.linkterm/control-profile.json',
        profile: {
          schemaVersion: 'linkterm-control/1.0.0',
          jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
          flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
          rtt: { enabled: true },
        },
      },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
    await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));
    fireEvent.change(screen.getByLabelText('Observation channel'), { target: { value: 'rtt' } });
    fireEvent.change(screen.getByLabelText('J-Link device name'), { target: { value: 'AT32F435RGT7' } });
    fireEvent.change(screen.getByLabelText('Flash base address'), { target: { value: '0x08000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to workspace' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.save).toHaveBeenCalledWith({
        root: 'C:/repo',
        profile: {
          jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
          flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
          rtt: { enabled: true },
        },
      }),
    );
    expect(screen.queryByLabelText('Probe id')).toBeNull();
    expect(await screen.findByText(/Saved:/)).toBeInTheDocument();
  });

  it('renders Chinese labels when locale is zh', () => {
    useAppStore.setState({ locale: 'zh' });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    expect(screen.getByText('工作区控制配置')).toBeInTheDocument();
    expect(screen.getByLabelText('工作区目录')).toBeInTheDocument();
    expect(screen.getByLabelText('J-Link 设备名')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存到工作区' })).toBeInTheDocument();
  });

  it('normalizes STM32 order-code targets before saving from the UI', async () => {
    mock.spies.controlProfile.pickWorkspaceRoot.mockResolvedValueOnce({ success: true, data: { root: 'C:/repo' } });
    mock.spies.controlProfile.save.mockResolvedValueOnce({
      success: true,
      data: {
        path: 'C:/repo/.linkterm/control-profile.json',
        profile: {
          schemaVersion: 'linkterm-control/1.0.0',
          serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' },
          jlink: { enabled: true, target: 'STM32H743II', interface: 'swd', speedKHz: 'auto' },
          flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
        },
      },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
    await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));
    fireEvent.change(screen.getByLabelText('J-Link device name'), { target: { value: 'STM32H743IIT6' } });
    await waitFor(() => expect(screen.getByLabelText('J-Link device name')).toHaveValue('STM32H743II'));
    expect(screen.getByText(/STM32H743IIT6/)).toBeInTheDocument();
    expect(screen.getByText(/STM32H743II/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save to workspace' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.save).toHaveBeenCalledWith({
        root: 'C:/repo',
        profile: {
          serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' },
          jlink: { enabled: true, target: 'STM32H743II', interface: 'swd', speedKHz: 'auto' },
          flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
        },
      }),
    );
  });

  it('opens an RTT log terminal session without saving a connection profile', async () => {
    mock.spies.rttLog.open.mockResolvedValueOnce({
      success: true,
      data: { sessionId: 'sess_rtt_ui', state: 'open', reused: false, probeId: 'probe-1', channelIndex: 0 },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
    await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));
    fireEvent.change(screen.getByLabelText('Observation channel'), { target: { value: 'rtt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open RTT log' }));

    await waitFor(() =>
      expect(mock.spies.rttLog.open).toHaveBeenCalledWith({
        root: 'C:/repo',
      }),
    );

    expect(useAppStore.getState().sessions.get('sess_rtt_ui')).toEqual({
      id: 'sess_rtt_ui',
      label: 'RTT ch0',
      connectionType: 'rtt-log',
      state: 'open',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    });
    expect(useAppStore.getState().activeSessionId).toBe('sess_rtt_ui');
    expect(mock.spies.controlProfile.save).not.toHaveBeenCalled();
  });
});
