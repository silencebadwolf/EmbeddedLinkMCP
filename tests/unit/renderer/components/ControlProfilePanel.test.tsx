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
    mock.spies.controlProfile.pickWorkspaceRoot.mockResolvedValueOnce({
      success: true,
      data: { root: 'C:/repo' },
    });
    mock.spies.controlProfile.pickFirmwareFile.mockResolvedValueOnce({
      success: true,
      data: { path: 'build/app.bin' },
    });
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
    await waitFor(() =>
      expect(screen.getByLabelText('Firmware path')).toHaveValue('build/app.bin'),
    );

    const baudInput = screen.getByLabelText('Baud rate');
    fireEvent.change(baudInput, { target: { value: '1234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Common baud rates' }));
    expect(await screen.findByRole('option', { name: '921600' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('J-Link device name'), {
      target: { value: 'AT32F435RGT7' },
    });
    const speedSelect = screen.getByLabelText('J-Link speed');
    expect(
      within(speedSelect).getByRole('option', { name: 'Auto (probe maximum)' }),
    ).toBeInTheDocument();
    fireEvent.change(speedSelect, { target: { value: 'auto' } });
    fireEvent.change(screen.getByLabelText('Flash base address'), {
      target: { value: '0x08000000' },
    });

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

  it('applies a detected Intel HEX base address when browsing firmware', async () => {
    mock.spies.controlProfile.pickFirmwareFile.mockResolvedValueOnce({
      success: true,
      data: { path: 'build/app.hex', baseAddress: '0x08008000' },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse firmware' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Firmware path')).toHaveValue('build/app.hex');
      expect(screen.getByLabelText('Flash base address')).toHaveValue('0x08008000');
    });
  });

  it('saves RTT log observation without requiring a manual probe id', async () => {
    mock.spies.controlProfile.pickWorkspaceRoot.mockResolvedValueOnce({
      success: true,
      data: { root: 'C:/repo' },
    });
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
    fireEvent.change(screen.getByLabelText('J-Link device name'), {
      target: { value: 'AT32F435RGT7' },
    });
    fireEvent.change(screen.getByLabelText('Flash base address'), {
      target: { value: '0x08000000' },
    });
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

  it('selects and saves an exact SEGGER catalog device name', async () => {
    mock.spies.controlProfile.pickWorkspaceRoot.mockResolvedValueOnce({
      success: true,
      data: { root: 'C:/repo' },
    });
    mock.spies.jlinkDevices.search.mockResolvedValue({
      success: true,
      data: {
        available: true,
        sourceFiles: ['JLinkDevices.xml'],
        devices: [
          {
            name: '-AT32F435RGT7',
            vendor: 'ArteryTek',
            core: 'JLINK_CORE_CORTEX_M4',
            sourceFile: 'JLinkDevices.xml',
            flashBanks: [],
          },
        ],
      },
    });
    mock.spies.controlProfile.save.mockResolvedValueOnce({
      success: true,
      data: {
        path: 'C:/repo/.linkterm/control-profile.json',
        profile: {
          schemaVersion: 'linkterm-control/1.0.0',
          serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' },
          jlink: { enabled: true, target: '-AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
          flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
        },
      },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
    await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));
    fireEvent.change(screen.getByLabelText('J-Link device name'), {
      target: { value: 'AT32F435' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /-AT32F435RGT7/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save to workspace' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.save).toHaveBeenCalledWith(
        expect.objectContaining({
          root: 'C:/repo',
          profile: expect.objectContaining({
            jlink: expect.objectContaining({ target: '-AT32F435RGT7' }),
          }),
        }),
      ),
    );
  });

  it('requests a broad enough catalog page for MCU family searches', async () => {
    mock.spies.jlinkDevices.search.mockResolvedValue({
      success: true,
      data: { available: true, sourceFiles: ['JLinkDevices.xml'], devices: [] },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText('J-Link device name'), { target: { value: 'STM32' } });

    await waitFor(() =>
      expect(mock.spies.jlinkDevices.search).toHaveBeenCalledWith({ query: 'STM32', limit: 30 }),
    );
  });

  it('allows manual fallback but marks the target as not confirmed by the local catalog', async () => {
    mock.spies.jlinkDevices.search.mockResolvedValue({
      success: true,
      data: { available: true, sourceFiles: ['JLinkDevices.xml'], devices: [] },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText('J-Link device name'), {
      target: { value: 'CUSTOM_DEVICE' },
    });

    expect(
      await screen.findByText(/No matching SEGGER device catalog entry was found/i),
    ).toBeInTheDocument();
  });

  it('does not warn when a normalized STM32 target is found in the SEGGER catalog', async () => {
    mock.spies.controlProfile.pickWorkspaceRoot.mockResolvedValueOnce({
      success: true,
      data: { root: 'C:/repo' },
    });
    mock.spies.jlinkDevices.search.mockResolvedValue({
      success: true,
      data: {
        available: true,
        sourceFiles: ['JLinkDevices.xml'],
        queryNormalization: { originalQuery: 'STM32H743IIT6', normalizedQuery: 'STM32H743II' },
        devices: [
          {
            name: 'STM32H743II',
            vendor: 'ST',
            core: 'JLINK_CORE_CORTEX_M7',
            sourceFile: 'JLinkDevices.xml',
            flashBanks: [],
          },
        ],
      },
    });
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
    fireEvent.change(screen.getByLabelText('J-Link device name'), {
      target: { value: 'STM32H743IIT6' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /STM32H743II/i })).toBeInTheDocument(),
    );

    expect(screen.queryByText(/No matching SEGGER device catalog entry was found/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save to workspace' }));
    await waitFor(() =>
      expect(mock.spies.controlProfile.save).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({
            jlink: expect.objectContaining({ target: 'STM32H743II' }),
          }),
        }),
      ),
    );
  });

  it('does not warn that an STM32 built-in target is missing only because XML/AddOn search has no suggestions', async () => {
    mock.spies.jlinkDevices.search.mockResolvedValue({
      success: true,
      data: {
        available: true,
        sourceFiles: ['JLinkDevices.xml'],
        queryNormalization: { originalQuery: 'STM32H743IIT6', normalizedQuery: 'STM32H743II' },
        devices: [],
      },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText('J-Link device name'), {
      target: { value: 'STM32H743IIT6' },
    });
    expect(await screen.findByText(/using STM32H743II/i)).toBeInTheDocument();

    expect(screen.queryByText(/No matching SEGGER device catalog entry was found/i)).toBeNull();
  });

  it('renders Chinese labels when locale is zh', () => {
    useAppStore.setState({ locale: 'zh' });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    expect(screen.getByText('工作区控制配置')).toBeInTheDocument();
    expect(screen.getByLabelText('工作区目录')).toBeInTheDocument();
    expect(screen.getByLabelText('J-Link 设备名')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存到工作区' })).toBeInTheDocument();
  });

  it('normalizes STM32 order-code targets only when saving manual fallback from the UI', async () => {
    mock.spies.controlProfile.pickWorkspaceRoot.mockResolvedValueOnce({
      success: true,
      data: { root: 'C:/repo' },
    });
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
    fireEvent.change(screen.getByLabelText('J-Link device name'), {
      target: { value: 'STM32H743IIT6' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('J-Link device name')).toHaveValue('STM32H743IIT6'),
    );
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

  it('does not expose RTT log opening while configuring an RTT observation profile', async () => {
    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
    await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));
    fireEvent.change(screen.getByLabelText('Observation channel'), { target: { value: 'rtt' } });

    expect(screen.queryByRole('button', { name: 'Open RTT log' })).not.toBeInTheDocument();
    expect(mock.spies.rttLog.open).not.toHaveBeenCalled();
  });

  it('opens a saved control profile record into the form', async () => {
    const record = {
      id: 'ctrl_saved',
      label: 'repo - STM32H743II',
      root: 'C:/repo',
      source: 'ai' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        rtt: { enabled: true },
        jlink: { enabled: true, target: 'STM32H743II', interface: 'jtag' as const, speedKHz: 4000 },
        flash: { binary: 'build/rtthread.bin', baseAddress: '0x08008000', verify: true },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({ success: true, data: [record] });
    mock.spies.controlProfile.openRecord.mockResolvedValueOnce({
      success: true,
      data: { path: 'C:/repo/.linkterm/control-profile.json', record },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    expect(await screen.findByText('repo - STM32H743II')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open profile' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.openRecord).toHaveBeenCalledWith({ recordId: 'ctrl_saved' }),
    );
    expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo');
    expect(screen.getByLabelText('Observation channel')).toHaveValue('rtt');
    expect(screen.getByLabelText('J-Link device name')).toHaveValue('STM32H743II');
    expect(screen.getByLabelText('Debug interface')).toHaveValue('jtag');
    expect(screen.getByLabelText('J-Link speed')).toHaveValue('4000');
    expect(screen.getByLabelText('Firmware path')).toHaveValue('build/rtthread.bin');
    expect(screen.getByLabelText('Flash base address')).toHaveValue('0x08008000');
  });

  it('runs a manual download from the selected control profile', async () => {
    mock.spies.controlProfile.runDownload.mockResolvedValueOnce({
      success: true,
      data: {
        mode: 'flash-observe',
        root: 'C:/repo',
        steps: [],
        summary: {
          serialOpened: false,
          probeConnected: true,
          gdbServerStarted: false,
          flashed: true,
          verified: true,
          reset: false,
          serialObserved: false,
          debugCaptured: false,
        },
        nextActions: [],
      },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
    await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.runDownload).toHaveBeenCalledWith({ root: 'C:/repo' }),
    );
    expect(await screen.findByText(/Download complete/)).toBeInTheDocument();
  });
});
