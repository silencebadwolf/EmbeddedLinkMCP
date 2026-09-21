/**
 * Button 原始组件 —— shadcn/ui 风格的 6 行版本。
 *
 * 用 `class-variance-authority` 把 variant / size 表达成类型安全的 API。
 * 仅暴露最常用的 variant（default/secondary/ghost/destructive）与 size（default/sm/icon），
 * 当组件迭代需要新 variant 时直接扩 cva 表，不增 prop 数量。
 */

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-blue-600 text-white hover:bg-blue-500',
        secondary: 'bg-gray-800 text-gray-100 hover:bg-gray-700',
        ghost: 'hover:bg-gray-800 hover:text-gray-100',
        destructive: 'bg-red-600 text-white hover:bg-red-500',
        outline: 'border border-gray-700 bg-transparent text-gray-200 hover:bg-gray-800',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/** Button props；继承标准 button 属性 + variant/size 与 asChild。 */
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 用 Radix Slot 渲染为子元素（保留按钮语义但替换 DOM 节点）。 */
  asChild?: boolean;
}

/**
 * shadcn 风格 Button；通过 `asChild` 可把语义包到任意子元素上。
 *
 * @param props 标准 button 属性 + variant/size/asChild
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
});

Button.displayName = 'Button';

export { buttonVariants };
