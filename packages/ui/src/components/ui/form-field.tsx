/**
 * 表单字段包装：label + 子控件 + 可选 hint，统一栅格间距。
 *
 * 抽离自 ConnectionDialog 中重复出现 ≥10 次的 `<div className="grid gap-1.5">…</div>` 模式。
 * 不引入额外依赖，纯样式包装；如未来需要 Error 态可在此一处扩展。
 */

import * as React from 'react';
import { Label } from './label.js';
import { cn } from '../../lib/cn.js';

/** FormField props。 */
export interface FormFieldProps {
  /** Label 与控件 `id` 关联；不传时 Label 不绑定原生 for。 */
  id?: string;
  /** Label 文本。 */
  label?: React.ReactNode;
  /** 子控件（Input / Select 等）。 */
  children: React.ReactNode;
  /** 可选 hint 文本，渲染为浅色小字注释。 */
  hint?: React.ReactNode;
  /** 自定义类名，与默认栅格间距合并。 */
  className?: string;
}

/**
 * 受控表单字段：竖排栅格（label + 控件 + 可选 hint）。
 *
 * @param props 见 {@link FormFieldProps}
 */
export function FormField({
  id,
  label,
  children,
  hint,
  className,
}: FormFieldProps): React.ReactElement {
  return (
    <div className={cn('grid gap-1.5', className)}>
      {label !== undefined && (id !== undefined ? (
        <Label htmlFor={id}>{label}</Label>
      ) : (
        <Label>{label}</Label>
      ))}
      {children}
      {hint !== undefined && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
