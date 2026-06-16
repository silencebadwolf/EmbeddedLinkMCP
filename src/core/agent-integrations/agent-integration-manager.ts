import path from 'node:path';
import {
  defaultFsPrimitives,
  type FsPrimitives,
} from '../workspace/fs-primitives.js';
import type {
  AgentIntegrationInstallResult,
  AgentIntegrationStatus,
  AgentIntegrationTarget,
  AgentIntegrationTargetId,
  LinkTermMcpLaunchConfig,
} from './types.js';

/** Requested agent integration target is not registered. */
export class AgentIntegrationTargetNotFoundError extends Error {
  readonly code = 'AGENT_INTEGRATION_TARGET_NOT_FOUND' as const;

  constructor(readonly targetId: string) {
    super(`Agent integration target not found: ${targetId}`);
    this.name = 'AgentIntegrationTargetNotFoundError';
  }
}

/** Existing external agent configuration is not valid JSON and will not be overwritten. */
export class AgentConfigInvalidJsonError extends Error {
  readonly code = 'AGENT_CONFIG_INVALID_JSON' as const;

  constructor(readonly configPath: string) {
    super(`Agent configuration is not valid JSON: ${configPath}`);
    this.name = 'AgentConfigInvalidJsonError';
  }
}

/** Options for {@link AgentIntegrationManager}. */
export interface AgentIntegrationManagerOptions {
  targets: ReadonlyArray<AgentIntegrationTarget>;
  launchConfig: LinkTermMcpLaunchConfig;
  fs?: FsPrimitives;
  now?: () => Date;
}

type JsonObject = Record<string, unknown>;

/** Detects and installs LinkTerm MCP stdio configuration into supported local agent configs. */
export class AgentIntegrationManager {
  readonly #targets: ReadonlyArray<AgentIntegrationTarget>;
  readonly #launchConfig: LinkTermMcpLaunchConfig;
  readonly #fs: FsPrimitives;
  readonly #now: () => Date;
  readonly #installQueues = new Map<AgentIntegrationTargetId, Promise<unknown>>();
  #writeCounter = 0;

  constructor(options: AgentIntegrationManagerOptions) {
    this.#targets = options.targets;
    this.#launchConfig = options.launchConfig;
    this.#fs = options.fs ?? defaultFsPrimitives;
    this.#now = options.now ?? (() => new Date());
  }

  /** Return statuses for all known targets. */
  async listStatuses(): Promise<AgentIntegrationStatus[]> {
    return Promise.all(this.#targets.map((target) => this.#statusFor(target)));
  }

  /** Return status for one known target. */
  async getStatus(targetId: AgentIntegrationTargetId): Promise<AgentIntegrationStatus> {
    return this.#statusFor(this.#requireTarget(targetId));
  }

  /** Install or repair LinkTerm MCP config for one target, creating a timestamped backup first. */
  async install(targetId: AgentIntegrationTargetId): Promise<AgentIntegrationInstallResult> {
    return this.#enqueueInstall(targetId, async () => this.#installNow(targetId));
  }

  #enqueueInstall(
    targetId: AgentIntegrationTargetId,
    work: () => Promise<AgentIntegrationInstallResult>,
  ): Promise<AgentIntegrationInstallResult> {
    const previous = this.#installQueues.get(targetId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.#installQueues.set(targetId, next);
    next.finally(() => {
      if (this.#installQueues.get(targetId) === next) this.#installQueues.delete(targetId);
    }).catch(() => undefined);
    return next;
  }

  async #installNow(targetId: AgentIntegrationTargetId): Promise<AgentIntegrationInstallResult> {
    const target = this.#requireTarget(targetId);
    const existing = await this.#readExistingConfig(target.configPath);
    if (existing.kind === 'invalid') throw new AgentConfigInvalidJsonError(target.configPath);

    const current = existing.kind === 'missing' ? {} : existing.value;
    const next = mergeLinkTermConfig(current, target, this.#launchConfig);
    const backupPath = await this.#backupIfExists(
      target.configPath,
      existing.kind === 'missing' ? undefined : existing.raw,
    );
    await this.#writeConfig(target.configPath, next);
    const status = await this.#statusFor(target);
    return { status: { ...status, backupPath }, ...(backupPath ? { backupPath } : {}) };
  }

  #requireTarget(targetId: AgentIntegrationTargetId): AgentIntegrationTarget {
    const target = this.#targets.find((t) => t.id === targetId);
    if (!target) throw new AgentIntegrationTargetNotFoundError(targetId);
    return target;
  }

  async #statusFor(target: AgentIntegrationTarget): Promise<AgentIntegrationStatus> {
    const existing = await this.#readExistingConfig(target.configPath);
    if (existing.kind === 'missing') {
      return toStatus(target, 'not-found', false, true);
    }
    if (existing.kind === 'invalid') {
      return toStatus(target, 'invalid-json', false, false, 'Configuration file is not valid JSON');
    }
    const current = readLinkTermConfig(existing.value, target);
    if (current === undefined) return toStatus(target, 'not-configured', false, true);
    const configured = launchConfigMatches(current, this.#launchConfig, target.configKind);
    return toStatus(target, configured ? 'configured' : 'needs-update', configured, !configured);
  }

  async #readExistingConfig(configPath: string): Promise<
    | { kind: 'missing' }
    | { kind: 'invalid'; raw: string }
    | { kind: 'valid'; raw: string; value: JsonObject }
  > {
    let raw: string;
    try {
      raw = await this.#fs.readFile(configPath);
    } catch (err) {
      if (isNotFound(err)) return { kind: 'missing' };
      throw err;
    }
    try {
      const parsed: unknown = parseJsonLike(raw);
      if (!isPlainObject(parsed)) return { kind: 'invalid', raw };
      return { kind: 'valid', raw, value: parsed };
    } catch {
      return { kind: 'invalid', raw };
    }
  }

  async #backupIfExists(configPath: string, raw: string | undefined): Promise<string | undefined> {
    if (raw === undefined) return undefined;
    const backupPath = this.#nextSidecarPath(configPath, 'bak');
    await this.#fs.writeFile(backupPath, raw);
    return backupPath;
  }

  async #writeConfig(configPath: string, value: JsonObject): Promise<void> {
    const dir = path.dirname(configPath);
    const tmp = this.#nextSidecarPath(configPath, 'tmp');
    await this.#fs.mkdir(dir, { recursive: true });
    try {
      await this.#fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
      await this.#fs.rename(tmp, configPath);
    } catch (err) {
      await this.#fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  #nextSidecarPath(configPath: string, kind: 'bak' | 'tmp'): string {
    this.#writeCounter += 1;
    return `${configPath}.${kind}-${formatTimestamp(this.#now())}-${String(this.#writeCounter).padStart(6, '0')}`;
  }
}

function toStatus(
  target: AgentIntegrationTarget,
  status: AgentIntegrationStatus['status'],
  configured: boolean,
  canInstall: boolean,
  message?: string,
): AgentIntegrationStatus {
  return {
    id: target.id,
    label: target.label,
    configPath: target.configPath,
    configKind: target.configKind,
    status,
    configured,
    canInstall,
    ...(message ? { message } : {}),
  };
}

function mergeLinkTermConfig(
  current: JsonObject,
  target: AgentIntegrationTarget,
  launchConfig: LinkTermMcpLaunchConfig,
): JsonObject {
  const next = structuredClone(current) as JsonObject;
  if (target.configKind === 'vscode-settings') {
    const key = 'chat.mcpServers';
    const mcpServers = isPlainObject(next[key]) ? { ...next[key] } : {};
    mcpServers.linkterm = launchConfig;
    next[key] = mcpServers;
    return next;
  }
  if (target.configKind === 'vscode-mcp-json') {
    const servers = isPlainObject(next.servers) ? { ...next.servers } : {};
    servers.linkterm = { ...launchConfig, type: 'stdio' };
    next.servers = servers;
    return next;
  }
  const mcpServers = isPlainObject(next.mcpServers) ? { ...next.mcpServers } : {};
  mcpServers.linkterm = launchConfig;
  next.mcpServers = mcpServers;
  return next;
}

function readLinkTermConfig(current: JsonObject, target: AgentIntegrationTarget): unknown {
  if (target.configKind === 'vscode-settings') {
    const mcpServers = isPlainObject(current['chat.mcpServers'])
      ? current['chat.mcpServers']
      : undefined;
    return mcpServers?.linkterm;
  }
  if (target.configKind === 'vscode-mcp-json') {
    const servers = isPlainObject(current.servers) ? current.servers : undefined;
    return servers?.linkterm;
  }
  const mcpServers = isPlainObject(current.mcpServers) ? current.mcpServers : undefined;
  return mcpServers?.linkterm;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function launchConfigMatches(
  current: unknown,
  expected: LinkTermMcpLaunchConfig,
  configKind: AgentIntegrationTarget['configKind'],
): boolean {
  if (!isPlainObject(current)) return false;
  const baseMatches =
    current.command === expected.command &&
    JSON.stringify(current.args ?? []) === JSON.stringify(expected.args) &&
    isPlainObject(current.env) &&
    expected.env.LINKTERM_MCP_STDIO === current.env.LINKTERM_MCP_STDIO &&
    expected.env.LINKTERM_FORCE_DIST === current.env.LINKTERM_FORCE_DIST;
  return configKind === 'vscode-mcp-json' ? baseMatches && current.type === 'stdio' : baseMatches;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}

function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function parseJsonLike(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(stripJsonc(raw));
  }
}

function stripJsonc(raw: string): string {
  let out = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? '';
    const next = raw[i + 1] ?? '';
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (/\s/.test(raw[j] ?? '')) j += 1;
      if (raw[j] === '}' || raw[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}
