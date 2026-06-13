/**
 * 串口选择器：自动扫描结果 + 手动输入两种模式。
 *
 * 行为（决策 9，详见 docs/phase-decisions/Phase6.md）：
 * - 默认 auto 模式：渲染下拉列表；为空时自动切到 manual 模式
 * - manual 模式：渲染文本输入框，用户自行输入 `/dev/ttyUSB0` / `COM3`
 * - 永远显示 Refresh 按钮（auto 模式下手动触发一次扫描）
 */

import * as React from 'react';
import type { SerialPortInfo } from '../../shared/types.js';
import { useT } from '../i18n/index.js';
import { useSerialDiscovery } from '../hooks/useSerialDiscovery.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js';

/** SerialPortPicker props。 */
export interface SerialPortPickerProps {
  /** 受控值：当前选中的串口路径。 */
  value: string;
  /** 受控变化回调。 */
  onChange(path: string): void;
  /**
   * 测试用注入：直接传入 ports，跳过 useSerialDiscovery 的 IPC 路径。
   * 生产代码不要传此 prop。
   */
  ports?: ReadonlyArray<SerialPortInfo>;
  /** 同上，注入手动 refresh 实现。 */
  refresh?: () => Promise<unknown>;
  className?: string;
}

type PickerMode = 'auto' | 'manual';

/**
 * 串口选择器组件。
 */
export function SerialPortPicker({
  value,
  onChange,
  ports: portsOverride,
  refresh: refreshOverride,
  className,
}: SerialPortPickerProps): React.ReactElement {
  const t = useT();
  const discovery = useSerialDiscovery();
  const ports = portsOverride ?? discovery.ports;
  const refresh = refreshOverride ?? discovery.refresh;

  // 初始模式：扫描结果空 → manual；否则 auto
  const [mode, setMode] = React.useState<PickerMode>(ports.length > 0 ? 'auto' : 'manual');
  // 用户一旦显式点击模式按钮，就不再自动升级（避免点击 manual 后被立刻拉回 auto）
  const userChoseMode = React.useRef(false);

  // 自动从 manual 升级到 auto：当扫描首次出现端口且用户尚未手动输入也未显式选择模式
  React.useEffect(() => {
    if (!userChoseMode.current && mode === 'manual' && ports.length > 0 && !value) {
      setMode('auto');
    }
  }, [mode, ports.length, value]);

  const chooseMode = React.useCallback((next: PickerMode) => {
    userChoseMode.current = true;
    setMode(next);
  }, []);

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-2">
          <Button
            type="button"
            variant={mode === 'auto' ? 'default' : 'outline'}
            size="sm"
            onClick={() => chooseMode('auto')}
            data-testid="picker-mode-auto"
          >
            {t('serial.picker.auto')}
          </Button>
          <Button
            type="button"
            variant={mode === 'manual' ? 'default' : 'outline'}
            size="sm"
            onClick={() => chooseMode('manual')}
            data-testid="picker-mode-manual"
          >
            {t('serial.picker.manual')}
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void refresh();
          }}
          data-testid="picker-refresh"
        >
          {t('serial.picker.refresh')}
        </Button>
      </div>

      <div className="mt-2">
        {mode === 'auto' ? (
          ports.length === 0 ? (
            <p className="text-xs text-gray-400" data-testid="picker-empty">
              {t('serial.picker.empty')}
            </p>
          ) : (
            <Select value={value || undefined} onValueChange={onChange}>
              <SelectTrigger data-testid="picker-select-trigger">
                <SelectValue placeholder={t('serial.picker.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {ports.map((p) => (
                  <SelectItem key={p.path} value={p.path}>
                    {p.path}
                    {p.manufacturer ? ` — ${p.manufacturer}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        ) : (
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('serial.picker.placeholder')}
            data-testid="picker-manual-input"
          />
        )}
      </div>
    </div>
  );
}
