/**
 * 新连接对话框：单页表单按 connectionType 切换字段。
 *
 * 安全约束：
 * - SSH 私钥/密码用 `Input type="password"` 收集；提交后立即在状态里清零（即便 React 有
 *   stale closure，gc 之前敏感字段也尽快置空，是 §4.4 / §5.1 的合理兜底）。
 * - 表单 → IPC 入参的转换走 `SessionCreateRequestConfig` 类型（含 SSH credentials），
 *   不再用 `as unknown as AnySessionConfig` 走私凭据。Phase 6 评审 H2 修复。
 */

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
import { FormField } from './ui/form-field.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import { SerialPortPicker } from './SerialPortPicker.js';
import { useAppStore } from '../store/app-store.js';
import { useSessions } from '../hooks/useSession.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import { useT } from '../i18n/index.js';
import type {
  ConnectionType,
  SerialDataBits,
  SerialMode,
  SerialParity,
  SerialStopBits,
} from '../../shared/types.js';
import type {
  NonSensitivePrefill,
  SavedConnectionSummary,
  SessionCreateRequestConfig,
} from '../../shared/preload-api.js';

const COMMON_BAUD_RATES = [
  '9600',
  '19200',
  '38400',
  '57600',
  '115200',
  '230400',
  '460800',
  '921600',
  '1000000',
  '2000000',
] as const;

const DATA_BITS = ['5', '6', '7', '8'] as const;
const STOP_BITS = ['1', '1.5', '2'] as const;
const PARITIES = ['none', 'even', 'odd', 'mark', 'space'] as const;

type FormDataBits = (typeof DATA_BITS)[number];
type FormStopBits = (typeof STOP_BITS)[number];

/** 表单内部使用的连接类型 → SessionConfig 的中间状态。 */
interface FormState {
  type: ConnectionType;
  label: string;
  saveProfile: boolean;
  // serial
  serialPort: string;
  baudRate: string;
  serialMode: SerialMode;
  dataBits: FormDataBits;
  stopBits: FormStopBits;
  parity: SerialParity;
  rtscts: boolean;
  xon: boolean;
  xoff: boolean;
  // ssh
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshAuth: 'password' | 'privateKey';
  sshPassword: string;
  sshPrivateKey: string;
  sshPassphrase: string;
  // local-shell
  localShell: string;
  localCwd: string;
}

const INITIAL_FORM: FormState = {
  type: 'serial',
  label: '',
  saveProfile: false,
  serialPort: '',
  baudRate: '115200',
  serialMode: 'terminal',
  dataBits: '8',
  stopBits: '1',
  parity: 'none',
  rtscts: false,
  xon: false,
  xoff: false,
  sshHost: '',
  sshPort: '22',
  sshUsername: '',
  sshAuth: 'password',
  sshPassword: '',
  sshPrivateKey: '',
  sshPassphrase: '',
  localShell: '',
  localCwd: '',
};

function parseBaudRate(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const baudRate = Number(value.trim());
  return Number.isSafeInteger(baudRate) && baudRate > 0 ? baudRate : null;
}

function parseDataBits(value: FormDataBits): SerialDataBits {
  return Number(value) as SerialDataBits;
}

function parseStopBits(value: FormStopBits): SerialStopBits {
  return Number(value) as SerialStopBits;
}

/**
 * 把表单状态翻译成主进程可接受的 SessionCreateRequestConfig；返回 null 表示必填字段缺失。
 *
 * SSH 分支返回的对象包含 `credentials`（password 或 privateKey）—— 这是 IPC 边界
 * 显式接受的字段，无需 cast；buildSession() 在主进程内立即转入 SshTransport 构造参数
 * 后即被丢弃，不进 SshSessionConfig，不进 transcript。
 */
function buildConfig(form: FormState): SessionCreateRequestConfig | null {
  const label = form.label.trim() || undefined;
  switch (form.type) {
    case 'serial': {
      const port = form.serialPort.trim();
      const baudRate = parseBaudRate(form.baudRate);
      if (!port || baudRate === null) return null;
      return {
        type: 'serial',
        port,
        baudRate,
        mode: form.serialMode,
        dataBits: parseDataBits(form.dataBits),
        stopBits: parseStopBits(form.stopBits),
        parity: form.parity,
        rtscts: form.rtscts,
        xon: form.xon,
        xoff: form.xoff,
        label,
      };
    }
    case 'ssh': {
      const host = form.sshHost.trim();
      const username = form.sshUsername.trim();
      const port = parseInt(form.sshPort, 10) || 22;
      if (!host || !username) return null;
      return {
        type: 'ssh',
        host,
        port,
        username,
        label,
        credentials:
          form.sshAuth === 'password'
            ? { kind: 'password', password: form.sshPassword }
            : {
                kind: 'privateKey',
                privateKey: form.sshPrivateKey,
                passphrase: form.sshPassphrase || undefined,
              },
      };
    }
    case 'local-shell': {
      const shell = form.localShell.trim() || undefined;
      const cwd = form.localCwd.trim() || undefined;
      return {
        type: 'local-shell',
        shell,
        cwd,
        label,
      };
    }
  }
}

/**
 * 当 prefill 未显式提供 `type` 时按其它字段反推：含 ssh* → 'ssh'；含 localShell/localCwd
 * → 'local-shell'；否则 undefined（沿用 INITIAL_FORM.type='serial'）。
 *
 * SSH 优先级高于 local-shell —— SSH 字段（host/port/username）语义更强，AI 客户端推
 * `localCwd` 但留 sshHost 的歧义场景属于无效输入，按 SSH 处理便于早暴露。
 */
function inferType(p: NonSensitivePrefill): ConnectionType | undefined {
  if (p.type) return p.type;
  if (p.sshHost || p.sshPort || p.sshUsername) return 'ssh';
  if (p.localShell || p.localCwd) return 'local-shell';
  return undefined;
}

function defaultProfileLabel(config: SessionCreateRequestConfig): string {
  switch (config.type) {
    case 'serial':
      return `${config.port} · ${config.baudRate}`;
    case 'ssh':
      return `${config.username}@${config.host}:${config.port}`;
    case 'local-shell':
      return config.shell || config.cwd || 'Local shell';
  }
}

function describeProfile(profile: SavedConnectionSummary): string {
  switch (profile.config.type) {
    case 'serial':
      return `${profile.config.port} · ${profile.config.baudRate} · ${profile.config.mode}`;
    case 'ssh':
      return `${profile.config.username}@${profile.config.host}:${profile.config.port}${profile.hasCredential ? ' · credential saved' : ''}`;
    case 'local-shell':
      return [profile.config.shell, profile.config.cwd].filter(Boolean).join(' · ') || 'local shell';
  }
}

/**
 * ConnectionDialog 组件：受控于 store 的 dialogOpen。
 */
export function ConnectionDialog(): React.ReactElement {
  const t = useT();
  const open = useAppStore((s) => s.dialogOpen);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const { create } = useSessions();

  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [savedProfiles, setSavedProfiles] = React.useState<ReadonlyArray<SavedConnectionSummary>>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [baudListOpen, setBaudListOpen] = React.useState(false);

  const loadSavedProfiles = React.useCallback(async (): Promise<void> => {
    const api = getLinkterm();
    if (!api) return;
    const result = await api.connections.list();
    if (result.success) setSavedProfiles(result.data);
  }, []);

  // 关闭对话框时重置表单 + 主动清零敏感字段；
  // 打开时一次性合并 store 中的 MCP prefill（来自 ui_configure），随后立刻 clearPrefill
  // 防止反复关→开时陈旧 prefill 阴魂不散。**依赖列表必须只是 [open]** —— 把 prefill
  // 加入依赖会让 AI 推送中途到来覆盖用户已输入的字段。
  React.useEffect(() => {
    if (!open) {
      setForm(INITIAL_FORM);
      setError(null);
      setSubmitting(false);
      setBaudListOpen(false);
      return;
    }
    void loadSavedProfiles();
    // open === true 边沿：在 effect 内读最新 prefill（避免依赖列表）。
    const prefill = useAppStore.getState().connectionDialogPrefill;
    if (!prefill) return;
    const inferred = inferType(prefill);
    setForm({
      ...INITIAL_FORM,
      ...(inferred !== undefined ? { type: inferred } : {}),
      ...(prefill.label !== undefined ? { label: prefill.label } : {}),
      ...(prefill.serialPort !== undefined ? { serialPort: prefill.serialPort } : {}),
      ...(prefill.baudRate !== undefined ? { baudRate: prefill.baudRate } : {}),
      ...(prefill.serialMode !== undefined ? { serialMode: prefill.serialMode } : {}),
      ...(prefill.sshHost !== undefined ? { sshHost: prefill.sshHost } : {}),
      ...(prefill.sshPort !== undefined ? { sshPort: prefill.sshPort } : {}),
      ...(prefill.sshUsername !== undefined ? { sshUsername: prefill.sshUsername } : {}),
      ...(prefill.sshAuth !== undefined ? { sshAuth: prefill.sshAuth } : {}),
      ...(prefill.localShell !== undefined ? { localShell: prefill.localShell } : {}),
      ...(prefill.localCwd !== undefined ? { localCwd: prefill.localCwd } : {}),
    });
    useAppStore.getState().setConnectionDialogPrefill(null);
  }, [open]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const addCreatedSession = (
    sessionId: string,
    state: 'idle' | 'opening' | 'open' | 'closing' | 'closed' | 'errored',
    profileOrConfig: SavedConnectionSummary | SessionCreateRequestConfig,
    label: string | undefined,
  ): void => {
    useAppStore.getState().addSession({
      id: sessionId,
      label: label || sessionId.slice(-4),
      connectionType: profileOrConfig.type,
      state,
    });
    useAppStore.getState().setActive(sessionId);
  };

  const openSavedProfile = async (profile: SavedConnectionSummary): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      const api = getLinkterm();
      if (!api) {
        setError(t('error.create.failed'));
        return;
      }
      const result = await api.connections.open({ profileId: profile.id });
      if (!result.success) {
        setError(result.error.message || t('error.create.failed'));
        return;
      }
      addCreatedSession(result.data.sessionId, result.data.state, result.data.profile, result.data.profile.label);
      closeDialog();
    } finally {
      setSubmitting(false);
    }
  };

  const deleteSavedProfile = async (profileId: string): Promise<void> => {
    setError(null);
    const api = getLinkterm();
    if (!api) return;
    const result = await api.connections.delete({ profileId });
    if (!result.success) {
      setError(result.error.message || t('error.create.failed'));
      return;
    }
    await loadSavedProfiles();
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const config = buildConfig(form);
    if (!config) {
      setError(t('error.create.failed'));
      return;
    }
    setSubmitting(true);
    try {
      if (form.saveProfile) {
        const api = getLinkterm();
        if (!api) {
          setError(t('error.create.failed'));
          return;
        }
        const result = await api.connections.saveAndOpen({
          config,
          label: form.label.trim() || defaultProfileLabel(config),
          saveCredentials: config.type === 'ssh',
        });
        if (!result.success) {
          setError(result.error.message || t('error.create.failed'));
          return;
        }
        addCreatedSession(
          result.data.sessionId,
          result.data.state,
          result.data.profile,
          result.data.profile.label,
        );
        closeDialog();
        return;
      }

      const id = await create({ config, label: form.label.trim() || undefined });
      // 成功 / open 失败都关闭对话框（open 失败的 errored tab 由 SessionTabBar 处理）
      if (id !== null) {
        closeDialog();
      } else {
        setError(t('error.create.failed'));
      }
    } finally {
      // 立即清零敏感字段（即使下次打开会重置，也尽早摆脱引用）
      setForm((prev) => ({ ...prev, sshPassword: '', sshPrivateKey: '', sshPassphrase: '' }));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3">
          {savedProfiles.length > 0 && (
            <section className="rounded-md border border-gray-800 bg-gray-900/60 p-3">
              <p className="mb-2 text-sm font-medium text-gray-200">
                {t('dialog.saved.title')}
              </p>
              <div className="space-y-2">
                {savedProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className="flex items-center justify-between gap-2 rounded border border-gray-800 px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-gray-100">{profile.label}</p>
                      <p className="truncate text-xs text-gray-500">{describeProfile(profile)}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={submitting}
                        onClick={() => void openSavedProfile(profile)}
                      >
                        {t('dialog.saved.open')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={submitting}
                        onClick={() => void deleteSavedProfile(profile.id)}
                      >
                        {t('dialog.saved.delete')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 连接类型 */}
          <FormField id="conn-type" label={t('dialog.type.label')}>
            <Select
              value={form.type}
              onValueChange={(v) => update('type', v as ConnectionType)}
            >
              <SelectTrigger id="conn-type" data-testid="conn-type-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="serial">{t('dialog.type.serial')}</SelectItem>
                <SelectItem value="ssh">{t('dialog.type.ssh')}</SelectItem>
                <SelectItem value="local-shell">{t('dialog.type.local-shell')}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {/* Label 字段 */}
          <FormField id="conn-label" label={t('dialog.label.label')}>
            <Input
              id="conn-label"
              value={form.label}
              onChange={(e) => update('label', e.target.value)}
              placeholder={t('dialog.label.placeholder')}
            />
          </FormField>

          {/* Serial 字段 */}
          {form.type === 'serial' && (
            <>
              <FormField label={t('dialog.serial.port')}>
                <SerialPortPicker
                  value={form.serialPort}
                  onChange={(v) => update('serialPort', v)}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-2">
                <FormField id="conn-baud" label={t('dialog.serial.baudRate')}>
                  <div className="relative">
                    <Input
                      id="conn-baud"
                      value={form.baudRate}
                      onChange={(e) => update('baudRate', e.target.value)}
                      inputMode="numeric"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      aria-label={t('dialog.serial.commonBaudRates')}
                      aria-expanded={baudListOpen}
                      aria-haspopup="listbox"
                      className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md border-l border-gray-700 text-xs text-gray-300 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={() => setBaudListOpen((prev) => !prev)}
                    >
                      v
                    </button>
                    {baudListOpen && (
                      <div
                        role="listbox"
                        aria-label={t('dialog.serial.baudRate')}
                        className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-700 bg-gray-900 p-1 text-sm text-gray-100 shadow-lg"
                      >
                        {COMMON_BAUD_RATES.map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            role="option"
                            aria-selected={form.baudRate === rate}
                            className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-gray-800 aria-selected:bg-blue-600"
                            onClick={() => {
                              update('baudRate', rate);
                              setBaudListOpen(false);
                            }}
                          >
                            {rate}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </FormField>
                <FormField id="conn-mode" label={t('dialog.serial.mode')}>
                  <Select
                    value={form.serialMode}
                    onValueChange={(v) => update('serialMode', v as SerialMode)}
                  >
                    <SelectTrigger id="conn-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">
                        {t('dialog.serial.mode.normal')}
                      </SelectItem>
                      <SelectItem value="terminal">
                        {t('dialog.serial.mode.terminal')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
              <details className="rounded-md border border-gray-800 p-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-300">
                  {t('dialog.serial.advanced')}
                </summary>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <FormField id="conn-data-bits" label={t('dialog.serial.dataBits')}>
                    <Select
                      value={form.dataBits}
                      onValueChange={(v) => update('dataBits', v as FormDataBits)}
                    >
                      <SelectTrigger id="conn-data-bits">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATA_BITS.map((bits) => (
                          <SelectItem key={bits} value={bits}>{bits}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField id="conn-stop-bits" label={t('dialog.serial.stopBits')}>
                    <Select
                      value={form.stopBits}
                      onValueChange={(v) => update('stopBits', v as FormStopBits)}
                    >
                      <SelectTrigger id="conn-stop-bits">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STOP_BITS.map((bits) => (
                          <SelectItem key={bits} value={bits}>{bits}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField id="conn-parity" label={t('dialog.serial.parity')}>
                    <Select
                      value={form.parity}
                      onValueChange={(v) => update('parity', v as SerialParity)}
                    >
                      <SelectTrigger id="conn-parity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PARITIES.map((parity) => (
                          <SelectItem key={parity} value={parity}>{parity}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-gray-300">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.rtscts}
                      onChange={(e) => update('rtscts', e.target.checked)}
                    />
                    {t('dialog.serial.rtscts')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.xon}
                      onChange={(e) => update('xon', e.target.checked)}
                    />
                    {t('dialog.serial.xon')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.xoff}
                      onChange={(e) => update('xoff', e.target.checked)}
                    />
                    {t('dialog.serial.xoff')}
                  </label>
                </div>
              </details>
            </>
          )}

          {/* SSH 字段 */}
          {form.type === 'ssh' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <FormField id="conn-host" label={t('dialog.ssh.host')} className="col-span-2">
                  <Input
                    id="conn-host"
                    value={form.sshHost}
                    onChange={(e) => update('sshHost', e.target.value)}
                  />
                </FormField>
                <FormField id="conn-ssh-port" label={t('dialog.ssh.port')}>
                  <Input
                    id="conn-ssh-port"
                    value={form.sshPort}
                    onChange={(e) => update('sshPort', e.target.value)}
                    inputMode="numeric"
                  />
                </FormField>
                <FormField id="conn-user" label={t('dialog.ssh.username')}>
                  <Input
                    id="conn-user"
                    value={form.sshUsername}
                    onChange={(e) => update('sshUsername', e.target.value)}
                  />
                </FormField>
              </div>
              <FormField id="conn-auth" label={t('dialog.ssh.auth')}>
                <Select
                  value={form.sshAuth}
                  onValueChange={(v) => update('sshAuth', v as FormState['sshAuth'])}
                >
                  <SelectTrigger id="conn-auth">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="password">
                      {t('dialog.ssh.auth.password')}
                    </SelectItem>
                    <SelectItem value="privateKey">
                      {t('dialog.ssh.auth.privateKey')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              {form.sshAuth === 'password' ? (
                <FormField id="conn-pass" label={t('dialog.ssh.password')}>
                  <Input
                    id="conn-pass"
                    type="password"
                    value={form.sshPassword}
                    onChange={(e) => update('sshPassword', e.target.value)}
                  />
                </FormField>
              ) : (
                <>
                  <FormField id="conn-key" label={t('dialog.ssh.privateKey')}>
                    <Input
                      id="conn-key"
                      type="password"
                      value={form.sshPrivateKey}
                      onChange={(e) => update('sshPrivateKey', e.target.value)}
                    />
                  </FormField>
                  <FormField id="conn-passphrase" label={t('dialog.ssh.passphrase')}>
                    <Input
                      id="conn-passphrase"
                      type="password"
                      value={form.sshPassphrase}
                      onChange={(e) => update('sshPassphrase', e.target.value)}
                    />
                  </FormField>
                </>
              )}
            </>
          )}

          {/* Local Shell 字段 */}
          {form.type === 'local-shell' && (
            <>
              <FormField id="conn-shell" label={t('dialog.local.shell')}>
                <Input
                  id="conn-shell"
                  value={form.localShell}
                  onChange={(e) => update('localShell', e.target.value)}
                  placeholder="/bin/zsh"
                />
              </FormField>
              <FormField id="conn-cwd" label={t('dialog.local.cwd')}>
                <Input
                  id="conn-cwd"
                  value={form.localCwd}
                  onChange={(e) => update('localCwd', e.target.value)}
                />
              </FormField>
            </>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.saveProfile}
              onChange={(e) => update('saveProfile', e.target.checked)}
            />
            {t('dialog.saveProfile')}
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={closeDialog}
              disabled={submitting}
            >
              {t('dialog.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('dialog.creating') : t('dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
