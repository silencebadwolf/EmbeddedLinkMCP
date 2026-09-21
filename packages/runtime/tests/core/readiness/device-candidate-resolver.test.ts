import { describe, expect, it } from 'vitest';
import { resolveDeviceCandidates } from '@linkterm/runtime/core/readiness/device-candidate-resolver';
import { deriveStableSerialIdentity } from '@linkterm/runtime/core/readiness/serial-identity';

describe('DeviceCandidateResolver', () => {
  it('derives only irreversible hashes from raw USB identity facts', () => {
    const identity = deriveStableSerialIdentity({
      path: 'COM12',
      vendorId: '1366',
      productId: '0105',
      serialNumber: '123456789',
    });

    expect(identity.hardwareIdentity).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(identity.parentIdentity).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(identity)).not.toContain('123456789');
  });

  it('returns no candidates for an empty serial scan', () => {
    expect(resolveDeviceCandidates({ serialPorts: [], savedProfiles: [] })).toEqual([]);
  });

  it('does not treat a single live port as exact without stable identity evidence', () => {
    const candidates = resolveDeviceCandidates({
      serialPorts: [{ path: 'COM7', friendlyName: 'USB Serial Device' }],
      savedProfiles: [],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: 'candidate_serial_COM7',
      kind: 'serial',
      label: 'COM7 · USB Serial Device',
      confidence: 'likely',
      requiresUserConfirmation: true,
      serial: {
        portLabel: 'COM7',
        baudRate: 115_200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
      },
    });
  });

  it('marks stable identity matches from a saved profile as exact', () => {
    const port = {
      path: 'COM7',
      friendlyName: 'USB Serial Device',
      vendorId: '0483',
      productId: '5740',
      serialNumber: 'ABC123',
    };
    const candidates = resolveDeviceCandidates({
      serialPorts: [port],
      savedProfiles: [
        {
          id: 'profile_board_a',
          label: 'board-a',
          ...deriveStableSerialIdentity(port),
          baudRate: 9_600,
        },
      ],
    });

    expect(candidates[0]).toMatchObject({
      confidence: 'exact',
      requiresUserConfirmation: false,
      serial: { baudRate: 9_600 },
    });
    expect(candidates[0]?.evidence.map((item) => item.source)).toEqual([
      'live-discovery',
      'saved-record',
    ]);
  });

  it('marks profile/live conflicts as requiring confirmation', () => {
    const port = {
      path: 'COM7',
      friendlyName: 'USB Serial Device',
      vendorId: '0483',
      productId: '5740',
      serialNumber: 'ABC123',
    };
    const candidates = resolveDeviceCandidates({
      serialPorts: [port],
      savedProfiles: [
        {
          id: 'profile_board_a',
          label: 'board-a',
          ...deriveStableSerialIdentity(port),
          portLabel: 'COM3',
          baudRate: 115_200,
        },
      ],
    });

    expect(candidates[0]).toMatchObject({
      confidence: 'likely',
      requiresUserConfirmation: true,
    });
    expect(
      candidates[0]?.evidence.some((item) => item.summaryCode === 'readiness.profile.conflict'),
    ).toBe(true);
  });

  it('matches a re-enumerated composite J-Link port by parent identity across PID changes', () => {
    const oldPort = {
      path: 'COM7',
      vendorId: '1366',
      productId: '0101',
      serialNumber: '123456789',
    };
    const livePort = {
      path: 'COM7',
      friendlyName: 'JLink CDC UART Port',
      vendorId: '1366',
      productId: '0105',
      serialNumber: '123456789',
    };

    const candidates = resolveDeviceCandidates({
      serialPorts: [livePort],
      savedProfiles: [
        {
          id: 'jlink_profile',
          label: 'J-Link console',
          portLabel: 'COM7',
          baudRate: 115_200,
          ...deriveStableSerialIdentity(oldPort),
        },
      ],
    });

    expect(candidates[0]).toMatchObject({
      confidence: 'exact',
      requiresUserConfirmation: false,
      serial: { baudRate: 115_200 },
    });
  });

  it('keeps same VID/PID multi-device candidates low-confidence without auto-submit hints', () => {
    const candidates = resolveDeviceCandidates({
      serialPorts: [
        { path: 'COM7', friendlyName: 'STLink VCP', vendorId: '0483', productId: '5740' },
        { path: 'COM8', friendlyName: 'STLink VCP', vendorId: '0483', productId: '5740' },
      ],
      savedProfiles: [],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((item) => item.confidence)).toEqual(['unknown', 'unknown']);
    expect(candidates.every((item) => item.requiresUserConfirmation)).toBe(true);
    expect(JSON.stringify(candidates)).not.toMatch(/stm32|target/i);
  });

  it('uses stable candidate ids independent of scan ordering', () => {
    const ports = [
      { path: 'COM8', friendlyName: 'Serial B' },
      { path: 'COM7', friendlyName: 'Serial A' },
    ];

    const first = resolveDeviceCandidates({ serialPorts: ports, savedProfiles: [] });
    const second = resolveDeviceCandidates({
      serialPorts: [...ports].reverse(),
      savedProfiles: [],
    });

    expect(first.map((item) => item.id).sort()).toEqual(second.map((item) => item.id).sort());
  });

  it('sanitizes unix-like paths to display-safe labels', () => {
    const candidates = resolveDeviceCandidates({
      serialPorts: [{ path: '/dev/ttyUSB0', friendlyName: '/dev/ttyUSB0' }],
      savedProfiles: [],
    });

    expect(candidates[0]).toMatchObject({
      id: 'candidate_serial_dev_ttyUSB0',
      label: 'ttyUSB0',
      serial: { portLabel: 'ttyUSB0' },
    });
    expect(JSON.stringify(candidates)).not.toContain('/dev/ttyUSB0');
  });

  it('bounds the final combined candidate label when friendly names are long', () => {
    const friendlyName = `USB ${'Very Long Friendly Name '.repeat(12)}`;
    const candidates = resolveDeviceCandidates({
      serialPorts: [{ path: 'COM42', friendlyName }],
      savedProfiles: [],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.label.length).toBeLessThanOrEqual(128);
    expect(candidates[0]?.serial?.portLabel).toBe('COM42');
    expect(candidates[0]?.evidence[0]?.params).toContainEqual({
      key: 'name',
      value: expect.stringMatching(/^USB Very Long/),
    });
  });
});
