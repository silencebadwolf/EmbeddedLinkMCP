import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';
import { Label } from './ui/label.js';
import { SerialPortPicker } from './SerialPortPicker.js';
import { BaudRateInput } from './BaudRateInput.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import { useT } from '../i18n/index.js';
import type { ControlProfilePayload } from '../../shared/preload-api.js';

interface ControlProfilePanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

const COMMON_TARGETS = ['AT32F435RGT7', 'STM32F103C8', 'STM32F407VG', 'STM32H743ZI', 'GD32F303', 'nRF52840'] as const;
const JLINK_SPEED_OPTIONS = ['auto', '50000', '25000', '10000', '8000', '4000', '1000'] as const;
const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-1 text-sm text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** UI entry for humans to save workspace-local control-profile.json. */
export function ControlProfilePanel({
  open,
  onOpenChange,
}: ControlProfilePanelProps): React.ReactElement {
  const t = useT();
  const [root, setRoot] = React.useState('');
  const [serialPort, setSerialPort] = React.useState('');
  const [baudRate, setBaudRate] = React.useState('115200');
  const [serialMode, setSerialMode] = React.useState<'normal' | 'terminal'>('terminal');
  const [target, setTarget] = React.useState('');
  const [debugInterface, setDebugInterface] = React.useState<'swd' | 'jtag'>('swd');
  const [speedKHz, setSpeedKHz] = React.useState<(typeof JLINK_SPEED_OPTIONS)[number]>('auto');
  const [binary, setBinary] = React.useState('build/app.bin');
  const [baseAddress, setBaseAddress] = React.useState('0x08000000');
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const browseWorkspace = async (): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setError(t('controlProfile.error.preloadUnavailable'));
      return;
    }
    const result = await api.controlProfile.pickWorkspaceRoot();
    if (result.success) {
      if (result.data.root !== null) setRoot(result.data.root);
      return;
    }
    setError(result.error.message);
  };

  const browseFirmware = async (): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setError(t('controlProfile.error.preloadUnavailable'));
      return;
    }
    const result = await api.controlProfile.pickFirmwareFile();
    if (result.success) {
      if (result.data.path !== null) setBinary(result.data.path);
      return;
    }
    setError(result.error.message);
  };

  const save = async (): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setError(t('controlProfile.error.preloadUnavailable'));
      return;
    }
    if (!root.trim()) {
      setError(t('controlProfile.error.rootRequired'));
      return;
    }
    if (!serialPort) {
      setError(t('controlProfile.error.serialPortRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const profile: ControlProfilePayload = {
        serial: {
          enabled: true,
          port: serialPort,
          baudRate: Number(baudRate),
          mode: serialMode,
        },
        jlink: {
          enabled: true,
          target,
          interface: debugInterface,
          speedKHz: speedKHz === 'auto' ? 'auto' : Number(speedKHz),
        },
        flash: {
          binary,
          baseAddress,
          verify: true,
        },
        rtt: { enabled: false, channels: [0] },
      };
      const result = await api.controlProfile.save({ root: root.trim(), profile });
      if (result.success) {
        setMessage(`${t('controlProfile.saved')} ${result.data.path}`);
      } else {
        setError(result.error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('controlProfile.title')}</DialogTitle>
          <DialogDescription>{t('controlProfile.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-4 overflow-y-auto py-1 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="control-root">{t('controlProfile.workspaceRoot')}</Label>
            <div className="flex gap-2">
              <Input
                id="control-root"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder={t('controlProfile.workspaceRoot.placeholder')}
              />
              <Button type="button" variant="secondary" onClick={() => void browseWorkspace()}>
                {t('controlProfile.browseWorkspace')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('controlProfile.serialPort')}</Label>
            <SerialPortPicker value={serialPort} onChange={setSerialPort} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="control-baud">{t('controlProfile.baudRate')}</Label>
            <BaudRateInput id="control-baud" value={baudRate} onChange={setBaudRate} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="control-serial-mode">{t('controlProfile.serialMode')}</Label>
            <select
              id="control-serial-mode"
              value={serialMode}
              onChange={(e) => setSerialMode(e.target.value as 'normal' | 'terminal')}
              className={SELECT_CLASS}
            >
              <option value="terminal">{t('dialog.serial.mode.terminal')}</option>
              <option value="normal">{t('dialog.serial.mode.normal')}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="control-interface">{t('controlProfile.debugInterface')}</Label>
            <select
              id="control-interface"
              value={debugInterface}
              onChange={(e) => setDebugInterface(e.target.value as 'swd' | 'jtag')}
              className={SELECT_CLASS}
            >
              <option value="swd">SWD</option>
              <option value="jtag">JTAG</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="control-target">{t('controlProfile.target')}</Label>
            <Input
              id="control-target"
              list="control-target-options"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={t('controlProfile.target.placeholder')}
            />
            <datalist id="control-target-options">
              {COMMON_TARGETS.map((chip) => (
                <option key={chip} value={chip} />
              ))}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label htmlFor="control-speed">{t('controlProfile.jlinkSpeed')}</Label>
            <select
              id="control-speed"
              value={speedKHz}
              onChange={(e) => setSpeedKHz(e.target.value as (typeof JLINK_SPEED_OPTIONS)[number])}
              className={SELECT_CLASS}
            >
              {JLINK_SPEED_OPTIONS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed === 'auto' ? t('controlProfile.jlinkSpeed.auto') : speed}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="control-binary">{t('controlProfile.firmwarePath')}</Label>
            <div className="flex gap-2">
              <Input
                id="control-binary"
                value={binary}
                onChange={(e) => setBinary(e.target.value)}
                placeholder={t('controlProfile.firmwarePath.placeholder')}
              />
              <Button type="button" variant="secondary" onClick={() => void browseFirmware()}>
                {t('controlProfile.browseFirmware')}
              </Button>
            </div>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="control-address">{t('controlProfile.flashBaseAddress')}</Label>
            <Input
              id="control-address"
              value={baseAddress}
              onChange={(e) => setBaseAddress(e.target.value)}
              placeholder="0x08000000"
            />
          </div>
        </div>

        {error ? <p className="rounded border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-100">{error}</p> : null}
        {message ? <p className="rounded border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">{message}</p> : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('controlProfile.close')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? t('controlProfile.saving') : t('controlProfile.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
