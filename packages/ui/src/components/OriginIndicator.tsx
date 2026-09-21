/**
 * 来源指示器：3 个色点（A=AI，H=Human，S=System）按最近活动时间呼吸。
 *
 * 不在 OriginIndicator 内拉取数据 —— 接收 `activity` prop（每来源最近时间戳），
 * 由父组件（SessionTabBar）决定 sessionId 与活动数据来源。
 */

import * as React from 'react';
import type { Origin } from '@linkterm/contracts/types';
import { cn } from '../lib/cn.js';

/** 一个会话每来源最近时间戳。 */
export interface OriginActivity {
  ai?: number;
  human?: number;
  system?: number;
  device?: number;
}

/** OriginIndicator props。 */
export interface OriginIndicatorProps {
  /** 每来源最近活动时间戳（ms）；缺省值视为从未活跃。 */
  activity?: OriginActivity;
  /** 现在的时间戳；测试时可注入固定值，缺省取 Date.now()。 */
  now?: number;
  /** 多久内的活动算"活跃"，超过则显示低透明度。缺省 5_000ms。 */
  recentMs?: number;
  /** 提供时，OriginIndicator 作为 Activity Center 的可激活入口渲染。 */
  activityEntryLabel?: string;
  /** 激活 Activity Center 入口。 */
  onOpenActivity?: () => void;
  className?: string;
}

const DOT_BASE_CLS = 'h-2 w-2 rounded-full';
const COLOR_CLS: Record<'ai' | 'human' | 'system', string> = {
  ai: 'bg-purple-500',
  human: 'bg-cyan-400',
  system: 'bg-gray-400',
};

/**
 * 把"距上次活动毫秒数"映射到透明度：0–recentMs 内逐渐衰减；超出后保持低透明度静止。
 */
function opacityFor(now: number, ts: number | undefined, recentMs: number): number {
  if (ts === undefined) return 0.2;
  const delta = now - ts;
  if (delta < 0) return 1;
  if (delta < recentMs) {
    return 1 - (delta / recentMs) * 0.7;
  }
  return 0.25;
}

/** 渲染单个色点。 */
function OriginDot({
  origin,
  opacity,
  pulse,
}: {
  origin: 'ai' | 'human' | 'system';
  opacity: number;
  pulse: boolean;
}): React.ReactElement {
  return (
    <span
      data-origin={origin}
      className={cn(DOT_BASE_CLS, COLOR_CLS[origin], pulse && 'animate-pulse')}
      style={{ opacity }}
    />
  );
}

/**
 * Origin 指示器组件。
 *
 * @param props 见 {@link OriginIndicatorProps}
 */
export function OriginIndicator({
  activity,
  now,
  recentMs = 5_000,
  activityEntryLabel,
  onOpenActivity,
  className,
}: OriginIndicatorProps): React.ReactElement {
  // 在客户端使用动态 now（每次渲染调用）；测试时通过 prop 注入固定时间确保可断言
  const t = now ?? Date.now();
  const origins: Array<'ai' | 'human' | 'system'> = ['ai', 'human', 'system'];
  const dots = origins.map((o) => {
    const ts = activity?.[o];
    const op = opacityFor(t, ts, recentMs);
    const pulse = ts !== undefined && t - ts < recentMs;
    return <OriginDot key={o} origin={o} opacity={op} pulse={pulse} />;
  });

  if (onOpenActivity !== undefined && activityEntryLabel !== undefined) {
    return (
      <button
        type="button"
        aria-label={activityEntryLabel}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          className,
        )}
        onClick={(event) => {
          event.stopPropagation();
          onOpenActivity();
        }}
      >
        {dots}
      </button>
    );
  }

  return (
    <span
      role="img"
      aria-label="origin-indicator"
      className={cn('inline-flex items-center gap-1', className)}
    >
      {dots}
    </span>
  );
}

/** 测试用导出：把"距活动毫秒数→透明度"算法独立出来便于单测。 */
export const __test__ = { opacityFor };

/** 重新导出共用 origin 类型，避免下游再 import 多处。 */
export type { Origin };
