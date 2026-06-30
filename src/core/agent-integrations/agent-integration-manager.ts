import path from 'node:path';
import {
  defaultFsPrimitives,
  type FsPrimitives,
} from '../workspace/fs-primitives.js';
import type {
  AgentIntegrationDiagnosticCheck,
  AgentIntegrationDiagnosticResult,
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
  wslFiles?: WslAgentConfigFileBridge;
  tokenEnvWriter?: AgentIntegrationTokenEnvWriter;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface WslAgentConfigFileBridge {
  readFile(target: AgentIntegrationTarget): Promise<string>;
  writeFile(target: AgentIntegrationTarget, data: string): Promise<void>;
  writeBackup(target: AgentIntegrationTarget, data: string, backupName: string): Promise<string>;
}

export interface AgentIntegrationTokenEnvWriter {
  writeTokenEnv(
    target: AgentIntegrationTarget,
    input: { envVar: string; token: string },
  ): Promise<{ changed: boolean; restartRequired: boolean; message?: string }>;
}

type JsonObject = Record<string, unknown>;
type ExistingConfig =
  | { kind: 'missing' }
  | { kind: 'invalid'; raw: string }
  | { kind: 'json'; raw: string; value: JsonObject }
  | { kind: 'toml'; raw: string };

type ResolvedMcpConfig =
  | { type: 'stdio'; launchConfig: LinkTermMcpLaunchConfig; hasExplicitStdioType?: boolean }
  | { type: 'http'; url: string; bearerTokenEnvVar?: string };

/** Detects and installs LinkTerm MCP stdio configuration into supported local agent configs. */
export class AgentIntegrationManager {
  readonly #targets: ReadonlyArray<AgentIntegrationTarget>;
  readonly #launchConfig: LinkTermMcpLaunchConfig;
  readonly #fs: FsPrimitives;
  readonly #wslFiles: WslAgentConfigFileBridge | undefined;
  readonly #tokenEnvWriter: AgentIntegrationTokenEnvWriter | undefined;
  readonly #env: NodeJS.ProcessEnv;
  readonly #now: () => Date;
  readonly #installQueues = new Map<AgentIntegrationTargetId, Promise<unknown>>();
  #writeCounter = 0;

  constructor(options: AgentIntegrationManagerOptions) {
    this.#targets = options.targets;
    this.#launchConfig = options.launchConfig;
    this.#fs = options.fs ?? defaultFsPrimitives;
    this.#wslFiles = options.wslFiles;
    this.#tokenEnvWriter = options.tokenEnvWriter;
    this.#env = options.env ?? process.env;
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

  async diagnose(targetId: AgentIntegrationTargetId): Promise<AgentIntegrationDiagnosticResult> {
    const target = this.#requireTarget(targetId);
    const expected = mcpConfigForTarget(target, this.#launchConfig);
    const existing = await this.#readExistingConfig(target);
    const current =
      existing.kind === 'missing' || existing.kind === 'invalid'
        ? undefined
        : target.configKind === 'codex-config-toml'
          ? readCodexTomlLinkTermConfig(existing.raw)
          : existing.kind === 'json'
            ? readLinkTermConfig(existing.value, target)
            : undefined;
    const configMatches = current !== undefined && mcpConfigMatches(current, expected, target.configKind);
    const checks: AgentIntegrationDiagnosticCheck[] = [
      {
        id: 'config',
        label: 'Codex MCP config',
        status: configMatches ? 'pass' : 'fail',
        ...(existing.kind === 'missing' ? { message: 'Configuration file is missing' } : {}),
        ...(existing.kind === 'invalid' ? { message: 'Configuration file is invalid' } : {}),
      },
    ];
    if (expected.type === 'http' && expected.bearerTokenEnvVar) {
      const hasToken = Boolean(this.#env[expected.bearerTokenEnvVar]);
      checks.push({
        id: 'token-env',
        label: expected.bearerTokenEnvVar,
        status: hasToken ? 'pass' : 'fail',
        message: hasToken
          ? `${expected.bearerTokenEnvVar} is available in the current process environment`
          : `${expected.bearerTokenEnvVar} is not available in the current process environment`,
      });
    }
    return {
      targetId: target.id,
      label: target.label,
      transport: expected.type === 'http' ? 'HTTP' : 'stdio',
      checks,
    };
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
    const existing = await this.#readExistingConfig(target);
    if (existing.kind === 'invalid') throw new AgentConfigInvalidJsonError(target.configPath);

    const backupPath = await this.#backupIfExists(
      target,
      existing.kind === 'missing' ? undefined : existing.raw,
    );
    const mcpConfig = mcpConfigForTarget(target, this.#launchConfig);
    if (target.configKind === 'codex-config-toml') {
      const current = existing.kind === 'missing' ? '' : existing.raw;
      await this.#writeTargetConfigText(target, mergeCodexTomlConfig(current, mcpConfig));
    } else {
      if (mcpConfig.type !== 'stdio') {
        throw new Error(`HTTP MCP config is only supported for Codex targets: ${target.id}`);
      }
      const current = existing.kind === 'json' ? existing.value : {};
      await this.#writeConfig(
        target.configPath,
        mergeLinkTermConfig(current, target, mcpConfig.launchConfig),
      );
    }
    const status = await this.#statusFor(target);
    const tokenEnvResult = await this.#writeTokenEnvIfNeeded(target, mcpConfig);
    return {
      status: {
        ...status,
        backupPath,
        ...(tokenEnvResult?.message ? { message: tokenEnvResult.message } : {}),
      },
      ...(backupPath ? { backupPath } : {}),
    };
  }

  #requireTarget(targetId: AgentIntegrationTargetId): AgentIntegrationTarget {
    const target = this.#targets.find((t) => t.id === targetId);
    if (!target) throw new AgentIntegrationTargetNotFoundError(targetId);
    return target;
  }

  async #statusFor(target: AgentIntegrationTarget): Promise<AgentIntegrationStatus> {
    const existing = await this.#readExistingConfig(target);
    if (existing.kind === 'missing') {
      return toStatus(target, 'not-found', false, true);
    }
    if (existing.kind === 'invalid') {
      return toStatus(target, 'invalid-json', false, false, 'Configuration file is not valid JSON');
    }
    const current =
      target.configKind === 'codex-config-toml'
        ? readCodexTomlLinkTermConfig(existing.raw)
        : existing.kind === 'json'
          ? readLinkTermConfig(existing.value, target)
          : undefined;
    if (current === undefined) return toStatus(target, 'not-configured', false, true);
    const expected = mcpConfigForTarget(target, this.#launchConfig);
    const configured = mcpConfigMatches(
      current,
      expected,
      target.configKind,
    );
    if (
      configured &&
      expected.type === 'http' &&
      expected.bearerTokenEnvVar &&
      !this.#env[expected.bearerTokenEnvVar]
    ) {
      return toStatus(
        target,
        'needs-update',
        false,
        true,
        `Set ${expected.bearerTokenEnvVar} before starting Codex`,
      );
    }
    return toStatus(target, configured ? 'configured' : 'needs-update', configured, !configured);
  }

  async #readExistingConfig(target: AgentIntegrationTarget): Promise<ExistingConfig> {
    let raw: string;
    try {
      raw = await this.#readConfigText(target);
    } catch (err) {
      if (isNotFound(err)) return { kind: 'missing' };
      throw err;
    }
    if (target.configKind === 'codex-config-toml') {
      return { kind: 'toml', raw };
    }
    try {
      const parsed: unknown = parseJsonLike(raw);
      if (!isPlainObject(parsed)) return { kind: 'invalid', raw };
      return { kind: 'json', raw, value: parsed };
    } catch {
      return { kind: 'invalid', raw };
    }
  }

  async #backupIfExists(target: AgentIntegrationTarget, raw: string | undefined): Promise<string | undefined> {
    if (raw === undefined) return undefined;
    const backupPath = this.#nextSidecarPath(target.configPath, 'bak');
    const wslFiles = this.#wslFilesFor(target);
    if (wslFiles) {
      const backupName = backupPath.slice(`${target.configPath}.`.length);
      return wslFiles.writeBackup(target, raw, backupName);
    }
    await this.#fs.writeFile(backupPath, raw);
    return backupPath;
  }

  async #writeConfig(configPath: string, value: JsonObject): Promise<void> {
    await this.#writeConfigText(configPath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async #writeConfigText(configPath: string, data: string): Promise<void> {
    const dir = path.dirname(configPath);
    const tmp = this.#nextSidecarPath(configPath, 'tmp');
    await this.#fs.mkdir(dir, { recursive: true });
    try {
      await this.#fs.writeFile(tmp, data);
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

  async #readConfigText(target: AgentIntegrationTarget): Promise<string> {
    const wslFiles = this.#wslFilesFor(target);
    if (wslFiles) {
      return wslFiles.readFile(target);
    }
    return this.#fs.readFile(target.configPath);
  }

  async #writeTargetConfigText(target: AgentIntegrationTarget, data: string): Promise<void> {
    const wslFiles = this.#wslFilesFor(target);
    if (wslFiles) {
      await wslFiles.writeFile(target, data);
      return;
    }
    await this.#writeConfigText(target.configPath, data);
  }

  #wslFilesFor(target: AgentIntegrationTarget): WslAgentConfigFileBridge | undefined {
    return target.platform === 'wsl' && target.wslConfigPath !== undefined
      ? this.#wslFiles
      : undefined;
  }

  async #writeTokenEnvIfNeeded(
    target: AgentIntegrationTarget,
    mcpConfig: ResolvedMcpConfig,
  ): Promise<{ changed: boolean; restartRequired: boolean; message?: string } | undefined> {
    if (
      mcpConfig.type !== 'http' ||
      !mcpConfig.bearerTokenEnvVar ||
      !this.#tokenEnvWriter
    ) {
      return undefined;
    }
    const token = this.#env[mcpConfig.bearerTokenEnvVar];
    if (!token) return undefined;
    return this.#tokenEnvWriter.writeTokenEnv(target, {
      envVar: mcpConfig.bearerTokenEnvVar,
      token,
    });
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
    ...(target.platform ? { platform: target.platform } : {}),
    ...(target.locationLabel ? { locationLabel: target.locationLabel } : {}),
    ...(target.transport ? { transportLabel: target.transport.type === 'http' ? 'HTTP' : 'stdio' } : {}),
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

function launchConfigForTarget(
  target: AgentIntegrationTarget,
  fallback: LinkTermMcpLaunchConfig,
): LinkTermMcpLaunchConfig {
  if (target.launchConfig) return target.launchConfig;
  return target.platform === 'wsl' ? buildWslInteropLaunchConfig(fallback) : fallback;
}

function mcpConfigForTarget(
  target: AgentIntegrationTarget,
  fallback: LinkTermMcpLaunchConfig,
): ResolvedMcpConfig {
  if (target.transport?.type === 'http') {
    return {
      type: 'http',
      url: target.transport.url,
      ...(target.transport.bearerTokenEnvVar
        ? { bearerTokenEnvVar: target.transport.bearerTokenEnvVar }
        : {}),
    };
  }
  if (target.transport?.type === 'stdio') {
    return { type: 'stdio', launchConfig: target.transport.launchConfig };
  }
  return { type: 'stdio', launchConfig: launchConfigForTarget(target, fallback) };
}

export function buildWslInteropLaunchConfig(
  launchConfig: LinkTermMcpLaunchConfig,
): LinkTermMcpLaunchConfig {
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', windowsCommandLine([launchConfig.command, ...launchConfig.args])],
    env: { ...launchConfig.env },
    ...(launchConfig.cwd ? { cwd: launchConfig.cwd } : {}),
  };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mcpConfigMatches(
  current: unknown,
  expected: ResolvedMcpConfig,
  configKind: AgentIntegrationTarget['configKind'],
): boolean {
  if (!isPlainObject(current)) return false;
  if (expected.type === 'http') {
    return (
      configKind === 'codex-config-toml' &&
      current.url === expected.url &&
      (!expected.bearerTokenEnvVar ||
        current.bearerTokenEnvVar === expected.bearerTokenEnvVar ||
        current.bearer_token_env_var === expected.bearerTokenEnvVar)
    );
  }
  const parsedStdio = current.type === 'stdio' && isPlainObject(current.launchConfig)
    ? {
        launchConfig: current.launchConfig,
        hasExplicitStdioType: current.hasExplicitStdioType === true,
      }
    : undefined;
  const currentLaunchConfig = parsedStdio?.launchConfig ?? current;
  const launchConfig = expected.launchConfig;
  const baseMatches =
    currentLaunchConfig.command === launchConfig.command &&
    JSON.stringify(currentLaunchConfig.args ?? []) === JSON.stringify(launchConfig.args) &&
    (launchConfig.cwd === undefined || currentLaunchConfig.cwd === launchConfig.cwd) &&
    isPlainObject(currentLaunchConfig.env) &&
    envContainsExpected(currentLaunchConfig.env, launchConfig.env);
  const requiresStdioType = configKind === 'vscode-mcp-json' || configKind === 'codex-config-toml';
  const hasStdioType = parsedStdio?.hasExplicitStdioType ?? current.type === 'stdio';
  return requiresStdioType ? baseMatches && hasStdioType : baseMatches;
}

/**
 * Check whether the current launch environment contains every LinkTerm-managed variable.
 *
 * @param current Environment object from the external agent config.
 * @param expected LinkTerm-managed environment variables.
 * @returns True when all expected keys and values are present.
 */
function envContainsExpected(current: JsonObject, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(([key, value]) => current[key] === value);
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

function readCodexTomlLinkTermConfig(raw: string): ResolvedMcpConfig | undefined {
  const server = parseTomlTable(raw, 'mcp_servers.linkterm');
  if (!server) return undefined;
  const url = parseTomlString(server.url);
  if (url !== undefined) {
    const bearerTokenEnvVar = parseTomlString(server.bearer_token_env_var);
    return {
      type: 'http',
      url,
      ...(bearerTokenEnvVar ? { bearerTokenEnvVar } : {}),
    };
  }
  const command = parseTomlString(server.command);
  const args = parseTomlStringArray(server.args);
  if (command === undefined || args === undefined) return undefined;
  const envTable = parseTomlTable(raw, 'mcp_servers.linkterm.env') ?? {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envTable)) {
    const parsed = parseTomlString(value);
    if (parsed !== undefined) env[key] = parsed;
  }
  const type = parseTomlString(server.type);
  const cwd = parseTomlString(server.cwd);
  return {
    type: 'stdio',
    launchConfig: { command, args, env, ...(cwd ? { cwd } : {}) },
    hasExplicitStdioType: type === 'stdio',
  };
}

function mergeCodexTomlConfig(
  raw: string,
  mcpConfig: ResolvedMcpConfig,
): string {
  const base = removeTomlTables(raw, ['mcp_servers.linkterm', 'mcp_servers.linkterm.env'])
    .trimEnd();
  const block = renderCodexLinkTermToml(mcpConfig);
  return `${base ? `${base}\n\n` : ''}${block}\n`;
}

function renderCodexLinkTermToml(mcpConfig: ResolvedMcpConfig): string {
  if (mcpConfig.type === 'http') {
    return [
      '[mcp_servers.linkterm]',
      `url = ${tomlString(mcpConfig.url)}`,
      ...(mcpConfig.bearerTokenEnvVar
        ? [`bearer_token_env_var = ${tomlString(mcpConfig.bearerTokenEnvVar)}`]
        : []),
    ].join('\n');
  }
  const launchConfig = mcpConfig.launchConfig;
  const args = launchConfig.args.map(tomlString).join(', ');
  const envEntries = Object.entries(launchConfig.env).map(
    ([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`,
  );
  return [
    '[mcp_servers.linkterm]',
    'type = "stdio"',
    `command = ${tomlString(launchConfig.command)}`,
    `args = [ ${args} ]`,
    ...(launchConfig.cwd ? [`cwd = ${tomlString(launchConfig.cwd)}`] : []),
    '',
    '[mcp_servers.linkterm.env]',
    ...envEntries,
  ].join('\n');
}

function parseTomlTable(raw: string, tableName: string): Record<string, string> | undefined {
  let inTable = false;
  let found = false;
  const entries: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const section = parseTomlTableHeader(line);
    if (section !== undefined) {
      inTable = section === tableName;
      found ||= inTable;
      continue;
    }
    if (!inTable) continue;
    const assignment = parseTomlAssignment(line);
    if (assignment) entries[assignment.key] = assignment.value;
  }
  return found ? entries : undefined;
}

function removeTomlTables(raw: string, tableNames: ReadonlyArray<string>): string {
  let removing = false;
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const section = parseTomlTableHeader(line);
    if (section !== undefined) {
      removing = tableNames.includes(section);
    }
    if (!removing) out.push(line);
  }
  return out.join('\n');
}

function parseTomlTableHeader(line: string): string | undefined {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
  return match?.[1]?.trim();
}

function parseTomlAssignment(line: string): { key: string; value: string } | undefined {
  const trimmed = stripTomlComment(line).trim();
  if (!trimmed || trimmed.startsWith('[')) return undefined;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return undefined;
  return {
    key: trimmed.slice(0, eq).trim().replace(/^"(.+)"$/, '$1'),
    value: trimmed.slice(eq + 1).trim(),
  };
}

function parseTomlString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return undefined;
}

function parseTomlStringArray(value: string | undefined): string[] | undefined {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith('[') || !trimmed.endsWith(']')) return undefined;
  const items = splitTomlArrayItems(trimmed.slice(1, -1));
  const parsed = items.map(parseTomlString);
  return parsed.every((item): item is string => item !== undefined) ? parsed : undefined;
}

function splitTomlArrayItems(raw: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? '';
    if (quote) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\' && quote === '"') {
        escaped = true;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      if (current.trim()) items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function stripTomlComment(line: string): string {
  let quote = '';
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? '';
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\' && quote === '"') {
        escaped = true;
      } else if (ch === quote) {
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

function windowsCommandLine(parts: ReadonlyArray<string>): string {
  return parts.map(quoteWindowsArgument).join(' ');
}

function quoteWindowsArgument(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"]/u.test(value)) return value;
  let result = '"';
  let backslashes = 0;
  for (const ch of value) {
    if (ch === '\\') {
      backslashes += 1;
      continue;
    }
    if (ch === '"') {
      result += '\\'.repeat(backslashes * 2 + 1);
      result += ch;
      backslashes = 0;
      continue;
    }
    result += '\\'.repeat(backslashes);
    result += ch;
    backslashes = 0;
  }
  result += '\\'.repeat(backslashes * 2);
  result += '"';
  return result;
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
