// @vitest-environment happy-dom
/**
 * SerialPortPicker 单测：只允许从扫描结果选择串口、空列表提示、可读串口名称。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SerialPortPicker } from '@linkterm/ui/components/SerialPortPicker';
import { installMockPreload } from '../../../../tests/fixtures/mock-preload-api.js';
import { useAppStore } from '@linkterm/ui/store/app-store';
import type { SerialPortInfo } from '../../../../src/shared/types.js';

const resetStore = (): void => {
  useAppStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    locale: 'en',
    dialogOpen: false,
    serialPorts: [],
    originActivity: {},
  });
};

const settleSerialDiscovery = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('SerialPortPicker', () => {
  beforeEach(() => {
    resetStore();
    installMockPreload();
  });

  it('shows an empty hint instead of manual input when no ports are available', async () => {
    const onChange = vi.fn();
    render(<SerialPortPicker value="" onChange={onChange} ports={[]} />);
    await settleSerialDiscovery();

    expect(screen.getByTestId('picker-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('picker-manual-input')).toBeNull();
    expect(screen.queryByTestId('picker-mode-manual')).toBeNull();
  });

  it('auto-selects the first discovered port when no value is selected', async () => {
    const onChange = vi.fn();
    const ports: SerialPortInfo[] = [{ path: '/dev/ttyUSB0' }, { path: '/dev/ttyUSB1' }];
    render(<SerialPortPicker value="" onChange={onChange} ports={ports} />);
    await settleSerialDiscovery();

    expect(onChange).toHaveBeenCalledWith('/dev/ttyUSB0');
  });

  it('starts with a selectable port dropdown when ports are available', async () => {
    const onChange = vi.fn();
    const ports: SerialPortInfo[] = [{ path: '/dev/ttyUSB0' }];
    render(<SerialPortPicker value="/dev/ttyUSB0" onChange={onChange} ports={ports} />);
    await settleSerialDiscovery();
    expect(screen.getByTestId('picker-select-trigger')).toBeInTheDocument();
  });

  it('auto refreshes on mount without rendering a refresh or manual button', async () => {
    const mock = installMockPreload();
    render(<SerialPortPicker value="" onChange={() => undefined} />);
    await settleSerialDiscovery();
    expect(mock.spies.serial.listPorts).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('picker-refresh')).toBeNull();
    expect(screen.queryByTestId('picker-mode-manual')).toBeNull();
  });

  it('uses friendlyName in the selectable port label before falling back to manufacturer', async () => {
    const ports: SerialPortInfo[] = [
      { path: 'COM8', manufacturer: 'wch.cn', friendlyName: 'USB-Enhanced-SERIAL CH343 (COM8)' },
      { path: 'COM9', manufacturer: 'FTDI' },
    ];
    render(<SerialPortPicker value="COM8" onChange={() => undefined} ports={ports} />);
    await settleSerialDiscovery();
    expect(screen.getByText('COM8 (USB-Enhanced-SERIAL CH343 (COM8))')).toBeInTheDocument();
  });
});
