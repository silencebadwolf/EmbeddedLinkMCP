/**
 * 串口发现 hook：mount 时拉取一次端口列表 + 订阅插拔变化。
 *
 * 主进程 SerialDiscovery 在订阅者出现时自动启动轮询（参见 transports/serial/serial-discovery.ts）。
 * 这里通过 `linkterm.serial.onPortChanged` 订阅，从而触发主进程开始扫描。
 */

import { useCallback, useEffect } from 'react';
import { useAppStore } from '../store/app-store.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import type { SerialPortInfo } from '../../shared/types.js';

/** useSerialDiscovery 暴露：当前端口列表 + 手动刷新函数。 */
export interface UseSerialDiscoveryResult {
  ports: ReadonlyArray<SerialPortInfo>;
  /** 手动触发一次扫描（不影响订阅状态）。 */
  refresh(): Promise<ReadonlyArray<SerialPortInfo>>;
}

/**
 * 订阅串口扫描结果。
 *
 * 注意：renderer 不能在 StrictMode 第一次 mount 时假设 unsubscribe 永远不会被调用 ——
 * 第二次 mount 会重新订阅，subscriber 计数在主进程内自洽。
 */
export function useSerialDiscovery(): UseSerialDiscoveryResult {
  const ports = useAppStore((s) => s.serialPorts);
  const setSerialPorts = useAppStore((s) => s.setSerialPorts);

  const refresh = useCallback(async (): Promise<ReadonlyArray<SerialPortInfo>> => {
    const api = getLinkterm();
    if (!api) return [];
    const result = await api.serial.listPorts();
    if (!result.success) {
      // 主进程返回结构化错误时不污染缓存：保留之前 store 里的 ports，避免端口列表瞬间清空
      return [];
    }
    setSerialPorts(result.data);
    return result.data;
  }, [setSerialPorts]);

  useEffect(() => {
    const api = getLinkterm();
    if (!api) return;
    let cancelled = false;

    // 初次拉一份；与 onPortChanged 推送互不干扰
    void api.serial
      .listPorts()
      .then((result) => {
        if (cancelled) return;
        if (result.success) setSerialPorts(result.data);
      })
      .catch(() => {
        // 主进程未就绪时静默忽略；订阅会在端口变化时补送
      });

    const unsubscribe = api.serial.onPortChanged((next) => {
      if (!cancelled) setSerialPorts(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [setSerialPorts]);

  return { ports, refresh };
}
