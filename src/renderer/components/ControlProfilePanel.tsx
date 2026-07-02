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
import type {
  ControlProfileFilePayload,
  ControlProfilePayload,
  JLinkDeviceInfoPayload,
  SavedControlProfileRecordPayload,
} from '../../shared/preload-api.js';
import { classifyJLinkTargetName } from '../../shared/jlink-target-name.js';

interface ControlProfilePanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

const JLINK_SPEED_OPTIONS = ['auto', '50000', '25000', '10000', '8000', '4000', '1000'] as const;
const JLINK_DEVICE_SUGGESTION_LIMIT = 30;
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-1 text-sm text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
type ObservationChannel = 'serial' | 'rtt';

/** UI entry for humans to save workspace-local control-profile.json. */
export function ControlProfilePanel({
  open,
  onOpenChange,
}: ControlProfilePanelProps): React.ReactElement {
  const t = useT();
  const [root, setRoot] = React.useState('');
  const [observationChannel, setObservationChannel] = React.useState<ObservationChannel>('serial');
  const [serialPort, setSerialPort] = React.useState('');
  const [baudRate, setBaudRate] = React.useState('115200');
  const [serialMode, setSerialMode] = React.useState<'normal' | 'terminal'>('terminal');
  const [target, setTarget] = React.useState('');
  const [targetQuery, setTargetQuery] = React.useState('');
  const [deviceOptions, setDeviceOptions] = React.useState<ReadonlyArray<JLinkDeviceInfoPayload>>(
    [],
  );
  const [deviceCatalogAvailable, setDeviceCatalogAvailable] = React.useState<boolean | null>(null);
  const [searchingDevices, setSearchingDevices] = React.useState(false);
  const [selectedCatalogTarget, setSelectedCatalogTarget] = React.useState<string | null>(null);
  const [debugInterface, setDebugInterface] = React.useState<'swd' | 'jtag'>('swd');
  const [speedKHz, setSpeedKHz] = React.useState<(typeof JLINK_SPEED_OPTIONS)[number]>('auto');
  const [binary, setBinary] = React.useState('build/app.bin');
  const [baseAddress, setBaseAddress] = React.useState('0x08000000');
  const [saving, setSaving] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [savedRecords, setSavedRecords] = React.useState<
    ReadonlyArray<SavedControlProfileRecordPayload>
  >([]);
  const [openingRecordId, setOpeningRecordId] = React.useState<string | null>(null);
  const [deletingRecordId, setDeletingRecordId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [targetHint, setTargetHint] = React.useState<string | null>(null);
  const deviceSearchSequence = React.useRef(0);

  const loadSavedRecords = React.useCallback(async (): Promise<void> => {
    const api = getLinkterm();
    if (!api) return;
    const result = await api.controlProfile.listRecords();
    if (result.success) {
      setSavedRecords(result.data);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void loadSavedRecords();
  }, [loadSavedRecords, open]);

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
      if (result.data.path !== null) {
        setBinary(result.data.path);
        if (result.data.baseAddress !== undefined) setBaseAddress(result.data.baseAddress);
      }
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
    if (observationChannel === 'serial' && !serialPort) {
      setError(t('controlProfile.error.serialPortRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const normalizedTarget =
        selectedCatalogTarget ?? classifyJLinkTargetName(targetQuery || target).normalizedTarget;
      const profile: ControlProfilePayload = {
        jlink: {
          enabled: true,
          target: normalizedTarget,
          interface: debugInterface,
          speedKHz: speedKHz === 'auto' ? 'auto' : Number(speedKHz),
        },
        flash: {
          binary,
          baseAddress,
          verify: true,
        },
        ...(observationChannel === 'serial'
          ? {
              serial: {
                enabled: true,
                port: serialPort,
                baudRate: Number(baudRate),
                mode: serialMode,
              },
            }
          : {
              rtt: { enabled: true },
            }),
      };
      const result = await api.controlProfile.save({ root: root.trim(), profile });
      if (result.success) {
        if (result.data.record) {
          setSavedRecords((records) => upsertRecord(records, result.data.record!));
        } else {
          void loadSavedRecords();
        }
        setMessage(`${t('controlProfile.saved')} ${result.data.path}`);
      } else {
        setError(result.error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const searchDeviceCatalog = React.useCallback(async (query: string): Promise<void> => {
    const api = getLinkterm();
    const trimmedQuery = query.trim();
    const sequence = deviceSearchSequence.current + 1;
    deviceSearchSequence.current = sequence;

    if (trimmedQuery === '' || !api) {
      setDeviceOptions([]);
      setDeviceCatalogAvailable(null);
      setSearchingDevices(false);
      return;
    }

    setSearchingDevices(true);
    const result = await api.jlinkDevices.search({
      query: trimmedQuery,
      limit: JLINK_DEVICE_SUGGESTION_LIMIT,
    });
    if (deviceSearchSequence.current !== sequence) return;
    setSearchingDevices(false);
    if (result.success) {
      setDeviceCatalogAvailable(result.data.available);
      setDeviceOptions(result.data.devices);
      return;
    }
    setDeviceCatalogAvailable(null);
    setDeviceOptions([]);
  }, []);

  const updateTarget = (value: string): void => {
    const classification = classifyJLinkTargetName(value);
    setTarget(value);
    setTargetQuery(value);
    setSelectedCatalogTarget(null);
    setTargetHint(
      classification.kind === 'stm32-order-code' ? (classification.message ?? null) : null,
    );
    void searchDeviceCatalog(value);
  };

  const selectCatalogDevice = (device: JLinkDeviceInfoPayload): void => {
    deviceSearchSequence.current += 1;
    setTarget(device.name);
    setTargetQuery(device.name);
    setSelectedCatalogTarget(device.name);
    setTargetHint(null);
    setDeviceOptions([]);
  };

  const applyProfileToForm = (recordRoot: string, profile: ControlProfileFilePayload): void => {
    setRoot(recordRoot);
    const nextObservationChannel: ObservationChannel =
      profile.rtt?.enabled === true ? 'rtt' : 'serial';
    setObservationChannel(nextObservationChannel);
    if (profile.serial?.port) setSerialPort(profile.serial.port);
    if (profile.serial?.baudRate !== undefined) setBaudRate(String(profile.serial.baudRate));
    if (profile.serial?.mode) setSerialMode(profile.serial.mode);
    const nextTarget = profile.jlink?.target ?? '';
    setTarget(nextTarget);
    setTargetQuery(nextTarget);
    setSelectedCatalogTarget(nextTarget || null);
    setTargetHint(null);
    setDeviceOptions([]);
    if (profile.jlink?.interface) setDebugInterface(profile.jlink.interface);
    if (profile.jlink?.speedKHz !== undefined)
      setSpeedKHz(String(profile.jlink.speedKHz) as (typeof JLINK_SPEED_OPTIONS)[number]);
    if (profile.flash?.binary) setBinary(profile.flash.binary);
    if (profile.flash?.baseAddress) setBaseAddress(profile.flash.baseAddress);
  };

  const openSavedRecord = async (recordId: string): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setError(t('controlProfile.error.preloadUnavailable'));
      return;
    }
    setOpeningRecordId(recordId);
    setError(null);
    setMessage(null);
    try {
      const result = await api.controlProfile.openRecord({ recordId });
      if (result.success) {
        const record = result.data.record;
        applyProfileToForm(record.root, record.profile);
        setSavedRecords((records) => upsertRecord(records, record));
        setMessage(`${t('controlProfile.record.opened')} ${record.label}`);
      } else {
        setError(result.error.message);
      }
    } finally {
      setOpeningRecordId(null);
    }
  };

  const deleteSavedRecord = async (recordId: string): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setError(t('controlProfile.error.preloadUnavailable'));
      return;
    }
    const record = savedRecords.find((item) => item.id === recordId);
    setDeletingRecordId(recordId);
    setError(null);
    setMessage(null);
    try {
      const result = await api.controlProfile.deleteRecord({ recordId });
      if (result.success) {
        setSavedRecords((records) => records.filter((item) => item.id !== recordId));
        setMessage(`${t('controlProfile.record.deleted')} ${record?.label ?? recordId}`);
      } else {
        setError(result.error.message);
      }
    } finally {
      setDeletingRecordId(null);
    }
  };

  const runDownload = async (): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setError(t('controlProfile.error.preloadUnavailable'));
      return;
    }
    if (!root.trim()) {
      setError(t('controlProfile.error.rootRequired'));
      return;
    }
    setDownloading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.controlProfile.runDownload({ root: root.trim() });
      if (result.success) {
        const flashed = result.data.summary.flashed;
        const verified = result.data.summary.verified;
        setMessage(
          `${t('controlProfile.download.complete')} ${flashed ? t('controlProfile.download.flashed') : ''}${verified ? ` ${t('controlProfile.download.verified')}` : ''}`.trim(),
        );
      } else {
        setError(result.error.message);
      }
    } finally {
      setDownloading(false);
    }
  };

  const showManualTargetWarning =
    deviceCatalogAvailable === true &&
    targetQuery.trim() !== '' &&
    selectedCatalogTarget === null &&
    classifyJLinkTargetName(targetQuery).kind !== 'stm32-order-code' &&
    deviceOptions.length === 0 &&
    !searchingDevices;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('controlProfile.title')}</DialogTitle>
          <DialogDescription>{t('controlProfile.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-4 overflow-y-auto py-1 sm:grid-cols-2">
          {savedRecords.length > 0 ? (
            <section className="space-y-2 rounded-md border border-gray-800 bg-gray-900/60 p-3 sm:col-span-2">
              <h3 className="text-sm font-medium text-gray-200">
                {t('controlProfile.records.title')}
              </h3>
              <div className="space-y-2">
                {savedRecords.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between gap-3 rounded border border-gray-800 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-100">
                        {record.label}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {record.source === 'ai'
                          ? t('controlProfile.record.source.ai')
                          : t('controlProfile.record.source.manual')}{' '}
                        / {record.root}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void openSavedRecord(record.id)}
                        disabled={openingRecordId === record.id || deletingRecordId === record.id}
                      >
                        {openingRecordId === record.id
                          ? t('controlProfile.record.opening')
                          : t('controlProfile.record.open')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void deleteSavedRecord(record.id)}
                        disabled={deletingRecordId === record.id || openingRecordId === record.id}
                      >
                        {deletingRecordId === record.id
                          ? t('controlProfile.record.deleting')
                          : t('controlProfile.record.delete')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

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
            <Label htmlFor="control-observation">{t('controlProfile.observationChannel')}</Label>
            <select
              id="control-observation"
              value={observationChannel}
              onChange={(e) => setObservationChannel(e.target.value as ObservationChannel)}
              className={SELECT_CLASS}
            >
              <option value="serial">{t('controlProfile.observation.serial')}</option>
              <option value="rtt">{t('controlProfile.observation.rtt')}</option>
            </select>
          </div>

          {observationChannel === 'serial' ? (
            <>
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
            </>
          ) : null}

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
              value={target}
              onChange={(e) => updateTarget(e.target.value)}
              placeholder={t('controlProfile.target.placeholder')}
            />
            {searchingDevices ? (
              <p className="text-xs text-gray-400">{t('controlProfile.target.catalogSearching')}</p>
            ) : null}
            {deviceCatalogAvailable === false ? (
              <p className="text-xs text-gray-400">
                {t('controlProfile.target.catalogUnavailable')}
              </p>
            ) : null}
            {deviceOptions.length > 0 ? (
              <div className="max-h-36 overflow-y-auto rounded-md border border-gray-800 bg-gray-900">
                {deviceOptions.map((device) => (
                  <button
                    key={`${device.sourceFile}:${device.name}`}
                    type="button"
                    onClick={() => selectCatalogDevice(device)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-gray-100 hover:bg-gray-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{device.name}</span>
                      <span className="block truncate text-gray-500">
                        {[device.vendor, device.core, ...(device.aliases ?? [])]
                          .filter(Boolean)
                          .join(' / ') || t('controlProfile.target.source')}
                      </span>
                    </span>
                    <span className="shrink-0 text-gray-500">
                      {t('controlProfile.target.source')}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {targetHint ? <p className="text-xs text-amber-300">{targetHint}</p> : null}
            {showManualTargetWarning ? (
              <p className="text-xs text-amber-300">{t('controlProfile.target.manualWarning')}</p>
            ) : null}
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

        {error ? (
          <p className="rounded border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
            {message}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('controlProfile.close')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void runDownload()}
            disabled={downloading}
          >
            {downloading ? t('controlProfile.download.downloading') : t('controlProfile.download')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? t('controlProfile.saving') : t('controlProfile.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function upsertRecord(
  records: ReadonlyArray<SavedControlProfileRecordPayload>,
  next: SavedControlProfileRecordPayload,
): ReadonlyArray<SavedControlProfileRecordPayload> {
  const without = records.filter((record) => record.id !== next.id);
  return [next, ...without].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
