import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并多个 className 输入：先 `clsx` 处理条件类名，再 `tailwind-merge` 解决冲突类名。
 *
 * 这是 shadcn/ui 风格组件的标准写法，避免「同时传 `bg-red-500` 和 `bg-blue-500` 时
 * Tailwind 取较晚出现的那条」这种顺序敏感问题。
 *
 * @param inputs 任意 className 输入（字符串、数组、条件对象）
 * @returns 合并后的 className 字符串
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
