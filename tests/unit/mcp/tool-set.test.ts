import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildToolSetDiagnostics, expectedCoreToolNames } from '@/mcp/tool-set.js';

function expectedHash(names: string[]): string {
  return createHash('sha256').update([...new Set(names)].sort().join('\n')).digest('hex');
}

describe('tool-set diagnostics', () => {
  it('deduplicates and sorts registered tool names before hashing', () => {
    const names = ['write_to_session', 'list_sessions', 'write_to_session', 'get_app_status'];

    const diagnostics = buildToolSetDiagnostics(names);

    expect(diagnostics.count).toBe(3);
    expect(diagnostics.hash).toBe(expectedHash(names));
  });

  it('reports the core tool set as complete when every expected tool is registered', () => {
    const expected = expectedCoreToolNames();

    const diagnostics = buildToolSetDiagnostics([...expected].reverse());

    expect(diagnostics.core.expected).toEqual(expected);
    expect(diagnostics.core.complete).toBe(true);
    expect(diagnostics.core.missing).toEqual([]);
    expect(diagnostics.count).toBe(expected.length);
    expect(diagnostics.hash).toBe(expectedHash([...expected]));
  });

  it('includes the RTT log session opener in the core diagnostics contract', () => {
    expect(expectedCoreToolNames()).toContain('open_rtt_log_session');
  });

  it('includes the RTT log session diagnostic in the core diagnostics contract', () => {
    expect(expectedCoreToolNames()).toContain('diagnose_rtt_log_session');
  });

  it('includes the runtime restart recovery tool in the core diagnostics contract', () => {
    expect(expectedCoreToolNames()).toContain('restart_mcp_runtime');
  });

  it('includes the J-Link probe reboot recovery tool in the core diagnostics contract', () => {
    expect(expectedCoreToolNames()).toContain('jlink_reboot');
  });

  it('reports missing core tools by stable name', () => {
    const partial = expectedCoreToolNames().filter(
      (name) => name !== 'run_control_workflow' && name !== 'get_app_status',
    );

    const diagnostics = buildToolSetDiagnostics(partial);

    expect(diagnostics.core.complete).toBe(false);
    expect(diagnostics.core.missing).toEqual(['get_app_status', 'run_control_workflow']);
  });
});
