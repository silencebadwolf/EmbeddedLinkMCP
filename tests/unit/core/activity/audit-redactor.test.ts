import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  redactResultClassification,
  redactToolObservation,
  type RedactedToolObservation,
} from '@/core/activity/audit-redactor.js';
import {
  RUNTIME_TOOL_POLICIES,
  resolveToolObservationPolicy,
  type RedactionProfile,
  type ResolvedToolObservationPolicy,
} from '@/core/activity/risk-policy.js';
import {
  ActivityArgumentSummarySchema,
  OperationTargetRefSchema,
} from '@/shared/activity-contract.js';

const CREDENTIAL_SEED = 'credential-secret-7M!alpha';
const TOKEN_SEED = 'token-secret-9Q!bravo';
const NONCE_SEED = 'nonce-secret-4K!charlie';
const COMMANDER_SCRIPT = 'halt\nmem32 0x20000000 4\nr';
const BINARY_SEED = 'binary-payload-delta';
const MEMORY_SEED = 'memory-payload-echo';
const FIRMWARE_SEED = 'firmware-payload-foxtrot';
const SCREENSHOT_SEED = 'screenshot-pixels-golf';
const TERMINAL_SEED = 'terminal-body-hotel';
const EVIDENCE_SEED = 'evidence-data-india';
const ERROR_TEXT_SEED = 'error-text-juliet';
const ERROR_DETAILS_SEED = 'error-details-kilo';
const ERROR_STACK_SEED = 'error-stack-lima';
const FUZZ_SEED = 0x6d2b_79f5;
const FUZZ_CASE_COUNT = 192;
const FUZZ_PROFILES = [
  'metadata-only',
  'runtime',
  'session',
  'workspace',
  'probe',
  'file',
  'job',
  'ui',
  'debug-payload',
] as const satisfies readonly RedactionProfile[];

const ALL_SAFE_ARGS = {
  runtimeId: 'runtime_1',
  sessionId: 'session_1',
  jobId: 'job_1',
  port: 'COM7',
  baudRate: 115_200,
  root: 'C:\\WorkspaceOwner\\ProjectParent\\workspace-name',
  mode: 'debug-diagnose',
  dryRun: false,
  probeId: 'probe_1',
  device: 'STM32F407VG',
  name: 'STM32F407',
  path: 'C:\\FirmwareOwner\\ProjectParent\\firmware.bin',
  filePath: '/home/build-owner/project-parent/alternate.bin',
  action: 'capture',
  type: 'png',
  address: '0x20000000',
  length: 64,
  script: 'halt\nr\ng',
  dataBase64: Buffer.from(BINARY_SEED, 'utf8').toString('base64'),
  data: new Uint8Array([0, 1, 2, 3]),
} as const;

const PROFILE_KEYS = {
  'metadata-only': [],
  runtime: ['runtimeId'],
  session: ['sessionId', 'jobId', 'port', 'baudRate'],
  workspace: ['root', 'jobId', 'mode', 'dryRun'],
  probe: ['probeId', 'device', 'name'],
  file: ['path', 'filePath'],
  job: ['jobId'],
  ui: ['action', 'type'],
  'debug-payload': [
    'probeId',
    'sessionId',
    'device',
    'address',
    'length',
    'path',
    'filePath',
    'script',
    'dataBase64',
    'data',
  ],
} as const satisfies Readonly<Record<RedactionProfile, readonly string[]>>;

const PROFILE_TARGET_KINDS = {
  'metadata-only': ['runtime'],
  runtime: ['runtime'],
  session: ['session', 'job'],
  workspace: ['workspace', 'job'],
  probe: ['probe'],
  file: ['file'],
  job: ['job'],
  ui: ['ui'],
  'debug-payload': ['probe', 'session', 'file'],
} as const satisfies Readonly<Record<RedactionProfile, readonly string[]>>;

function policy(redactionProfile: RedactionProfile): ResolvedToolObservationPolicy {
  return {
    action: 'test_action',
    sourceSurface: 'unknown',
    surface: 'runtime',
    sensitivity: 'read-only',
    risk: 'read-only',
    approvalPolicy: 'none',
    acknowledgement: { kind: 'none' },
    redactionProfile,
    missingCurrentAcknowledgement: false,
    hasDiagnostic: false,
  };
}

function reviewedPolicy(action: string, rawArgs: unknown): ResolvedToolObservationPolicy {
  const reviewed = RUNTIME_TOOL_POLICIES.find((candidate) => candidate.action === action);
  if (reviewed === undefined) throw new Error(`missing reviewed policy: ${action}`);
  return resolveToolObservationPolicy({
    action,
    declaredSensitivity: reviewed.sensitivity,
    rawArgs,
  });
}

function serialized(output: unknown): string {
  return JSON.stringify(output);
}

function encodedRepresentations(seed: string): readonly string[] {
  return [
    seed,
    Buffer.from(seed, 'utf8').toString('base64'),
    Buffer.from(seed, 'utf8').toString('hex'),
    createHash('sha256').update(seed, 'utf8').digest('hex'),
  ];
}

function expectRepresentationsAbsent(output: unknown, seed: string): void {
  const json = serialized(output);
  for (const representation of encodedRepresentations(seed)) {
    expect(json, representation).not.toContain(representation);
  }
}

function itemKeys(output: RedactedToolObservation): readonly string[] {
  return output.argumentSummary?.items.map((item) => item.key) ?? [];
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

interface FuzzTrapCounters {
  ownKeys: number;
  get: number;
  descriptor: number;
  prototype: number;
}

function countingFuzzProxy<T extends object>(target: T, counters: FuzzTrapCounters): T {
  return new Proxy(target, {
    ownKeys(current) {
      counters.ownKeys += 1;
      return Reflect.ownKeys(current);
    },
    get(current, key, receiver) {
      counters.get += 1;
      return Reflect.get(current, key, receiver);
    },
    getOwnPropertyDescriptor(current, key) {
      counters.descriptor += 1;
      return Reflect.getOwnPropertyDescriptor(current, key);
    },
    getPrototypeOf(current) {
      counters.prototype += 1;
      return Reflect.getPrototypeOf(current);
    },
  });
}

function allowlistedFuzzField(profile: RedactionProfile): string {
  switch (profile) {
    case 'runtime':
      return 'runtimeId';
    case 'session':
      return 'sessionId';
    case 'workspace':
      return 'root';
    case 'probe':
      return 'probeId';
    case 'file':
      return 'path';
    case 'job':
      return 'jobId';
    case 'ui':
      return 'action';
    case 'debug-payload':
      return 'script';
    case 'metadata-only':
      return 'runtimeId';
  }
}

describe('redactToolObservation', () => {
  it('uses the exact allowlisted rules, listed target order, deduplication, cap, and fallback', () => {
    for (const redactionProfile of Object.keys(PROFILE_KEYS) as RedactionProfile[]) {
      const output = redactToolObservation(policy(redactionProfile), ALL_SAFE_ARGS);

      expect(itemKeys(output), redactionProfile).toEqual(PROFILE_KEYS[redactionProfile]);
      expect(output.argumentSummary?.fieldCount ?? 0, redactionProfile).toBe(
        PROFILE_KEYS[redactionProfile].length,
      );
      expect(
        output.targets.map((target) => target.kind),
        redactionProfile,
      ).toEqual(PROFILE_TARGET_KINDS[redactionProfile]);
      expect(output.targets.length, redactionProfile).toBeLessThanOrEqual(8);
    }

    const debug = redactToolObservation(policy('debug-payload'), ALL_SAFE_ARGS);
    expect(debug.targets).toEqual([
      { kind: 'probe', id: 'probe_1' },
      { kind: 'session', id: 'session_1' },
      { kind: 'file', id: 'file-current', label: 'firmware.bin' },
    ]);
    expect(redactToolObservation(policy('metadata-only'), ALL_SAFE_ARGS)).toEqual({
      targets: [{ kind: 'runtime', id: 'current-runtime' }],
    });
  });

  it.each([
    { label: 'path-shaped', value: 'C:\\SecretOwner\\session-id', category: 'unsupported' },
    { label: 'invalid-character', value: 'session/id with spaces', category: 'unsupported' },
    { label: 'oversized', value: 's'.repeat(129), category: 'oversized' },
  ])('rejects a $label declared identifier with a fixed marker and runtime fallback', (fixture) => {
    const output = redactToolObservation(policy('session'), { sessionId: fixture.value });

    expect(output).toEqual({
      targets: [{ kind: 'runtime', id: 'current-runtime' }],
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'omitted', key: 'sessionId', category: fixture.category }],
      },
    });
    expect(serialized(output)).not.toContain(fixture.value);
  });

  it.each([
    {
      label: 'Windows',
      value: 'Z:\\WinUserSecret\\WinParentSecret\\artifact-firmware.bin',
      forbidden: ['Z:', 'WinUserSecret', 'WinParentSecret'],
    },
    {
      label: 'WSL',
      value: '/mnt/z/Users/WslUserSecret/WslParentSecret/artifact-firmware.bin',
      forbidden: ['/mnt/z/', 'WslUserSecret', 'WslParentSecret'],
    },
    {
      label: 'POSIX',
      value: '/home/PosixUserSecret/PosixParentSecret/artifact-firmware.bin',
      forbidden: ['home', 'PosixUserSecret', 'PosixParentSecret'],
    },
    {
      label: 'UNC',
      value: '\\\\UncHostSecret\\UncShareSecret\\UncParentSecret\\artifact-firmware.bin',
      forbidden: ['UncHostSecret', 'UncShareSecret', 'UncParentSecret'],
    },
  ])('keeps only a safe basename for a $label path', ({ value, forbidden }) => {
    const output = redactToolObservation(policy('file'), { path: value });
    const json = serialized(output);

    expect(output.targets).toEqual([
      { kind: 'file', id: 'file-current', label: 'artifact-firmware.bin' },
    ]);
    expect(output.argumentSummary?.items).toEqual([
      { kind: 'basename', key: 'path', value: 'artifact-firmware.bin' },
    ]);
    for (const component of forbidden) expect(json, component).not.toContain(component);
  });

  it('rejects a Windows drive-relative path without silently stripping its drive prefix', () => {
    const rawPath = 'C:secret.bin';
    const output = redactToolObservation(policy('file'), { path: rawPath });
    const json = serialized(output);

    expect(output).toEqual({
      targets: [{ kind: 'runtime', id: 'current-runtime' }],
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'omitted', key: 'path', category: 'unsupported' }],
      },
    });
    expect(json).not.toContain(rawPath);
    expect(json).not.toContain('C:');
  });

  it('omits seeded secrets and undeclared payloads without reversible encodings or secret hashes', () => {
    const raw: Record<string, unknown> = {
      probeId: 'probe_1',
      password: CREDENTIAL_SEED,
      auth: { token: TOKEN_SEED, nonce: NONCE_SEED },
      script: COMMANDER_SCRIPT,
      dataBase64: Buffer.from(BINARY_SEED, 'utf8').toString('base64'),
      data: Buffer.from(MEMORY_SEED, 'utf8'),
      firmware: Buffer.from(FIRMWARE_SEED, 'utf8'),
      screenshot: Buffer.from(SCREENSHOT_SEED, 'utf8'),
      terminalBody: TERMINAL_SEED,
      memoryValue: MEMORY_SEED,
      evidence: { data: EVIDENCE_SEED, meta: TOKEN_SEED },
      error: {
        text: ERROR_TEXT_SEED,
        details: ERROR_DETAILS_SEED,
        stack: ERROR_STACK_SEED,
      },
    };
    raw.cycle = raw;

    const output = redactToolObservation(policy('debug-payload'), raw);
    for (const seed of [CREDENTIAL_SEED, TOKEN_SEED, NONCE_SEED]) {
      expectRepresentationsAbsent(output, seed);
    }
    for (const seed of [
      COMMANDER_SCRIPT,
      BINARY_SEED,
      MEMORY_SEED,
      FIRMWARE_SEED,
      SCREENSHOT_SEED,
      TERMINAL_SEED,
      EVIDENCE_SEED,
      ERROR_TEXT_SEED,
      ERROR_DETAILS_SEED,
      ERROR_STACK_SEED,
    ]) {
      expect(serialized(output), seed).not.toContain(seed);
    }
  });

  it('emits bounded script metadata with a utf8 digest but never digests binary or memory data', () => {
    const script = 'halt\nmem32 0x20000000 4\nr';
    const binary = Buffer.from(BINARY_SEED, 'utf8');
    const memory = new Uint8Array(Buffer.from(MEMORY_SEED, 'utf8'));
    const output = redactToolObservation(policy('debug-payload'), {
      script,
      dataBase64: binary.toString('base64'),
      data: memory,
    });

    expect(output.argumentSummary?.items).toEqual([
      {
        kind: 'content-metadata',
        key: 'script',
        contentType: 'script',
        byteLength: Buffer.byteLength(script, 'utf8'),
        lineCount: 3,
        digest: {
          algorithm: 'sha256',
          basis: 'utf8',
          hex: createHash('sha256').update(script, 'utf8').digest('hex'),
        },
      },
      {
        kind: 'content-metadata',
        key: 'dataBase64',
        contentType: 'binary',
        byteLength: binary.byteLength,
      },
      {
        kind: 'content-metadata',
        key: 'data',
        contentType: 'memory',
        byteLength: memory.byteLength,
      },
    ]);
    expect(output.argumentSummary?.items[1]).not.toHaveProperty('digest');
    expect(output.argumentSummary?.items[2]).not.toHaveProperty('digest');
  });

  it('fails closed with fixed omission categories for cycles, unsupported values, and oversized input', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const output = redactToolObservation(policy('debug-payload'), {
      script: cycle,
      dataBase64: 'A'.repeat(2_000_000),
      data: new Uint8Array(2_000_000),
      path: 'P'.repeat(20_000),
      unlistedHugeValue: 'U'.repeat(2_000_000),
      cycle,
    });

    expect(output.argumentSummary?.items).toEqual([
      { kind: 'omitted', key: 'path', category: 'oversized' },
      { kind: 'omitted', key: 'script', category: 'unsupported' },
      { kind: 'omitted', key: 'dataBase64', category: 'oversized' },
      { kind: 'omitted', key: 'data', category: 'oversized' },
    ]);
    expect(output.targets).toEqual([{ kind: 'runtime', id: 'current-runtime' }]);
    expect(serialized(output).length).toBeLessThan(1_000);
  });

  it('treats a forged Uint8Array prototype chain without internal slots as unsupported', () => {
    const forged = Object.create(Uint8Array.prototype) as Uint8Array;
    const output = redactToolObservation(policy('debug-payload'), { data: forged });

    expect(output).toEqual({
      targets: [{ kind: 'runtime', id: 'current-runtime' }],
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'omitted', key: 'data', category: 'unsupported' }],
      },
    });
  });

  it('does not invoke Proxy traps inherited through a forged typed-array prototype chain', () => {
    let prototypeTraps = 0;
    const inheritedProxy = new Proxy(Uint8Array.prototype, {
      getPrototypeOf(target) {
        prototypeTraps += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    const data = Object.create(inheritedProxy);
    const output = redactToolObservation(policy('debug-payload'), { data });

    expect(output).toEqual({
      targets: [{ kind: 'runtime', id: 'current-runtime' }],
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'omitted', key: 'data', category: 'unsupported' }],
      },
    });
    expect(prototypeTraps).toBe(0);
  });

  it.each(['constructor', '__proto__'])(
    'falls back safely for inherited profile lookup key %s',
    (redactionProfile) => {
      const malformedPolicy = {
        ...policy('metadata-only'),
        redactionProfile: redactionProfile as RedactionProfile,
      };

      expect(redactToolObservation(malformedPolicy, ALL_SAFE_ARGS)).toEqual({
        targets: [{ kind: 'runtime', id: 'current-runtime' }],
      });
    },
  );

  it.each([
    { action: 'cpu_reset', label: 'fixed' },
    { action: 'run_control_workflow', label: 'conditional' },
  ])('ignores legacy confirm for $label acknowledgement', ({ action }) => {
    const baseArgs = action === 'run_control_workflow' ? { mode: 'debug-diagnose' } : {};
    const reviewed = reviewedPolicy(action, baseArgs);

    expect(redactToolObservation(reviewed, baseArgs)).not.toHaveProperty('clientAcknowledged');
    expect(redactToolObservation(reviewed, { ...baseArgs, confirm: false })).not.toHaveProperty(
      'clientAcknowledged',
    );
    expect(redactToolObservation(reviewed, { ...baseArgs, confirm: 'true' })).not.toHaveProperty(
      'clientAcknowledged',
    );
    expect(redactToolObservation(reviewed, { ...baseArgs, confirm: true })).not.toHaveProperty(
      'clientAcknowledged',
    );
    expect(itemKeys(redactToolObservation(reviewed, { ...baseArgs, confirm: true }))).not.toContain('confirm');
  });

  it('never invokes accessor getters or top-level Proxy traps', () => {
    const sessionPolicy = policy('session');
    let getterCalls = 0;
    const withGetter = {};
    Object.defineProperty(withGetter, 'sessionId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'secret-session';
      },
    });

    const traps = { ownKeys: 0, get: 0, descriptor: 0, prototype: 0 };
    const proxied = new Proxy(
      { sessionId: 'secret-session' },
      {
        ownKeys(target) {
          traps.ownKeys += 1;
          return Reflect.ownKeys(target);
        },
        get(target, key, receiver) {
          traps.get += 1;
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          traps.descriptor += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        getPrototypeOf(target) {
          traps.prototype += 1;
          return Reflect.getPrototypeOf(target);
        },
      },
    );

    redactToolObservation(sessionPolicy, withGetter);
    redactToolObservation(sessionPolicy, proxied);
    expect(getterCalls).toBe(0);
    expect(traps).toEqual({ ownKeys: 0, get: 0, descriptor: 0, prototype: 0 });
  });

  it('never invokes nested or final-leaf Proxy traps and accessors, including confirm', () => {
    const fixed = reviewedPolicy('cpu_reset', {});
    const counters = { ownKeys: 0, get: 0, descriptor: 0, prototype: 0 };
    const leaf = new Proxy(
      { value: true },
      {
        ownKeys(target) {
          counters.ownKeys += 1;
          return Reflect.ownKeys(target);
        },
        get(target, key, receiver) {
          counters.get += 1;
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor(target, key) {
          counters.descriptor += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        getPrototypeOf(target) {
          counters.prototype += 1;
          return Reflect.getPrototypeOf(target);
        },
      },
    );
    let confirmGetterCalls = 0;
    let nestedGetterCalls = 0;
    const withConfirmAccessor: Record<string, unknown> = {};
    Object.defineProperty(withConfirmAccessor, 'confirm', {
      enumerable: true,
      get() {
        confirmGetterCalls += 1;
        return true;
      },
    });
    const nested: Record<string, unknown> = {};
    Object.defineProperty(nested, 'secret', {
      enumerable: true,
      get() {
        nestedGetterCalls += 1;
        return TOKEN_SEED;
      },
    });

    const leafOutput = redactToolObservation(fixed, { confirm: leaf, script: leaf });
    const nestedOutput = redactToolObservation(fixed, { protected: { proxy: leaf }, nested });
    const accessorOutput = redactToolObservation(fixed, withConfirmAccessor);

    expect(leafOutput).not.toHaveProperty('clientAcknowledged');
    expect(accessorOutput).not.toHaveProperty('clientAcknowledged');
    expect(serialized(nestedOutput)).not.toContain(TOKEN_SEED);
    expect(counters).toEqual({ ownKeys: 0, get: 0, descriptor: 0, prototype: 0 });
    expect(confirmGetterCalls).toBe(0);
    expect(nestedGetterCalls).toBe(0);
  });

  it('returns detached deeply frozen schema-parsed output that ignores later input mutation', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const raw = {
      probeId: 'probe_original',
      path: 'C:\\OwnerSecret\\ParentSecret\\firmware.bin',
      script: 'halt\nr',
      data: bytes,
    };
    const output = redactToolObservation(policy('debug-payload'), raw);
    const before = serialized(output);

    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.targets)).toBe(true);
    expect(Object.isFrozen(output.targets[0])).toBe(true);
    expect(Object.isFrozen(output.argumentSummary)).toBe(true);
    expect(Object.isFrozen(output.argumentSummary?.items)).toBe(true);
    for (const item of output.argumentSummary?.items ?? [])
      expect(Object.isFrozen(item)).toBe(true);
    const scriptItem = output.argumentSummary?.items.find((item) => item.key === 'script');
    if (scriptItem?.kind !== 'content-metadata') throw new Error('missing script metadata');
    expect(Object.isFrozen(scriptItem.digest)).toBe(true);
    expect(Reflect.set(output.targets[0] as object, 'id', 'mutated')).toBe(false);

    raw.probeId = 'probe_mutated';
    raw.path = '/different/owner/mutated.bin';
    raw.script = TOKEN_SEED;
    bytes.fill(255);
    expect(serialized(output)).toBe(before);
  });

  it('preserves secrecy and bounded immutable schemas across seeded randomized fixtures', () => {
    const random = xorshift32(FUZZ_SEED);

    for (let caseIndex = 0; caseIndex < FUZZ_CASE_COUNT; caseIndex += 1) {
      const caseLabel = `fuzz seed=0x${FUZZ_SEED.toString(16)} case=${caseIndex}`;
      const profile = FUZZ_PROFILES[random() % FUZZ_PROFILES.length];
      const entropy = random().toString(16).padStart(8, '0');
      const credential = `credential-fuzz-${caseIndex}-${entropy}-alpha!`;
      const token = `token-fuzz-${caseIndex}-${entropy}-bravo!`;
      const nonce = `nonce-fuzz-${caseIndex}-${entropy}-charlie!`;
      const credentialRepresentations = encodedRepresentations(credential);
      const tokenRepresentations = encodedRepresentations(token);
      const nonceRepresentations = encodedRepresentations(nonce);
      const representationSets = [
        credentialRepresentations,
        tokenRepresentations,
        nonceRepresentations,
      ] as const;
      const placementOffset = random() % representationSets.length;
      const topLevelRepresentations = representationSets[placementOffset];
      const nestedRepresentations = representationSets[(placementOffset + 1) % 3];
      const evidenceRepresentations = representationSets[(placementOffset + 2) % 3];
      const raw = ((random() & 1) === 0 ? {} : Object.create(null)) as Record<string, unknown>;
      const nested = ((random() & 1) === 0 ? {} : Object.create(null)) as Record<string, unknown>;

      raw.runtimeId = `runtime_${caseIndex}`;
      raw.sessionId = `session_${caseIndex}`;
      raw.jobId = `job_${caseIndex}`;
      raw.port = `COM${caseIndex % 99}`;
      raw.baudRate = 9_600 + (caseIndex % 8) * 9_600;
      raw.root = `\\\\FuzzHost\\FuzzShare\\${nonce}\\workspace-${caseIndex}`;
      raw.mode = 'debug-diagnose';
      raw.dryRun = (random() & 1) === 0;
      raw.probeId = `probe_${caseIndex}`;
      raw.device = `device_${caseIndex}`;
      raw.name = `name_${caseIndex}`;
      raw.path = `C:\\${credential}\\parent-${caseIndex}\\artifact-${caseIndex}.bin`;
      raw.filePath = `/home/${token}/parent-${caseIndex}/alternate-${caseIndex}.bin`;
      raw.action = `action_${caseIndex}`;
      raw.type = 'png';
      raw.address = `address_${caseIndex}`;
      raw.length = caseIndex;
      raw.script = `halt\nread-${caseIndex}\nr`;
      raw.dataBase64 = nonceRepresentations[1];
      raw.data =
        (random() & 1) === 0
          ? Buffer.from(token, 'utf8')
          : new Uint8Array(Buffer.from(token, 'utf8'));
      raw.firmware = Buffer.from(credential, 'utf8');
      raw.screenshot = new Uint8Array(Buffer.from(nonce, 'utf8'));
      raw.terminalBody = token;

      raw.protectedValue = topLevelRepresentations[0];
      raw.protectedBase64 = topLevelRepresentations[1];
      raw.protectedHex = topLevelRepresentations[2];
      raw.protectedSha256 = topLevelRepresentations[3];
      nested.protectedValue = nestedRepresentations[0];
      nested.protectedBase64 = nestedRepresentations[1];
      nested.protectedHex = nestedRepresentations[2];
      nested.protectedSha256 = nestedRepresentations[3];
      nested.self = nested;
      raw.unknownNested = nested;
      raw.evidence = {
        data: evidenceRepresentations[0],
        meta: {
          base64: evidenceRepresentations[1],
          hex: evidenceRepresentations[2],
          sha256: evidenceRepresentations[3],
        },
      };
      raw.error = { message: credential, details: token, stack: nonce };
      raw.cycle = raw;

      if (caseIndex % 17 === 0) raw.script = 'S'.repeat(70_000);
      if (caseIndex % 19 === 0) raw.dataBase64 = 'A'.repeat(1_500_000);
      if (caseIndex % 23 === 0) raw.data = new Uint8Array(1_100_000);
      if (caseIndex % 29 === 0) raw.data = Object.create(Uint8Array.prototype);

      const counters: FuzzTrapCounters = { ownKeys: 0, get: 0, descriptor: 0, prototype: 0 };
      let getterCalls = 0;
      let rawInput: unknown = raw;
      const adversarialMode = caseIndex % 6;
      if (adversarialMode === 0) {
        rawInput = countingFuzzProxy(raw, counters);
      } else if (adversarialMode === 1) {
        raw[allowlistedFuzzField(profile)] = countingFuzzProxy({ protected: credential }, counters);
      } else if (adversarialMode === 2) {
        Object.defineProperty(raw, allowlistedFuzzField(profile), {
          enumerable: true,
          configurable: true,
          get() {
            getterCalls += 1;
            return credential;
          },
        });
      } else if (adversarialMode === 3) {
        raw.unknownProxy = countingFuzzProxy({ protected: token }, counters);
      } else if (adversarialMode === 4) {
        Object.defineProperty(nested, 'unknownAccessor', {
          enumerable: true,
          configurable: true,
          get() {
            getterCalls += 1;
            return nonce;
          },
        });
      }

      let output: RedactedToolObservation | undefined;
      expect(() => {
        output = redactToolObservation(policy(profile), rawInput);
      }, caseLabel).not.toThrow();
      if (output === undefined) throw new Error(`${caseLabel}: redactor returned no output`);

      let json = '';
      expect(() => {
        json = serialized(output);
      }, caseLabel).not.toThrow();
      expect(json.length, caseLabel).toBeLessThan(16_384);
      for (const representation of [
        ...credentialRepresentations,
        ...tokenRepresentations,
        ...nonceRepresentations,
      ]) {
        expect(json, caseLabel).not.toContain(representation);
      }

      expect(output.targets.length, caseLabel).toBeGreaterThanOrEqual(1);
      expect(output.targets.length, caseLabel).toBeLessThanOrEqual(8);
      expect(Object.isFrozen(output), caseLabel).toBe(true);
      expect(Object.isFrozen(output.targets), caseLabel).toBe(true);
      for (const target of output.targets) {
        expect(() => OperationTargetRefSchema.parse(target), caseLabel).not.toThrow();
        expect(Object.isFrozen(target), caseLabel).toBe(true);
      }

      if (output.argumentSummary !== undefined) {
        expect(
          () => ActivityArgumentSummarySchema.parse(output?.argumentSummary),
          caseLabel,
        ).not.toThrow();
        expect(Object.isFrozen(output.argumentSummary), caseLabel).toBe(true);
        expect(Object.isFrozen(output.argumentSummary.items), caseLabel).toBe(true);
        for (const item of output.argumentSummary.items) {
          expect(Object.isFrozen(item), caseLabel).toBe(true);
          if (item.kind === 'content-metadata' && item.digest !== undefined) {
            expect(Object.isFrozen(item.digest), caseLabel).toBe(true);
          }
        }
      }

      expect(getterCalls, caseLabel).toBe(0);
      expect(counters, caseLabel).toEqual({ ownKeys: 0, get: 0, descriptor: 0, prototype: 0 });
    }
  });
});

describe('redactResultClassification', () => {
  it('omits successful classifications', () => {
    expect(
      redactResultClassification({
        success: true,
        errorCode: 'SHOULD_NOT_SURVIVE',
        failureStage: 'provider',
      }),
    ).toBeUndefined();
  });

  it('keeps only a valid safe failure code, fixed message code, and valid stage', () => {
    const output = redactResultClassification({
      success: false,
      errorCode: 'PROBE_TIMEOUT',
      failureStage: 'ipc',
    });

    expect(output).toEqual({
      code: 'PROBE_TIMEOUT',
      messageCode: 'operation.failed',
      stage: 'ipc',
    });
    expect(Object.isFrozen(output)).toBe(true);
  });

  it('uses fixed defaults for missing or invalid classification and never retains raw error data', () => {
    expect(redactResultClassification({ success: false })).toEqual({
      code: 'OPERATION_FAILED',
      messageCode: 'operation.failed',
      stage: 'provider',
    });

    const raw = {
      success: false,
      errorCode: `invalid code ${TOKEN_SEED}`,
      failureStage: 'invalid-stage',
      message: ERROR_TEXT_SEED,
      details: ERROR_DETAILS_SEED,
      stack: ERROR_STACK_SEED,
      error: { message: CREDENTIAL_SEED },
    } as unknown as Parameters<typeof redactResultClassification>[0];
    const output = redactResultClassification(raw);

    expect(output).toEqual({
      code: 'OPERATION_FAILED',
      messageCode: 'operation.failed',
      stage: 'provider',
    });
    for (const seed of [TOKEN_SEED, ERROR_TEXT_SEED, ERROR_DETAILS_SEED, ERROR_STACK_SEED]) {
      expectRepresentationsAbsent(output, seed);
    }
  });
});
