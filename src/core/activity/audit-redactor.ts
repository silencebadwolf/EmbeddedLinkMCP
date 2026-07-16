import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import {
  ACTIVITY_MAX_TARGETS,
  ActivityArgumentSummarySchema,
  ActivityFailureStageSchema,
  ActivityIdSchema,
  ActivitySafeErrorSchema,
  OperationTargetRefSchema,
  type ActivityArgumentItem,
  type ActivityArgumentSummary,
  type ActivityFailureStage,
  type ActivitySafeError,
  type OperationTargetRef,
} from '../../shared/activity-contract.js';
import type { RedactionProfile, ResolvedToolObservationPolicy } from './risk-policy.js';
import { readOwnDataPath } from './safe-observation-value.js';

export interface RedactedToolObservation {
  readonly targets: readonly OperationTargetRef[];
  readonly argumentSummary?: ActivityArgumentSummary;
  readonly clientAcknowledged?: boolean;
}

type TargetKind = 'runtime' | 'session' | 'workspace' | 'probe' | 'file' | 'ui' | 'job';
type SummaryRule =
  | {
      readonly path: readonly string[];
      readonly kind: 'identifier';
      readonly targetKind?: TargetKind;
    }
  | {
      readonly path: readonly string[];
      readonly kind: 'basename';
      readonly targetKind?: 'workspace' | 'file';
    }
  | { readonly path: readonly string[]; readonly kind: 'number' | 'boolean' }
  | {
      readonly path: readonly string[];
      readonly kind: 'content-metadata';
      readonly contentType: 'script' | 'binary' | 'firmware' | 'screenshot' | 'terminal' | 'memory';
      readonly basis: 'utf8' | 'bytes';
      readonly digest: 'sha256' | 'none';
    };

type OmissionCategory = 'unsupported' | 'oversized';
type SafeValue<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly category: OmissionCategory };

const MAX_IDENTIFIER_CODE_UNITS = 128;
const MAX_PATH_CODE_UNITS = 4_096;
const MAX_SCRIPT_CODE_UNITS = 65_536;
const MAX_CONTENT_BYTES = 1_048_576;
const MAX_BASE64_CODE_UNITS = Math.ceil(MAX_CONTENT_BYTES / 3) * 4;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const DRIVE_RELATIVE_PATH_PATTERN = /^[A-Za-z]:(?![\\/])/u;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)?.get;

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(record)) deepFreeze(record[key]);
  return Object.freeze(value);
}

const PROFILE_RULES: Readonly<Record<RedactionProfile, readonly SummaryRule[]>> = deepFreeze({
  'metadata-only': Object.freeze([]),
  runtime: Object.freeze([{ path: ['runtimeId'], kind: 'identifier', targetKind: 'runtime' }]),
  session: Object.freeze([
    { path: ['sessionId'], kind: 'identifier', targetKind: 'session' },
    { path: ['jobId'], kind: 'identifier', targetKind: 'job' },
    { path: ['port'], kind: 'identifier' },
    { path: ['baudRate'], kind: 'number' },
  ]),
  workspace: Object.freeze([
    { path: ['root'], kind: 'basename', targetKind: 'workspace' },
    { path: ['jobId'], kind: 'identifier', targetKind: 'job' },
    { path: ['mode'], kind: 'identifier' },
    { path: ['dryRun'], kind: 'boolean' },
  ]),
  probe: Object.freeze([
    { path: ['probeId'], kind: 'identifier', targetKind: 'probe' },
    { path: ['device'], kind: 'identifier' },
    { path: ['name'], kind: 'identifier' },
  ]),
  file: Object.freeze([
    { path: ['path'], kind: 'basename', targetKind: 'file' },
    { path: ['filePath'], kind: 'basename', targetKind: 'file' },
  ]),
  job: Object.freeze([{ path: ['jobId'], kind: 'identifier', targetKind: 'job' }]),
  ui: Object.freeze([
    { path: ['action'], kind: 'identifier', targetKind: 'ui' },
    { path: ['type'], kind: 'identifier' },
  ]),
  'debug-payload': Object.freeze([
    { path: ['probeId'], kind: 'identifier', targetKind: 'probe' },
    { path: ['sessionId'], kind: 'identifier', targetKind: 'session' },
    { path: ['device'], kind: 'identifier' },
    { path: ['address'], kind: 'identifier' },
    { path: ['length'], kind: 'number' },
    { path: ['path'], kind: 'basename', targetKind: 'file' },
    { path: ['filePath'], kind: 'basename', targetKind: 'file' },
    {
      path: ['script'],
      kind: 'content-metadata',
      contentType: 'script',
      basis: 'utf8',
      digest: 'sha256',
    },
    {
      path: ['dataBase64'],
      kind: 'content-metadata',
      contentType: 'binary',
      basis: 'bytes',
      digest: 'none',
    },
    {
      path: ['data'],
      kind: 'content-metadata',
      contentType: 'memory',
      basis: 'bytes',
      digest: 'none',
    },
  ]),
});

function omittedItem(key: string, category: OmissionCategory): ActivityArgumentItem {
  return { kind: 'omitted', key, category };
}

function safeIdentifier(value: unknown): SafeValue<string> {
  if (typeof value !== 'string') return { ok: false, category: 'unsupported' };
  if (value.length > MAX_IDENTIFIER_CODE_UNITS) return { ok: false, category: 'oversized' };
  const parsed = ActivityIdSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, category: 'unsupported' };
}

function safeBasename(value: unknown, targetKind: 'workspace' | 'file'): SafeValue<string> {
  if (typeof value !== 'string') return { ok: false, category: 'unsupported' };
  if (value.length > MAX_PATH_CODE_UNITS) return { ok: false, category: 'oversized' };
  if (DRIVE_RELATIVE_PATH_PATTERN.test(value)) return { ok: false, category: 'unsupported' };

  const segments = value.split(/[\\/]/u);
  let label = '';
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index] !== '') {
      label = segments[index];
      break;
    }
  }
  if (DRIVE_RELATIVE_PATH_PATTERN.test(label)) return { ok: false, category: 'unsupported' };
  const parsed = OperationTargetRefSchema.safeParse({
    kind: targetKind,
    id: `${targetKind}-current`,
    label,
  });
  return parsed.success
    ? { ok: true, value: parsed.data.label as string }
    : { ok: false, category: label.length > 128 ? 'oversized' : 'unsupported' };
}

function safeScriptMetadata(
  key: string,
  value: unknown,
  rule: Extract<SummaryRule, { readonly kind: 'content-metadata' }>,
): ActivityArgumentItem {
  if (typeof value !== 'string') return omittedItem(key, 'unsupported');
  if (value.length > MAX_SCRIPT_CODE_UNITS) return omittedItem(key, 'oversized');
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (byteLength > MAX_CONTENT_BYTES) return omittedItem(key, 'oversized');

  return {
    kind: 'content-metadata',
    key,
    contentType: rule.contentType,
    byteLength,
    lineCount: value.length === 0 ? 0 : value.split(/\r\n|\r|\n/u).length,
    digest: {
      algorithm: 'sha256',
      basis: 'utf8',
      hex: createHash('sha256').update(value, 'utf8').digest('hex'),
    },
  };
}

function safeBase64Metadata(
  key: string,
  value: unknown,
  rule: Extract<SummaryRule, { readonly kind: 'content-metadata' }>,
): ActivityArgumentItem {
  if (typeof value !== 'string') return omittedItem(key, 'unsupported');
  if (value.length > MAX_BASE64_CODE_UNITS) return omittedItem(key, 'oversized');
  if (!BASE64_PATTERN.test(value)) return omittedItem(key, 'unsupported');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const byteLength = (value.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_CONTENT_BYTES) {
    return omittedItem(key, 'oversized');
  }

  return {
    kind: 'content-metadata',
    key,
    contentType: rule.contentType,
    byteLength,
  };
}

function typedArrayByteLength(value: unknown): SafeValue<number> {
  try {
    if (!types.isUint8Array(value)) return { ok: false, category: 'unsupported' };
    if (TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
      return { ok: false, category: 'unsupported' };
    }
    const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
    return byteLength <= MAX_CONTENT_BYTES
      ? { ok: true, value: byteLength }
      : { ok: false, category: 'oversized' };
  } catch {
    return { ok: false, category: 'unsupported' };
  }
}

function safeBytesMetadata(
  key: string,
  value: unknown,
  rule: Extract<SummaryRule, { readonly kind: 'content-metadata' }>,
): ActivityArgumentItem {
  const byteLength = typedArrayByteLength(value);
  return byteLength.ok
    ? {
        kind: 'content-metadata',
        key,
        contentType: rule.contentType,
        byteLength: byteLength.value,
      }
    : omittedItem(key, byteLength.category);
}

function contentMetadataItem(
  key: string,
  value: unknown,
  rule: Extract<SummaryRule, { readonly kind: 'content-metadata' }>,
): ActivityArgumentItem {
  if (rule.basis === 'utf8' && rule.digest === 'sha256') {
    return safeScriptMetadata(key, value, rule);
  }
  if (key === 'dataBase64') return safeBase64Metadata(key, value, rule);
  return safeBytesMetadata(key, value, rule);
}

function addTarget(
  targets: OperationTargetRef[],
  targetKeys: Set<string>,
  target: { readonly kind: TargetKind; readonly id: string; readonly label?: string },
): void {
  if (targets.length >= ACTIVITY_MAX_TARGETS) return;
  const parsed = OperationTargetRefSchema.parse(target);
  const key = `${parsed.kind}:${parsed.id}`;
  if (targetKeys.has(key)) return;
  targetKeys.add(key);
  targets.push(parsed);
}

function processRule(
  rule: SummaryRule,
  rawArgs: unknown,
  items: ActivityArgumentItem[],
  targets: OperationTargetRef[],
  targetKeys: Set<string>,
): void {
  const value = readOwnDataPath(rawArgs, rule.path);
  if (value === undefined) return;
  const key = rule.path.join('.');

  switch (rule.kind) {
    case 'identifier': {
      const safe = safeIdentifier(value);
      if (!safe.ok) {
        items.push(omittedItem(key, safe.category));
        return;
      }
      items.push({ kind: 'identifier', key, value: safe.value });
      if (rule.targetKind !== undefined) {
        addTarget(targets, targetKeys, { kind: rule.targetKind, id: safe.value });
      }
      return;
    }
    case 'basename': {
      const targetKind = rule.targetKind ?? 'file';
      const safe = safeBasename(value, targetKind);
      if (!safe.ok) {
        items.push(omittedItem(key, safe.category));
        return;
      }
      items.push({ kind: 'basename', key, value: safe.value });
      if (rule.targetKind !== undefined) {
        addTarget(targets, targetKeys, {
          kind: rule.targetKind,
          id: `${rule.targetKind}-current`,
          label: safe.value,
        });
      }
      return;
    }
    case 'number':
      items.push(
        typeof value === 'number' && Number.isFinite(value)
          ? { kind: 'number', key, value }
          : omittedItem(key, 'unsupported'),
      );
      return;
    case 'boolean':
      items.push(
        typeof value === 'boolean'
          ? { kind: 'boolean', key, value }
          : omittedItem(key, 'unsupported'),
      );
      return;
    case 'content-metadata':
      items.push(contentMetadataItem(key, value, rule));
  }
}

export function redactToolObservation(
  policy: ResolvedToolObservationPolicy,
  rawArgs: unknown,
): RedactedToolObservation {
  const items: ActivityArgumentItem[] = [];
  const targets: OperationTargetRef[] = [];
  const targetKeys = new Set<string>();
  const rules = Object.hasOwn(PROFILE_RULES, policy.redactionProfile)
    ? PROFILE_RULES[policy.redactionProfile]
    : PROFILE_RULES['metadata-only'];
  for (const rule of rules) processRule(rule, rawArgs, items, targets, targetKeys);

  if (targets.length === 0) {
    addTarget(targets, targetKeys, { kind: 'runtime', id: 'current-runtime' });
  }
  const parsedTargets = Object.freeze(
    targets.map((target) => OperationTargetRefSchema.parse(target)),
  );
  const argumentSummary =
    items.length === 0
      ? undefined
      : ActivityArgumentSummarySchema.parse({ fieldCount: items.length, items });
  const clientAcknowledged =
    policy.acknowledgement.kind !== 'none' && readOwnDataPath(rawArgs, ['confirm']) === true;

  const output: RedactedToolObservation = {
    targets: parsedTargets,
    ...(argumentSummary === undefined ? {} : { argumentSummary }),
    ...(clientAcknowledged ? { clientAcknowledged: true } : {}),
  };
  return deepFreeze(output);
}

export function redactResultClassification(input: {
  success: boolean;
  errorCode?: string;
  failureStage?: ActivityFailureStage;
}): ActivitySafeError | undefined {
  if (input.success) return undefined;

  const parsedCode =
    typeof input.errorCode === 'string' && input.errorCode.length <= 64
      ? ActivityIdSchema.safeParse(input.errorCode)
      : undefined;
  const parsedStage = ActivityFailureStageSchema.safeParse(input.failureStage);
  const output = ActivitySafeErrorSchema.parse({
    code: parsedCode?.success ? parsedCode.data : 'OPERATION_FAILED',
    messageCode: 'operation.failed',
    stage: parsedStage.success ? parsedStage.data : 'provider',
  });
  return deepFreeze(output);
}
