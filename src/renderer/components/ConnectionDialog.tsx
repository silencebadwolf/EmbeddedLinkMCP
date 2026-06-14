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
import { useT } from '../i18n/index.js';
import type { ConnectionType, SerialMode } from '../../shared/types.js';
import type {
  NonSensitivePrefill,
  SessionCreateRequestConfig,
} from '../../shared/preload-api.js';

/** 表单内部使用的连接类型 → SessionConfig 的中间状态。 */
interface FormState {
  type: ConnectionType;
  label: string;
  // serial
  serialPort: string;
  baudRate: string;
  serialMode: SerialMode;
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
  serialPort: '',
  baudRate: '115200',
  serialMode: 'normal',
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
      const baudRate = parseInt(form.baudRate, 10);
      if (!port || !Number.isFinite(baudRate) || baudRate <= 0) return null;
      return {
        type: 'serial',
        port,
        baudRate,
        mode: form.serialMode,
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

/**
 * ConnectionDialog 组件：受控于 store 的 dialogOpen。
 */
export function ConnectionDialog(): React.ReactElement {
  const t = useT();
  const open = useAppStore((s) => s.dialogOpen);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const { create } = useSessions();

  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 关闭对话框时重置表单 + 主动清零敏感字段；
  // 打开时一次性合并 store 中的 MCP prefill（来自 ui_configure），随后立刻 clearPrefill
  // 防止反复关→开时陈旧 prefill 阴魂不散。**依赖列表必须只是 [open]** —— 把 prefill
  // 加入依赖会让 AI 推送中途到来覆盖用户已输入的字段。
  React.useEffect(() => {
    if (!open) {
      setForm(INITIAL_FORM);
      setError(null);
      setSubmitting(false);
      return;
    }
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
                  <Input
                    id="conn-baud"
                    value={form.baudRate}
                    onChange={(e) => update('baudRate', e.target.value)}
                    inputMode="numeric"
                  />
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
