import { describe, expect, it } from 'vitest';
import {
  isMcpStdioMode,
  shouldCreateMainWindow,
  shouldQuitForMissingSingleInstanceLock,
} from '../src/main/startup-mode.js';

describe('startup mode', () => {
  it('treats LINKTERM_MCP_STDIO=1 as MCP stdio mode', () => {
    expect(isMcpStdioMode({ LINKTERM_MCP_STDIO: '1' })).toBe(true);
    expect(isMcpStdioMode({ LINKTERM_MCP_STDIO: '0' })).toBe(false);
  });

  it('does not quit a stdio MCP subprocess when another desktop instance owns the lock', () => {
    expect(
      shouldQuitForMissingSingleInstanceLock({
        hasSingleInstanceLock: false,
        isMcpStdioMode: true,
      }),
    ).toBe(false);
  });

  it('keeps ordinary desktop launches single-instance guarded', () => {
    expect(
      shouldQuitForMissingSingleInstanceLock({
        hasSingleInstanceLock: false,
        isMcpStdioMode: false,
      }),
    ).toBe(true);
  });

  it('creates a window only for ordinary desktop mode', () => {
    expect(
      shouldCreateMainWindow({
        hasSingleInstanceLock: true,
        isMcpStdioMode: false,
      }),
    ).toBe(true);
    expect(
      shouldCreateMainWindow({
        hasSingleInstanceLock: true,
        isMcpStdioMode: true,
      }),
    ).toBe(false);
    expect(
      shouldCreateMainWindow({
        hasSingleInstanceLock: false,
        isMcpStdioMode: true,
      }),
    ).toBe(false);
  });
});
