/**
 * Renderer-side Vitest setup。
 *
 * 在 node 环境下也会被加载（vitest 不按 environmentMatchGlobs 过滤 setupFiles），
 * 因此所有 DOM API 的安装都用 `typeof window === 'undefined'` 守卫，避免 node 测试报错。
 *
 * - 注册 jest-dom 自定义匹配器（toBeInTheDocument 等）—— 仅 happy-dom 下生效
 * - 提供 ResizeObserver / Element.scrollIntoView / Element.hasPointerCapture stub
 */

import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

// happy-dom 没有 ResizeObserver；用最小 stub 替代避免组件 mount 报错
class ResizeObserverStub {
  observe(): void {
    /* noop */
  }
  unobserve(): void {
    /* noop */
  }
  disconnect(): void {
    /* noop */
  }
}

if (
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined'
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

// 仅 happy-dom 下打补丁；node 环境无 window
if (typeof window !== 'undefined') {
  const elProto = window.Element.prototype as unknown as Record<string, unknown>;
  if (typeof elProto.hasPointerCapture !== 'function') {
    elProto.hasPointerCapture = function () {
      return false;
    };
  }
  if (typeof elProto.releasePointerCapture !== 'function') {
    elProto.releasePointerCapture = function () {
      return undefined;
    };
  }
  if (typeof elProto.scrollIntoView !== 'function') {
    elProto.scrollIntoView = function () {
      return undefined;
    };
  }
}

afterEach(() => {
  // testing-library cleanup 在无 DOM 环境下也是安全 noop
  if (typeof window !== 'undefined') cleanup();
});
