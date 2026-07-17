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
    vi.unstubAllGlobals();
    onOpenChange.mockClear();
    resetStore();
    mock = installMockPreload();
    mock.spies.serial.listPorts.mockResolvedValue({
      success: true,
      data: [{ path: 'COM7', friendlyName: 'USB Serial' }],
    });
  });

  it('offers serial-only and full device workspace setup scopes', () => {
    const onOpenSerialConnection = vi.fn();

    render(
      <ControlProfilePanel
        open
        onOpenChange={onOpenChange}
        onOpenSerialConnection={onOpenSerialConnection}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Serial-only connection' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full device workspace' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace root')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Serial-only connection' }));
    expect(onOpenSerialConnection).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reveals the existing full workspace form only after the full scope is selected', () => {
    render(
      <ControlProfilePanel open onOpenChange={onOpenChange} onOpenSerialConnection={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Full device workspace' }));
    expect(screen.getByLabelText('Workspace root')).toBeInTheDocument();
    expect(screen.getByLabelText('Firmware path')).toBeInTheDocument();
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
          rtt: { enabled: true, controlBlockAddress: '0x24005310' },
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
    fireEvent.change(screen.getByLabelText('RTT control block address'), {
      target: { value: '0x24005310' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to workspace' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.save).toHaveBeenCalledWith({
        root: 'C:/repo',
        profile: {
          jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
          flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
          rtt: { enabled: true, controlBlockAddress: '0x24005310' },
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
        rtt: { enabled: true, controlBlockAddress: '0x24005310' },
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
    expect(screen.getByLabelText('RTT control block address')).toHaveValue('0x24005310');
  });

  it('deletes a saved control profile record from the list', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const record = {
      id: 'ctrl_saved',
      label: 'repo - STM32H743II',
      root: 'C:/repo',
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
        jlink: {
          enabled: true,
          target: 'STM32H743II',
          interface: 'swd' as const,
          speedKHz: 'auto' as const,
        },
        flash: { binary: 'build/rtthread.bin', baseAddress: '0x08008000', verify: true },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({ success: true, data: [record] });
    mock.spies.controlProfile.deleteRecord.mockResolvedValueOnce({
      success: true,
      data: { deleted: true },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    expect(await screen.findByText('repo - STM32H743II')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));

    await waitFor(() =>
      expect(mock.spies.controlProfile.deleteRecord).toHaveBeenCalledWith({
        recordId: 'ctrl_saved',
      }),
    );
    expect(mock.spies.controlProfile.openRecord).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('repo - STM32H743II')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Deleted: repo - STM32H743II');
  });

  it('keeps a saved control profile record when deletion confirmation is cancelled', async () => {
    const record = {
      id: 'ctrl_keep',
      label: 'repo - Keep profile',
      root: 'C:/repo',
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
        jlink: { enabled: false },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({ success: true, data: [record] });
    const confirmDelete = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmDelete);

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    expect(await screen.findByText('repo - Keep profile')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));

    expect(confirmDelete).toHaveBeenCalledOnce();
    expect(mock.spies.controlProfile.deleteRecord).not.toHaveBeenCalled();
    expect(screen.getByText('repo - Keep profile')).toBeInTheDocument();
  });

  it('prevents deleting a second saved record while one deletion is pending', async () => {
    const makeRecord = (id: string, label: string) => ({
      id,
      label,
      root: `C:/repo/${id}`,
      source: 'manual' as const,
      profile: {
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
        jlink: { enabled: false },
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    mock.spies.controlProfile.listRecords.mockResolvedValueOnce({
      success: true,
      data: [makeRecord('ctrl_a', 'Profile A'), makeRecord('ctrl_b', 'Profile B')],
    });
    let finishDelete!: (value: { success: true; data: { deleted: true } }) => void;
    mock.spies.controlProfile.deleteRecord.mockImplementationOnce(
      () => new Promise((resolve) => {
        finishDelete = resolve;
      }),
    );
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    expect(await screen.findByText('Profile A')).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete profile' });
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => expect(mock.spies.controlProfile.deleteRecord).toHaveBeenCalledOnce());

    expect(deleteButtons[1]).toBeDisabled();
    finishDelete({ success: true, data: { deleted: true } });
    await waitFor(() => expect(screen.queryByText('Profile A')).toBeNull());
  });

  it('keeps a saved control profile record visible when deletion fails', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
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
    mock.spies.controlProfile.deleteRecord.mockResolvedValueOnce({
      success: false,
      error: { code: 'CONTROL_PROFILE_RECORD_DELETE_FAILED', message: 'cannot delete record' },
    });

    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    expect(await screen.findByText('repo - STM32H743II')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot delete record');
    expect(screen.getByText('repo - STM32H743II')).toBeInTheDocument();
  });

  it('keeps manual download out of the control profile editor dialog', async () => {
    render(<ControlProfilePanel open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse workspace' }));
    await waitFor(() => expect(screen.getByLabelText('Workspace root')).toHaveValue('C:/repo'));

    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(mock.spies.controlProfile.runDownload).not.toHaveBeenCalled();
  });
});
