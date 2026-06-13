/**
 * Tabs 原始组件 —— Radix Tabs 的样式包装。
 */

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/cn.js';

export const Tabs = TabsPrimitive.Root;

/** Tabs 触发按钮列表的容器；通常包裹若干 TabsTrigger。 */
export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  );
});
TabsList.displayName = 'TabsList';

/** 单个 Tab 触发按钮；data-[state=active] 控制活跃外观。 */
export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-transparent px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 data-[state=active]:border-gray-700 data-[state=active]:bg-gray-900 data-[state=active]:text-gray-100',
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = 'TabsTrigger';

/** Tab 对应的内容面板；与同 value 的 TabsTrigger 联动显示/隐藏。 */
export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('focus-visible:outline-none', className)}
      {...props}
    />
  );
});
TabsContent.displayName = 'TabsContent';
