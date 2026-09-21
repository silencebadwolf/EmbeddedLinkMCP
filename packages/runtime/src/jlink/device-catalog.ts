import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { normalizeJLinkTargetName } from '@linkterm/contracts/jlink-target-name';
import { resolveDefaultCommanderPath } from './segger-command-runner.js';

export interface JLinkDeviceFlashBank {
  name?: string;
  baseAddress?: string;
  maxSize?: string;
  loader?: string;
}

export interface JLinkDeviceInfo {
  name: string;
  vendor?: string;
  core?: string;
  aliases?: string[];
  jlinkScriptFile?: string;
  sourceFile: string;
  flashBanks: JLinkDeviceFlashBank[];
}

export interface JLinkDeviceSearchRequest {
  query?: string;
  vendor?: string;
  limit?: number;
}

export interface JLinkDeviceSearchResult {
  available: boolean;
  reason?: 'database-not-found';
  devices: JLinkDeviceInfo[];
  sourceFiles: string[];
  queryNormalization?: { originalQuery: string; normalizedQuery: string };
}

export interface JLinkDeviceCatalog {
  search(request: JLinkDeviceSearchRequest): Promise<JLinkDeviceSearchResult>;
  get(name: string): Promise<JLinkDeviceInfo | undefined>;
  has(name: string): Promise<boolean>;
  refresh(): Promise<void>;
}

export interface JLinkDeviceCatalogOptions {
  installRoots?: readonly string[];
  commanderPath?: string;
  internalDeviceListXmlPath?: string;
  cacheRoot?: string;
  internalDeviceListExporter?: JLinkInternalDeviceListExporter;
  internalDeviceListExportTimeoutMs?: number;
}

export interface JLinkInternalDeviceListExportRequest {
  commanderPath: string;
  outputPath: string;
  timeoutMs: number;
}

export type JLinkInternalDeviceListExporter = (
  request: JLinkInternalDeviceListExportRequest,
) => Promise<boolean>;

interface SourceSignature {
  path: string;
  mtimeMs: number;
  size: number;
}

interface CatalogSnapshot {
  signatures: SourceSignature[];
  sourceFiles: string[];
  devices: JLinkDeviceInfo[];
  byName: Map<string, JLinkDeviceInfo>;
}

const MAX_DEVICE_XML_FILES = 2000;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_INTERNAL_DEVICE_EXPORT_TIMEOUT_MS = 15_000;
const execFileAsync = promisify(execFile);

export function createJLinkDeviceCatalog(options: JLinkDeviceCatalogOptions = {}): JLinkDeviceCatalog {
  return new DefaultJLinkDeviceCatalog(options);
}

class DefaultJLinkDeviceCatalog implements JLinkDeviceCatalog {
  readonly #options: JLinkDeviceCatalogOptions;
  #snapshot: CatalogSnapshot | undefined;
  #loading: Promise<CatalogSnapshot> | undefined;
  #forceRefresh = false;

  constructor(options: JLinkDeviceCatalogOptions) {
    this.#options = options;
  }

  async search(request: JLinkDeviceSearchRequest): Promise<JLinkDeviceSearchResult> {
    const snapshot = await this.#loadSnapshot();
    if (snapshot.sourceFiles.length === 0) {
      return { available: false, reason: 'database-not-found', devices: [], sourceFiles: [] };
    }

    const query = request.query?.trim() ?? '';
    const vendor = request.vendor?.trim().toLowerCase() ?? '';
    const limit = normalizeLimit(request.limit);
    const normalizedQuery = query === '' ? '' : normalizeJLinkTargetName(query);
    const queryNormalization =
      query !== '' && normalizedQuery !== query ? { originalQuery: query, normalizedQuery } : undefined;
    const tokens = uniqueStrings([query, normalizedQuery].filter((token) => token !== ''));

    const ranked = snapshot.devices
      .map((device) => ({ device, score: scoreDevice(device, tokens, vendor) }))
      .filter((entry) => entry.score !== Number.POSITIVE_INFINITY)
      .sort((a, b) => a.score - b.score || a.device.name.length - b.device.name.length || a.device.name.localeCompare(b.device.name));

    return {
      available: true,
      devices: ranked.slice(0, limit).map((entry) => entry.device),
      sourceFiles: snapshot.sourceFiles,
      ...(queryNormalization === undefined ? {} : { queryNormalization }),
    };
  }

  async get(name: string): Promise<JLinkDeviceInfo | undefined> {
    const snapshot = await this.#loadSnapshot();
    return snapshot.byName.get(name.trim().toLowerCase());
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== undefined;
  }

  async refresh(): Promise<void> {
    this.#forceRefresh = true;
    this.#snapshot = await this.#loadSnapshot();
  }

  async #loadSnapshot(): Promise<CatalogSnapshot> {
    if (!this.#forceRefresh && this.#loading !== undefined) return this.#loading;

    const loading = this.#loadSnapshotNow(this.#forceRefresh);
    this.#loading = loading;
    try {
      return await loading;
    } finally {
      if (this.#loading === loading) this.#loading = undefined;
    }
  }

  async #loadSnapshotNow(forceRefresh: boolean): Promise<CatalogSnapshot> {
    const signatures = await discoverSourceSignatures(this.#options, forceRefresh);
    if (!this.#forceRefresh && this.#snapshot !== undefined && sameSignatures(this.#snapshot.signatures, signatures)) {
      return this.#snapshot;
    }

    const sourceFiles = signatures.map((signature) => signature.path);
    const devices = parseSourceFiles(sourceFiles);
    const byName = new Map<string, JLinkDeviceInfo>();
    for (const device of devices) {
      const key = device.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, device);
    }
    this.#snapshot = { signatures, sourceFiles, devices: [...byName.values()], byName };
    this.#forceRefresh = false;
    return this.#snapshot;
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) return DEFAULT_SEARCH_LIMIT;
  return Math.min(limit, 100);
}

async function discoverSourceSignatures(options: JLinkDeviceCatalogOptions, forceInternalExport: boolean): Promise<SourceSignature[]> {
  const sourceFiles = await discoverSourceFiles(options, forceInternalExport);
  return sourceFiles.flatMap((filePath) => {
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) return [];
      return [{ path: filePath, mtimeMs: stat.mtimeMs, size: stat.size }];
    } catch {
      return [];
    }
  });
}

async function discoverSourceFiles(options: JLinkDeviceCatalogOptions, forceInternalExport: boolean): Promise<string[]> {
  const roots = resolveInstallRoots(options);
  const files: string[] = [];
  for (const root of roots) {
    const mainDatabase = path.join(root, 'JLinkDevices.xml');
    if (existsSync(mainDatabase)) files.push(mainDatabase);

    const devicesRoot = path.join(root, 'Devices');
    if (existsSync(devicesRoot)) {
      collectXmlFiles(devicesRoot, files, MAX_DEVICE_XML_FILES);
    }
    if (files.length >= MAX_DEVICE_XML_FILES) break;
  }

  const internalDeviceList = await resolveInternalDeviceListXml(options, forceInternalExport);
  if (internalDeviceList !== undefined) files.push(internalDeviceList);
  return uniqueStrings(files).slice(0, MAX_DEVICE_XML_FILES);
}

async function resolveInternalDeviceListXml(
  options: JLinkDeviceCatalogOptions,
  forceExport: boolean,
): Promise<string | undefined> {
  const configuredXml = options.internalDeviceListXmlPath?.trim();
  if (configuredXml !== undefined && configuredXml !== '') {
    return isReadableFile(configuredXml) ? configuredXml : undefined;
  }

  const commanderPath = resolveCatalogCommanderPath(options);
  if (commanderPath === undefined) return undefined;

  const outputPath = internalDeviceListCachePath(options, commanderPath);
  if (!forceExport && isFreshInternalDeviceList(outputPath, commanderPath)) return outputPath;

  const exporter = options.internalDeviceListExporter ?? exportInternalDeviceListXml;
  await mkdir(path.dirname(outputPath), { recursive: true }).catch(() => undefined);
  const ok = await exporter({
    commanderPath,
    outputPath,
    timeoutMs: options.internalDeviceListExportTimeoutMs ?? DEFAULT_INTERNAL_DEVICE_EXPORT_TIMEOUT_MS,
  }).catch(() => false);
  if (ok && isReadableFile(outputPath)) return outputPath;
  return isReadableFile(outputPath) ? outputPath : undefined;
}

function resolveCatalogCommanderPath(options: JLinkDeviceCatalogOptions): string | undefined {
  const commanderPath = options.commanderPath ?? (options.installRoots === undefined ? resolveDefaultCommanderPath() : undefined);
  if (commanderPath === undefined || commanderPath.trim() === '') return undefined;
  return path.isAbsolute(commanderPath) && existsSync(commanderPath) ? commanderPath : undefined;
}

function internalDeviceListCachePath(options: JLinkDeviceCatalogOptions, commanderPath: string): string {
  const hash = createHash('sha256').update(commanderPath).digest('hex').slice(0, 16);
  return path.join(options.cacheRoot ?? path.join(os.tmpdir(), 'linkterm-jlink-device-catalog'), `ExpDevListXML-${hash}.xml`);
}

function isFreshInternalDeviceList(outputPath: string, commanderPath: string): boolean {
  try {
    const output = statSync(outputPath);
    const commander = statSync(commanderPath);
    return output.isFile() && output.size > 0 && output.mtimeMs >= commander.mtimeMs;
  } catch {
    return false;
  }
}

function isReadableFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function exportInternalDeviceListXml(request: JLinkInternalDeviceListExportRequest): Promise<boolean> {
  await mkdir(path.dirname(request.outputPath), { recursive: true });
  const commandFilePath = path.join(
    path.dirname(request.outputPath),
    `${path.basename(request.outputPath)}.${process.pid}.${Date.now()}.jlink`,
  );
  await writeFile(commandFilePath, `ExpDevListXML ${quoteCommanderScriptPath(request.outputPath)}\nExit\n`, 'utf-8');
  try {
    await execFileAsync(
      request.commanderPath,
      ['-ExitOnError', '1', '-NoGui', '1', '-CommandFile', commandFilePath],
      { timeout: request.timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    return isReadableFile(request.outputPath);
  } finally {
    await rm(commandFilePath, { force: true }).catch(() => undefined);
  }
}

function quoteCommanderScriptPath(filePath: string): string {
  if (/["\r\n]/u.test(filePath)) return filePath;
  return /\s/u.test(filePath) ? `"${filePath}"` : filePath;
}

function resolveInstallRoots(options: JLinkDeviceCatalogOptions): string[] {
  if (options.installRoots !== undefined) {
    return uniqueStrings(options.installRoots.map((root) => root.trim()).filter((root) => root !== ''));
  }

  const commanderPath = options.commanderPath ?? resolveDefaultCommanderPath();
  const explicitRoot = commanderPath === undefined ? undefined : path.dirname(commanderPath);
  return uniqueStrings([
    explicitRoot,
    process.env.LINKTERM_JLINK_INSTALL_DIR,
    process.env.JLINK_PATH,
    'C:\\Program Files\\SEGGER\\JLink',
    'C:\\Program Files (x86)\\SEGGER\\JLink',
    'D:\\Program Files\\SEGGER\\JLink',
    'D:\\Program Files (x86)\\SEGGER\\JLink',
    '/opt/SEGGER/JLink',
    '/usr/local/SEGGER/JLink',
    '/Applications/SEGGER/JLink',
  ].filter((root): root is string => root !== undefined && root.trim() !== ''));
}

function collectXmlFiles(root: string, files: string[], maxFiles: number): void {
  if (files.length >= maxFiles) return;
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = readdirSync(root, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectXmlFiles(entryPath, files, maxFiles);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.xml')) {
      files.push(entryPath);
    }
  }
}

function parseSourceFiles(sourceFiles: readonly string[]): JLinkDeviceInfo[] {
  const devices: JLinkDeviceInfo[] = [];
  for (const sourceFile of sourceFiles) {
    try {
      devices.push(...parseDeviceXml(readFileSync(sourceFile, 'utf-8'), sourceFile));
    } catch {
      // Ignore malformed third-party AddOn XML files; other catalogs can still be useful.
    }
  }
  return devices;
}

function parseDeviceXml(xml: string, sourceFile: string): JLinkDeviceInfo[] {
  return [...parseSeggerDeviceXml(xml, sourceFile), ...parseExportedDeviceDatabaseXml(xml, sourceFile)];
}

function parseSeggerDeviceXml(xml: string, sourceFile: string): JLinkDeviceInfo[] {
  const devices: JLinkDeviceInfo[] = [];
  const devicePattern = /<Device\b[\s\S]*?<\/Device\s*>/giu;
  let match: RegExpExecArray | null;
  while ((match = devicePattern.exec(xml)) !== null) {
    const deviceText = match[0]!;
    const chipMatch = deviceText.match(/<ChipInfo\b([^>]*)\/?>/iu);
    if (chipMatch === null) continue;
    const chipInfo = parseAttributes(chipMatch[1]!);
    const name = chipInfo.Name?.trim();
    if (name === undefined || name === '') continue;
    devices.push({
      name,
      vendor: chipInfo.Vendor,
      core: chipInfo.Core,
      jlinkScriptFile: chipInfo.JLinkScriptFile,
      sourceFile,
      flashBanks: parseFlashBanks(deviceText),
    });
  }
  return devices;
}

function parseExportedDeviceDatabaseXml(xml: string, sourceFile: string): JLinkDeviceInfo[] {
  const devices: JLinkDeviceInfo[] = [];
  const vendorPattern = /<VendorInfo\b([^>]*)>([\s\S]*?)<\/VendorInfo\s*>/giu;
  let vendorMatch: RegExpExecArray | null;
  while ((vendorMatch = vendorPattern.exec(xml)) !== null) {
    const vendor = parseAttributes(vendorMatch[1]!).Name;
    devices.push(...parseExportedDeviceInfos(vendorMatch[2]!, sourceFile, vendor));
  }
  return devices;
}

function parseExportedDeviceInfos(text: string, sourceFile: string, vendor: string | undefined): JLinkDeviceInfo[] {
  const devices: JLinkDeviceInfo[] = [];
  const devicePattern = /<DeviceInfo\b([^>]*)(?:\/>|>([\s\S]*?)<\/DeviceInfo\s*>)/giu;
  let match: RegExpExecArray | null;
  while ((match = devicePattern.exec(text)) !== null) {
    const attrs = parseAttributes(match[1]!);
    const name = attrs.Name?.trim();
    if (name === undefined || name === '') continue;
    const aliases = parseAliases(match[2] ?? '');
    devices.push({
      name,
      vendor: attrs.Vendor ?? vendor,
      core: attrs.Core,
      ...(aliases.length > 0 ? { aliases } : {}),
      sourceFile,
      flashBanks: [],
    });
  }
  return devices;
}

function parseAliases(deviceText: string): string[] {
  const aliases: string[] = [];
  const aliasPattern = /<AliasInfo\b([^>]*)\/?>/giu;
  let match: RegExpExecArray | null;
  while ((match = aliasPattern.exec(deviceText)) !== null) {
    const alias = parseAttributes(match[1]!).Name?.trim();
    if (alias !== undefined && alias !== '') aliases.push(alias);
  }
  return uniqueStrings(aliases);
}

function parseFlashBanks(deviceText: string): JLinkDeviceFlashBank[] {
  const flashBanks: JLinkDeviceFlashBank[] = [];
  const flashPattern = /<FlashBankInfo\b([^>]*)\/?>/giu;
  let match: RegExpExecArray | null;
  while ((match = flashPattern.exec(deviceText)) !== null) {
    const attrs = parseAttributes(match[1]!);
    flashBanks.push({
      name: attrs.Name,
      baseAddress: attrs.BaseAddr,
      maxSize: attrs.MaxSize,
      loader: attrs.Loader,
    });
  }
  return flashBanks;
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /(\w+)\s*=\s*"([^"]*)"/gu;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(text)) !== null) {
    attributes[match[1]!] = decodeXmlEntities(match[2]!);
  }
  return attributes;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function scoreDevice(device: JLinkDeviceInfo, tokens: readonly string[], vendor: string): number {
  if (vendor !== '' && !includesCaseInsensitive(device.vendor, vendor)) return Number.POSITIVE_INFINITY;
  if (tokens.length === 0) return 0;
  return Math.min(...tokens.map((token) => scoreDeviceForToken(device, token)));
}

function scoreDeviceForToken(device: JLinkDeviceInfo, token: string): number {
  const normalizedToken = token.toLowerCase();
  const normalizedName = device.name.toLowerCase();
  const nameWithoutVendorPrefix = normalizedName.startsWith('-') ? normalizedName.slice(1) : normalizedName;
  if (normalizedName === normalizedToken || nameWithoutVendorPrefix === normalizedToken) return 0;
  if (device.aliases?.some((alias) => alias.toLowerCase() === normalizedToken) === true) return 0.5;
  if (normalizedName.startsWith(normalizedToken) || nameWithoutVendorPrefix.startsWith(normalizedToken)) return 1;
  if (device.aliases?.some((alias) => alias.toLowerCase().startsWith(normalizedToken)) === true) return 1.5;
  if (normalizedName.includes(normalizedToken) || nameWithoutVendorPrefix.includes(normalizedToken)) return 2;
  if (device.aliases?.some((alias) => alias.toLowerCase().includes(normalizedToken)) === true) return 2.5;
  if (deviceMetadataSearchText(device).includes(normalizedToken)) return 3;
  return Number.POSITIVE_INFINITY;
}

function deviceMetadataSearchText(device: JLinkDeviceInfo): string {
  return [
    device.vendor,
    device.core,
    ...(device.aliases ?? []),
    device.jlinkScriptFile,
    ...device.flashBanks.flatMap((bank) => [bank.name, bank.baseAddress, bank.maxSize, bank.loader]),
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ')
    .toLowerCase();
}

function includesCaseInsensitive(value: string | undefined, query: string): boolean {
  return value?.toLowerCase().includes(query) ?? false;
}

function sameSignatures(a: readonly SourceSignature[], b: readonly SourceSignature[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return right !== undefined && left.path === right.path && left.mtimeMs === right.mtimeMs && left.size === right.size;
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
