/**
 * 极简 i18n hook —— 不引入 react-i18next。
 *
 * 设计取舍：仅中英两种 + 键值平铺 + ~30 行实现。后续若需要复数 / 插值更复杂的语义，
 * 在 hook 内部替换实现即可，调用点不变。
 */

import { en, type TranslationKey, type TranslationTable } from './en.js';
import { zh } from './zh.js';
import { useAppStore } from '../store/app-store.js';

/** 支持的语言枚举。`ui_configure` 切换 language 时也接受这些值。 */
export type Locale = 'en' | 'zh';

const TABLES: Record<Locale, TranslationTable> = {
  en,
  zh,
};

/**
 * 获取翻译函数 `t(key)`。
 *
 * 订阅 `useAppStore.locale` —— 切换语言时 React 会自动重新渲染。
 *
 * @returns `t(key: TranslationKey) => string`
 */
export function useT(): (key: TranslationKey) => string {
  const locale = useAppStore((s) => s.locale);
  const table = TABLES[locale] ?? en;
  return (key: TranslationKey): string => table[key] ?? en[key] ?? key;
}

export type { TranslationKey };
