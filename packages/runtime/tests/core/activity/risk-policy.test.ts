import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_TOOL_POLICIES,
  resolveToolObservationPolicy,
  type RedactionProfile,
  type SourceToolSurface,
  type ToolObservationPolicy,
} from '@linkterm/runtime/core/activity/risk-policy';
import { readOwnDataPath } from '@linkterm/runtime/core/activity/safe-observation-value';
import type { ActivitySurface, ApprovalPolicy } from '../../../../../src/shared/activity-contract.js';

const RISK_POLICY_SOURCE = fileURLToPath(
  new URL('../../../src/core/activity/risk-policy.ts', import.meta.url),
);

const FIXED_ACKNOWLEDGEMENT_ACTIONS = [] as const;

const SOURCE_TO_ACTIVITY = {
  'agent-runbook': 'runtime',
  'control-profile': 'control-profile',
  'control-workflow': 'workflow',
  debug: 'debug',
  'jlink-device-catalog': 'debug',
  'rtt-log-session': 'debug',
  'runtime-control': 'runtime',
  terminal: 'terminal',
  ui: 'ui',
  workspace: 'workspace',
  unknown: 'runtime',
} as const satisfies Readonly<Record<SourceToolSurface, ActivitySurface>>;

const RISK_TO_APPROVAL = {
  'read-only': 'none',
  'state-affecting': 'none',
  disruptive: 'none',
  'destructive-or-unknown': 'none',
} as const satisfies Readonly<Record<ToolObservationPolicy['risk'], ApprovalPolicy>>;

const REDACTION_PROFILE_BY_ACTION = {
  activate_control_profile: 'workspace',
  apply_control_profile_answer: 'workspace',
  breakpoint_clear: 'debug-payload',
  breakpoint_list: 'debug-payload',
  breakpoint_set: 'debug-payload',
  cancel_control_workflow_job: 'job',
  cleanup_control_workflow_jobs: 'job',
  close_session: 'session',
  connect_control_profile_chip: 'workspace',
  cpu_halt: 'debug-payload',
  cpu_reset: 'debug-payload',
  cpu_run: 'debug-payload',
  cpu_step: 'debug-payload',
  crash_diagnose: 'debug-payload',
  diagnose_rtt_log_session: 'session',
  disconnect_control_profile_chip: 'workspace',
  discover_serial_ports: 'session',
  flash_download: 'debug-payload',
  flash_erase: 'debug-payload',
  flash_verify: 'debug-payload',
  flash_write: 'debug-payload',
  gdb_server_start: 'debug-payload',
  gdb_server_stop: 'debug-payload',
  get_agent_runbook: 'runtime',
  get_app_status: 'runtime',
  get_control_profile: 'workspace',
  get_control_workflow_job_status: 'job',
  get_session_status: 'session',
  get_workspace_config: 'workspace',
  init_control_profile: 'workspace',
  init_workspace: 'workspace',
  inspect_control_profile: 'workspace',
  jlink_commander_script: 'debug-payload',
  jlink_device_catalog_get: 'probe',
  jlink_device_catalog_search: 'probe',
  jlink_reboot: 'debug-payload',
  list_sessions: 'session',
  memory_read: 'debug-payload',
  memory_write: 'debug-payload',
  open_rtt_log_session: 'session',
  open_session: 'session',
  prepare_control_profile_questions: 'workspace',
  probe_connect: 'debug-payload',
  probe_detect: 'debug-payload',
  probe_disconnect: 'debug-payload',
  probe_status: 'debug-payload',
  read_control_workflow_job: 'job',
  read_from_session: 'session',
  register_list: 'debug-payload',
  register_read: 'debug-payload',
  register_write: 'debug-payload',
  restart_mcp_runtime: 'runtime',
  rtt_clear: 'debug-payload',
  rtt_connect: 'debug-payload',
  rtt_read: 'debug-payload',
  rtt_search: 'debug-payload',
  run_control_workflow: 'workspace',
  send_and_wait: 'session',
  snapshot_capture: 'debug-payload',
  ui_configure: 'ui',
  ui_screenshot: 'ui',
  update_workspace_config: 'workspace',
  write_to_session: 'session',
} as const satisfies Readonly<Record<string, RedactionProfile>>;

if (false) {
  const policy = RUNTIME_TOOL_POLICIES[0];
  // @ts-expect-error acknowledgement discriminants are immutable policy metadata
  policy.acknowledgement.kind = 'none';
}

function unwrapTypeScriptExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function policyRowsFromSource(): readonly ts.ArrayLiteralExpression[] {
  const sourceFile = ts.createSourceFile(
    RISK_POLICY_SOURCE,
    readFileSync(RISK_POLICY_SOURCE, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let declaration: ts.VariableDeclaration | undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === 'POLICY_ROWS',
    );
    if (declaration !== undefined) break;
  }
  if (declaration?.initializer === undefined) throw new Error('POLICY_ROWS declaration not found');

  const rows = unwrapTypeScriptExpression(declaration.initializer);
  if (!ts.isArrayLiteralExpression(rows)) throw new Error('POLICY_ROWS must be an array literal');
  return rows.elements.map((element, index) => {
    const row = unwrapTypeScriptExpression(element);
    if (!ts.isArrayLiteralExpression(row)) throw new Error(`POLICY_ROWS[${index}] must be a tuple`);
    return row;
  });
}

function requiredTupleString(row: ts.ArrayLiteralExpression, index: number): string {
  const value = unwrapTypeScriptExpression(row.elements[index]);
  if (!ts.isStringLiteralLike(value)) throw new Error(`tuple column ${index} must be a string`);
  return value.text;
}

function policyFor(action: string): ToolObservationPolicy {
  const policy = RUNTIME_TOOL_POLICIES.find((candidate) => candidate.action === action);
  if (policy === undefined) throw new Error(`missing test policy: ${action}`);
  return policy;
}

function resolveKnown(action: string, rawArgs: unknown) {
  return resolveToolObservationPolicy({
    action,
    declaredSensitivity: policyFor(action).sensitivity,
    rawArgs,
  });
}

function countingProxy<T extends object>(
  target: T,
): {
  readonly proxy: T;
  readonly trapCount: () => number;
} {
  let count = 0;
  const proxy = new Proxy(target, {
    get(current, key, receiver) {
      count += 1;
      return Reflect.get(current, key, receiver);
    },
    getOwnPropertyDescriptor(current, key) {
      count += 1;
      return Reflect.getOwnPropertyDescriptor(current, key);
    },
    getPrototypeOf(current) {
      count += 1;
      return Reflect.getPrototypeOf(current);
    },
    ownKeys(current) {
      count += 1;
      return Reflect.ownKeys(current);
    },
  });
  return { proxy, trapCount: () => count };
}

describe('runtime tool observation policy', () => {
  it('declares exactly 63 six-column policy tuples with explicit reviewed redaction profiles', () => {
    const rows = policyRowsFromSource();

    expect(rows).toHaveLength(63);
    for (const [index, row] of rows.entries()) {
      expect(row.elements, `POLICY_ROWS[${index}]`).toHaveLength(6);
    }
    expect(
      Object.fromEntries(
        rows.map((row) => [requiredTupleString(row, 0), requiredTupleString(row, 5)]),
      ),
    ).toEqual(REDACTION_PROFILE_BY_ACTION);
  });

  it('contains exactly 63 sorted unique reviewed actions with the expected risk totals', () => {
    const actions = RUNTIME_TOOL_POLICIES.map((policy) => policy.action);

    expect(RUNTIME_TOOL_POLICIES).toHaveLength(63);
    expect(new Set(actions).size).toBe(63);
    expect(actions).toEqual([...actions].sort());
    expect(RUNTIME_TOOL_POLICIES.filter((policy) => policy.risk === 'read-only')).toHaveLength(25);
    expect(
      RUNTIME_TOOL_POLICIES.filter((policy) => policy.risk === 'state-affecting'),
    ).toHaveLength(20);
    expect(RUNTIME_TOOL_POLICIES.filter((policy) => policy.risk === 'disruptive')).toHaveLength(12);
    expect(
      RUNTIME_TOOL_POLICIES.filter((policy) => policy.risk === 'destructive-or-unknown'),
    ).toHaveLength(6);
  });

  it('maps every reviewed source surface to its exact activity surface', () => {
    const reviewedSources = new Set(RUNTIME_TOOL_POLICIES.map((policy) => policy.sourceSurface));

    expect([...reviewedSources].sort()).toEqual(
      Object.keys(SOURCE_TO_ACTIVITY)
        .filter((source) => source !== 'unknown')
        .sort(),
    );
    for (const policy of RUNTIME_TOOL_POLICIES) {
      expect(policy.surface, policy.action).toBe(SOURCE_TO_ACTIVITY[policy.sourceSurface]);
    }

    const fallback = resolveToolObservationPolicy({
      action: 'future_tool',
      declaredSensitivity: 'read-only',
      rawArgs: {},
    });
    expect({ sourceSurface: fallback.sourceSurface, surface: fallback.surface }).toEqual({
      sourceSurface: 'unknown',
      surface: SOURCE_TO_ACTIVITY.unknown,
    });
  });

  it('maps every risk to descriptive approval metadata without granting authorization', () => {
    expect(new Set(RUNTIME_TOOL_POLICIES.map((policy) => policy.risk))).toEqual(
      new Set(Object.keys(RISK_TO_APPROVAL)),
    );
    for (const policy of RUNTIME_TOOL_POLICIES) {
      expect(policy.approvalPolicy, policy.action).toBe(RISK_TO_APPROVAL[policy.risk]);
    }
  });

  it('assigns the explicit reviewed redaction profile for every action', () => {
    expect(Object.keys(REDACTION_PROFILE_BY_ACTION)).toEqual(
      RUNTIME_TOOL_POLICIES.map((policy) => policy.action),
    );
    for (const policy of RUNTIME_TOOL_POLICIES) {
      expect(policy.redactionProfile, policy.action).toBe(
        REDACTION_PROFILE_BY_ACTION[policy.action as keyof typeof REDACTION_PROFILE_BY_ACTION],
      );
    }
  });

  it('assigns no client acknowledgement requirements', () => {
    expect(
      RUNTIME_TOOL_POLICIES.filter(
        (policy) => policy.acknowledgement.kind === 'client-acknowledgement-required',
      ).map((policy) => policy.action),
    ).toEqual([...FIXED_ACKNOWLEDGEMENT_ACTIONS]);
    expect(
      RUNTIME_TOOL_POLICIES.filter(
        (policy) => policy.acknowledgement.kind === 'conditional-client-acknowledgement',
      ).map((policy) => policy.action),
    ).toEqual([]);
    expect(
      RUNTIME_TOOL_POLICIES.filter((policy) => policy.acknowledgement.kind === 'none'),
    ).toHaveLength(RUNTIME_TOOL_POLICIES.length);
  });

  it.each(FIXED_ACKNOWLEDGEMENT_ACTIONS)(
    'accepts legacy confirm values for fixed acknowledgement action %s',
    (action) => {
      expect(resolveKnown(action, {}).missingCurrentAcknowledgement).toBe(false);
      expect(resolveKnown(action, { confirm: false }).missingCurrentAcknowledgement).toBe(false);
      expect(resolveKnown(action, { confirm: true }).missingCurrentAcknowledgement).toBe(false);
    },
  );

  it.each(['debug-diagnose', 'flash-observe', 'flash-observe-diagnose'])(
    'executes without conditional acknowledgement for mode %s',
    (mode) => {
      expect(resolveKnown('run_control_workflow', { mode }).missingCurrentAcknowledgement).toBe(false);
      expect(
        resolveKnown('run_control_workflow', { mode, confirm: true }).missingCurrentAcknowledgement,
      ).toBe(false);
      expect(
        resolveKnown('run_control_workflow', { mode, dryRun: true }).missingCurrentAcknowledgement,
      ).toBe(false);
    },
  );

  it('ignores legacy dry-run and nested halt-on-failure acknowledgement fields', () => {
    expect(
      resolveKnown('run_control_workflow', {
        mode: 'observe',
        debug: { haltOnFailure: true },
      }).missingCurrentAcknowledgement,
    ).toBe(false);
    expect(
      resolveKnown('run_control_workflow', {
        mode: 'observe',
        debug: { haltOnFailure: false },
      }).missingCurrentAcknowledgement,
    ).toBe(false);
    expect(
      resolveKnown('run_control_workflow', {
        mode: 'debug-diagnose',
        dryRun: 'true',
      }).missingCurrentAcknowledgement,
    ).toBe(false);
    expect(
      resolveKnown('run_control_workflow', {
        mode: 'debug-diagnose',
        dryRun: true,
        debug: { haltOnFailure: true },
      }).missingCurrentAcknowledgement,
    ).toBe(false);
  });

  it('fails closed with a diagnostic for valid and invalid unreviewed actions', () => {
    const valid = resolveToolObservationPolicy({
      action: 'Vendor.tool:1',
      declaredSensitivity: 'read-only',
      rawArgs: { confirm: true },
    });
    const invalid = resolveToolObservationPolicy({
      action: 'invalid tool/name',
      declaredSensitivity: 'state-affecting',
      rawArgs: { confirm: true },
    });

    expect(valid).toEqual({
      action: 'Vendor.tool:1',
      sourceSurface: 'unknown',
      surface: 'runtime',
      sensitivity: 'read-only',
      risk: 'destructive-or-unknown',
      approvalPolicy: 'none',
      acknowledgement: { kind: 'none' },
      redactionProfile: 'metadata-only',
      missingCurrentAcknowledgement: false,
      hasDiagnostic: true,
    });
    expect(invalid).toEqual({
      ...valid,
      action: 'unknown-tool',
      sensitivity: 'state-affecting',
    });
  });

  it('fails closed on known-action sensitivity drift while retaining reviewed surface metadata', () => {
    expect(
      resolveToolObservationPolicy({
        action: 'get_app_status',
        declaredSensitivity: 'state-affecting',
        rawArgs: { confirm: true },
      }),
    ).toEqual({
      action: 'get_app_status',
      sourceSurface: 'agent-runbook',
      surface: 'runtime',
      sensitivity: 'state-affecting',
      risk: 'destructive-or-unknown',
      approvalPolicy: 'none',
      acknowledgement: { kind: 'none' },
      redactionProfile: 'metadata-only',
      missingCurrentAcknowledgement: false,
      hasDiagnostic: true,
    });
  });

  it('freezes the table, every entry and acknowledgement, and every resolver output', () => {
    expect(Object.isFrozen(RUNTIME_TOOL_POLICIES)).toBe(true);
    for (const policy of RUNTIME_TOOL_POLICIES) {
      expect(Object.isFrozen(policy), policy.action).toBe(true);
      expect(Object.isFrozen(policy.acknowledgement), policy.action).toBe(true);
    }

    const outputs = [
      resolveKnown('get_app_status', {}),
      resolveKnown('run_control_workflow', { mode: 'debug-diagnose' }),
      resolveToolObservationPolicy({
        action: 'future_tool',
        declaredSensitivity: 'read-only',
        rawArgs: {},
      }),
      resolveToolObservationPolicy({
        action: 'get_app_status',
        declaredSensitivity: 'state-affecting',
        rawArgs: {},
      }),
    ];
    for (const output of outputs) {
      expect(Object.isFrozen(output)).toBe(true);
      expect(Object.isFrozen(output.acknowledgement)).toBe(true);
    }
  });
});

describe('readOwnDataPath', () => {
  it('reads only plain-object own data descriptors', () => {
    expect(readOwnDataPath({ confirm: true }, ['confirm'])).toBe(true);
    expect(readOwnDataPath({ debug: { haltOnFailure: false } }, ['debug', 'haltOnFailure'])).toBe(
      false,
    );
    expect(readOwnDataPath(Object.create(null), [])).toEqual(Object.create(null));
  });

  it('rejects missing, primitive, null, array, class, and custom-prototype traversal', () => {
    class Args {
      confirm = true;
    }
    const custom = Object.create({ confirm: true }) as { confirm?: boolean };

    expect(readOwnDataPath({}, ['missing'])).toBeUndefined();
    expect(readOwnDataPath(null, ['confirm'])).toBeUndefined();
    expect(readOwnDataPath('value', ['length'])).toBeUndefined();
    expect(readOwnDataPath([{ confirm: true }], ['0', 'confirm'])).toBeUndefined();
    expect(readOwnDataPath(new Args(), ['confirm'])).toBeUndefined();
    expect(readOwnDataPath(custom, ['confirm'])).toBeUndefined();
    expect(readOwnDataPath({ nested: null }, ['nested', 'confirm'])).toBeUndefined();
  });

  it('rejects top-level, nested, and final-leaf proxies without triggering traps', () => {
    const top = countingProxy({ confirm: true });
    const nested = countingProxy({ haltOnFailure: true });
    const leaf = countingProxy({ secret: true });

    expect(readOwnDataPath(top.proxy, ['confirm'])).toBeUndefined();
    expect(readOwnDataPath({ debug: nested.proxy }, ['debug', 'haltOnFailure'])).toBeUndefined();
    expect(readOwnDataPath({ confirm: leaf.proxy }, ['confirm'])).toBeUndefined();
    expect(top.trapCount()).toBe(0);
    expect(nested.trapCount()).toBe(0);
    expect(leaf.trapCount()).toBe(0);
  });

  it('rejects accessor descriptors at every depth without invoking getters', () => {
    let topGetterCount = 0;
    let nestedGetterCount = 0;
    let leafGetterCount = 0;
    const top: Record<string, unknown> = {};
    const nestedRoot: Record<string, unknown> = {};
    const leaf: Record<string, unknown> = {};
    Object.defineProperty(top, 'confirm', {
      get() {
        topGetterCount += 1;
        return true;
      },
    });
    Object.defineProperty(nestedRoot, 'debug', {
      get() {
        nestedGetterCount += 1;
        return { haltOnFailure: true };
      },
    });
    Object.defineProperty(leaf, 'haltOnFailure', {
      get() {
        leafGetterCount += 1;
        return true;
      },
    });

    expect(readOwnDataPath(top, ['confirm'])).toBeUndefined();
    expect(readOwnDataPath(nestedRoot, ['debug', 'haltOnFailure'])).toBeUndefined();
    expect(readOwnDataPath({ debug: leaf }, ['debug', 'haltOnFailure'])).toBeUndefined();
    expect({ topGetterCount, nestedGetterCount, leafGetterCount }).toEqual({
      topGetterCount: 0,
      nestedGetterCount: 0,
      leafGetterCount: 0,
    });
  });
});

describe('safe observation reads through the resolver', () => {
  it('does not trigger top-level, nested, or final-leaf proxy traps and fails closed when needed', () => {
    const top = countingProxy({ confirm: true });
    const nested = countingProxy({ haltOnFailure: true });
    const leaf = countingProxy({ supplied: true });

    expect(resolveKnown('cpu_reset', top.proxy).missingCurrentAcknowledgement).toBe(false);
    expect(
      resolveKnown('run_control_workflow', {
        mode: 'flash-observe',
        debug: nested.proxy,
      }).missingCurrentAcknowledgement,
    ).toBe(false);
    expect(resolveKnown('cpu_reset', { confirm: leaf.proxy }).missingCurrentAcknowledgement).toBe(
      false,
    );
    expect(top.trapCount()).toBe(0);
    expect(nested.trapCount()).toBe(0);
    expect(leaf.trapCount()).toBe(0);
  });

  it('does not invoke top-level, nested, or final accessors and fails closed when needed', () => {
    let confirmGetterCount = 0;
    let debugGetterCount = 0;
    let dryRunGetterCount = 0;
    const fixedArgs: Record<string, unknown> = {};
    const nestedArgs: Record<string, unknown> = { mode: 'flash-observe' };
    const finalArgs: Record<string, unknown> = { mode: 'flash-observe' };
    Object.defineProperty(fixedArgs, 'confirm', {
      get() {
        confirmGetterCount += 1;
        return true;
      },
    });
    Object.defineProperty(nestedArgs, 'debug', {
      get() {
        debugGetterCount += 1;
        return { haltOnFailure: true };
      },
    });
    Object.defineProperty(finalArgs, 'dryRun', {
      get() {
        dryRunGetterCount += 1;
        return true;
      },
    });

    expect(resolveKnown('cpu_reset', fixedArgs).missingCurrentAcknowledgement).toBe(false);
    expect(resolveKnown('run_control_workflow', nestedArgs).missingCurrentAcknowledgement).toBe(
      false,
    );
    expect(resolveKnown('run_control_workflow', finalArgs).missingCurrentAcknowledgement).toBe(
      false,
    );
    expect({ confirmGetterCount, debugGetterCount, dryRunGetterCount }).toEqual({
      confirmGetterCount: 0,
      debugGetterCount: 0,
      dryRunGetterCount: 0,
    });
  });
});
