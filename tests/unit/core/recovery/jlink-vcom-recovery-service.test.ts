import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JLinkVcomRecoveryService } from '@/core/recovery/jlink-vcom-recovery-service.js';
import { ControlProfileManager, ControlProfileRecordManager } from '@/core/workspace/index.js';

describe('JLinkVcomRecoveryService', () => {
  let root: string;
  let manager: ControlProfileManager;
  let recordManager: ControlProfileRecordManager;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lt-vcom-recovery-'));
    manager = new ControlProfileManager();
    recordManager = new ControlProfileRecordManager({
      filePath: path.join(root, 'records.json'),
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('enables VCOM, uniquely identifies the new SEGGER CDC port, updates and opens it', async () => {
    const profile = await manager.init(root, {
      serial: { enabled: true, port: 'COM10', baudRate: 115200, mode: 'terminal' },
      jlink: { enabled: true, target: 'STM32H743II', interface: 'swd' },
    });
    const record = await recordManager.save({ root, source: 'manual', profile });
    const ports = [
      [] as const,
      [
        {
          path: 'COM12',
          friendlyName: 'JLink CDC UART Port',
          vendorId: '1366',
          productId: '0105',
          serialNumber: '123456789',
        },
      ],
    ];
    let scan = 0;
    const setVcomEnabled = vi.fn(async () => ({
      commandAccepted: true as const,
      enabled: true,
      requiresPowerCycle: true as const,
      firmwareUpdateObserved: true,
    }));
    const openSerial = vi.fn(async () => ({ sessionId: 'sess_com12', state: 'open' as const }));
    const service = new JLinkVcomRecoveryService({
      controlProfileManager: manager,
      recordManager,
      serialDiscovery: {
        listPorts: async () => ports[Math.min(scan++, ports.length - 1)]!,
      },
      jlinkBackend: {
        probeDetect: async () => [
          { probeId: 'physical', connected: false, serialNumber: '123456789' },
        ],
      },
      vcomControl: {
        inspectVcom: async () => ({
          supported: true,
          state: 'disabled',
          requiresPowerCycle: true,
          firmwareUpdateObserved: false,
        }),
        setVcomEnabled,
      },
      openSerial,
      pollIntervalMs: 1,
      timeoutMs: 100,
      sleep: async () => undefined,
    });

    const recovered = await service.recover({
      recordId: record.id,
      expectedUpdatedAt: record.updatedAt,
    });

    expect(recovered).toMatchObject({
      status: 'recovered',
      port: 'COM12',
      sessionId: 'sess_com12',
      sessionState: 'open',
      firmwareUpdateObserved: true,
      record: { id: record.id, profile: { serial: { port: 'COM12' } } },
    });
    expect(setVcomEnabled).toHaveBeenCalledWith({ serialNumber: '123456789' }, true);
    expect(openSerial).toHaveBeenCalledWith({
      port: 'COM12',
      baudRate: 115200,
      mode: 'terminal',
      label: record.label,
    });
    await expect(manager.load(root)).resolves.toMatchObject({
      serial: {
        port: 'COM12',
        hardwareIdentity: expect.stringMatching(/^sha256:/u),
      },
    });
  });

  it('requires a physical power cycle when VCOM is enabled but no CDC port exists', async () => {
    const profile = await manager.init(root, {
      serial: { enabled: true, port: 'COM10' },
      jlink: { enabled: true, target: 'STM32H743II', interface: 'swd' },
    });
    const record = await recordManager.save({ root, source: 'manual', profile });
    const setVcomEnabled = vi.fn();
    const openSerial = vi.fn();
    const service = new JLinkVcomRecoveryService({
      controlProfileManager: manager,
      recordManager,
      serialDiscovery: { listPorts: async () => [] },
      jlinkBackend: { probeDetect: async () => [{ probeId: 'physical', connected: false }] },
      vcomControl: {
        inspectVcom: async () => ({
          supported: true,
          state: 'enabled',
          requiresPowerCycle: true,
          firmwareUpdateObserved: false,
        }),
        setVcomEnabled,
      },
      openSerial,
    });

    await expect(
      service.recover({ recordId: record.id, expectedUpdatedAt: record.updatedAt }),
    ).resolves.toMatchObject({ status: 'power-cycle-required', record: { id: record.id } });
    expect(setVcomEnabled).not.toHaveBeenCalled();
    expect(openSerial).not.toHaveBeenCalled();
  });
});
