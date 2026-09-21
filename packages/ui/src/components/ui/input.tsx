/**
 * Input 原始组件 —— 受控/非受控均可。
 */

import * as React from 'react';
import { cn } from '../../lib/cn.js';

/** Input props 与原生 input 一致。 */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * 标准化 input；样式与 shadcn dark theme 对齐（暗背景 + 蓝聚焦环）。
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-1 text-sm text-gray-100 placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});

Input.displayName = 'Input';
