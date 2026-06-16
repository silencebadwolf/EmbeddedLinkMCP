/**
 * 串口选择器：只从自动扫描结果中选择串口。
 *
 * 行为（决策 9，详见 docs/phase-decisions/Phase6.md）：
 * - 渲染自动扫描得到的下拉列表；为空时只显示空列表提示
 * - 串口扫描由 useSerialDiscovery 自动执行并订阅热插拔变化，不再提供手动刷新按钮
 */

import * as React from 'react';
import type { SerialPortInfo } from '../../shared/types.js';
import { useT } from '../i18n/index.js';
import { useSerialDiscovery } from '../hooks/useSerialDiscovery.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js';

/** SerialPortPicker props。 */
export interface SerialPortPickerProps {
  /** 受控值：当前选中的串口路径。 */
  value: string;
  /** 受控变化回调。 */
  onChange(path: string): void;
  /**
   * 测试用注入：直接传入 ports，跳过 useSerialDiscovery 的 store 结果。
   * 生产代码不要传此 prop。
   */
  ports?: ReadonlyArray<SerialPortInfo>;
  className?: string;
}

/**
 * 生成串口下拉项显示名称，优先使用系统友好名，回退到厂商名。
 *
 * @param port 串口枚举信息。
 * @returns 用于 UI 显示的可读串口标签。
 */
function formatSerialPortLabel(port: SerialPortInfo): string {
  if (port.friendlyName) return `${port.path} (${port.friendlyName})`;
  if (port.manufacturer) return `${port.path} (${port.manufacturer})`;
  return port.path;
}

/**
 * 串口选择器组件。
 */
export function SerialPortPicker({
  value,
  onChange,
  ports: portsOverride,
  className,
}: SerialPortPickerProps): React.ReactElement {
  const t = useT();
  const discovery = useSerialDiscovery();
  const ports = portsOverride ?? discovery.ports;

  React.useEffect(() => {
    if (!value && ports.length > 0) {
      onChange(ports[0].path);
    }
  }, [onChange, ports, value]);

  return (
    <div className={className}>
      {ports.length === 0 ? (
        <p className="text-xs text-gray-400" data-testid="picker-empty">
          {t('serial.picker.empty')}
        </p>
      ) : (
        <Select value={value || ports[0]?.path} onValueChange={onChange}>
          <SelectTrigger data-testid="picker-select-trigger">
            <SelectValue placeholder={t('serial.picker.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {ports.map((p) => (
              <SelectItem key={p.path} value={p.path}>
                {formatSerialPortLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
