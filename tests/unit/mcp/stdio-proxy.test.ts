import { describe, expect, it, vi } from 'vitest';
import { forwardRuntimeRequest } from '@/mcp/stdio-proxy.js';

describe('stdio MCP proxy forwarding', () => {
  it('stops the proxy when the owner runtime transport disappears', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const failure = new TypeError('fetch failed');

    await expect(forwardRuntimeRequest(
      async () => {
        throw failure;
      },
      stop,
    )).rejects.toBe(failure);
    await new Promise((resolve) => {
      queueMicrotask(resolve);
    });

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the proxy open for ordinary tool errors', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const failure = new Error('tool validation failed');

    await expect(forwardRuntimeRequest(
      async () => {
        throw failure;
      },
      stop,
    )).rejects.toBe(failure);
    await new Promise((resolve) => {
      queueMicrotask(resolve);
    });

    expect(stop).not.toHaveBeenCalled();
  });
});
