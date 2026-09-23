import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { decodeFirmwareImageByPath, isSelfDescribingFirmwareImagePath } from '@linkterm/runtime/core/workspace/firmware-image';
import { formatHexAddress } from '@linkterm/runtime/core/workspace/intel-hex';
import { HttpError } from './http-utils.js';

const inside = (root: string, candidate: string): boolean => {
  const child = path.relative(root, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${path.sep}`) && !path.isAbsolute(child));
};

export interface DirectoryChoice { readonly id: string; readonly name: string; readonly path: string; }
export interface DirectoryListing { readonly current: DirectoryChoice | null; readonly directories: readonly DirectoryChoice[]; }

/** Only host-configured real directories are browseable by the browser picker. */
export class WorkspaceResources {
  readonly #roots: readonly string[];
  readonly #directories = new Map<string, string>();
  readonly #ids = new Map<string, string>();
  private constructor(roots: readonly string[]) { this.#roots = roots; }
  static async create(dataDir: string, configuredRoots?: readonly string[]): Promise<WorkspaceResources> {
    const inputs = configuredRoots ?? [path.join(dataDir, 'workspaces')];
    if (inputs.length === 0 || inputs.length > 16) throw new Error('Configure between one and sixteen workspace roots');
    if (!configuredRoots) await mkdir(inputs[0], { recursive: true, mode: 0o700 });
    const roots: string[] = [];
    for (const input of inputs) {
      if (!path.isAbsolute(input)) throw new Error(`Workspace root must be absolute: ${input}`);
      const canonical = await realpath(input);
      if (!(await stat(canonical)).isDirectory()) throw new Error(`Workspace root is not a directory: ${input}`);
      if (!roots.includes(canonical)) roots.push(canonical);
    }
    return new WorkspaceResources(roots);
  }
  #choice(directory: string): DirectoryChoice {
    let id = this.#ids.get(directory);
    if (!id) { id = randomUUID(); this.#ids.set(directory, id); this.#directories.set(id, directory); }
    return { id, name: path.basename(directory) || directory, path: directory };
  }
  async #verifyDirectory(id: string): Promise<string> {
    const candidate = this.#directories.get(id);
    if (!candidate) throw new HttpError(404, 'WORKSPACE_UNKNOWN');
    const canonical = await realpath(candidate).catch(() => { throw new HttpError(404, 'WORKSPACE_UNKNOWN'); });
    if (!this.#roots.some(root => inside(root, canonical)) || !(await stat(canonical)).isDirectory()) throw new HttpError(403, 'WORKSPACE_OUTSIDE_ROOT');
    return canonical;
  }
  async list(parentId?: string): Promise<DirectoryListing> {
    if (!parentId) return { current: null, directories: this.#roots.map(root => this.#choice(root)) };
    const parent = await this.#verifyDirectory(parentId);
    const entries = await readdir(parent, { withFileTypes: true });
    const directories: DirectoryChoice[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (directories.length >= 200) break;
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const candidate = await realpath(path.join(parent, entry.name)).catch(() => undefined);
      if (candidate && this.#roots.some(root => inside(root, candidate))) directories.push(this.#choice(candidate));
    }
    return { current: this.#choice(parent), directories };
  }
  async select(id: string): Promise<string> { return this.#verifyDirectory(id); }
  async create(parentId: string, name: string): Promise<DirectoryChoice> {
    if (!/^[\p{L}\p{N}_][\p{L}\p{N}._ -]{0,63}$/u.test(name) || name.endsWith('.') || name.endsWith(' ')) throw new HttpError(400, 'INVALID_WORKSPACE_NAME');
    const parent = await this.#verifyDirectory(parentId);
    const directory = path.join(parent, name);
    await mkdir(directory, { mode: 0o700 });
    const canonical = await realpath(directory);
    if (!this.#roots.some(root => inside(root, canonical))) throw new HttpError(403, 'WORKSPACE_OUTSIDE_ROOT');
    return this.#choice(canonical);
  }
  async requireDirectory(directory: string): Promise<string> {
    if (!path.isAbsolute(directory)) throw new HttpError(400, 'WORKSPACE_PATH_INVALID');
    const canonical = await realpath(directory).catch(() => { throw new HttpError(404, 'WORKSPACE_UNKNOWN'); });
    if (!this.#roots.some(root => inside(root, canonical)) || !(await stat(canonical)).isDirectory()) throw new HttpError(403, 'WORKSPACE_OUTSIDE_ROOT');
    return canonical;
  }
  async requireFile(file: string): Promise<string> {
    if (!path.isAbsolute(file)) throw new HttpError(400, 'FIRMWARE_PATH_INVALID');
    const canonical = await realpath(file).catch(() => { throw new HttpError(404, 'FIRMWARE_UNKNOWN'); });
    if (!this.#roots.some(root => inside(root, canonical)) || !(await stat(canonical)).isFile()) throw new HttpError(403, 'FIRMWARE_OUTSIDE_ROOT');
    return canonical;
  }
  async firmwareReference(root: string, reference: string): Promise<string> {
    if (path.isAbsolute(reference)) return this.requireFile(reference);
    if (reference.includes(':') || reference.includes('\0')) throw new HttpError(400, 'FIRMWARE_PATH_INVALID');
    const workspace = await this.requireDirectory(root);
    const candidate = path.resolve(workspace, reference);
    if (!inside(workspace, candidate) || candidate === workspace) throw new HttpError(403, 'FIRMWARE_OUTSIDE_ROOT');
    try {
      const canonicalFile = await realpath(candidate);
      if (!inside(workspace, canonicalFile) || !(await stat(canonicalFile)).isFile()) throw new HttpError(403, 'FIRMWARE_OUTSIDE_ROOT');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    let ancestor = path.dirname(candidate);
    while (inside(workspace, ancestor)) {
      try {
        const canonical = await realpath(ancestor);
        if (!inside(workspace, canonical)) throw new HttpError(403, 'FIRMWARE_OUTSIDE_ROOT');
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        ancestor = path.dirname(ancestor);
      }
    }
    return path.normalize(reference);
  }
}

export interface UploadedFirmware { readonly id: string; readonly name: string; readonly sha256: string; readonly byteLength: number; readonly baseAddress?: string; }

/** Firmware uploads live in a separate private host directory and use opaque IDs. */
export class FirmwareResources {
  readonly #root: string;
  private constructor(root: string) { this.#root = root; }
  static async create(dataDir: string): Promise<FirmwareResources> {
    const root = path.join(dataDir, 'uploaded-firmware');
    await mkdir(root, { recursive: true, mode: 0o700 });
    return new FirmwareResources(await realpath(root));
  }
  async upload(rawName: string, bytes: Buffer): Promise<UploadedFirmware> {
    let name: string;
    try { name = decodeURIComponent(rawName); } catch { throw new HttpError(400, 'INVALID_FIRMWARE_NAME'); }
    if (!/^[\p{L}\p{N}_][\p{L}\p{N}._ -]{0,127}\.(bin|hex|elf)$/iu.test(name) || name.includes('/') || name.includes('\\')) throw new HttpError(400, 'INVALID_FIRMWARE_NAME');
    if (!bytes.length || bytes.length > 32 * 1024 * 1024) throw new HttpError(413, 'FIRMWARE_SIZE_INVALID');
    let baseAddress: string | undefined;
    if (isSelfDescribingFirmwareImagePath(name)) {
      try {
        const image = decodeFirmwareImageByPath(name, bytes, { maxImageBytes: 32 * 1024 * 1024 });
        if (image.baseAddress !== undefined) baseAddress = formatHexAddress(image.baseAddress);
      } catch { throw new HttpError(400, 'INVALID_FIRMWARE_IMAGE'); }
    }
    const uuid = randomUUID();
    const filename = path.join(this.#root, `${uuid}${path.extname(name).toLowerCase()}`);
    const handle = await open(filename, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    return { id: `resource:${uuid}:${name}`, name, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, ...(baseAddress ? { baseAddress } : {}) };
  }
  async resolve(id: string): Promise<string> {
    const match = /^resource:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+\.(?:bin|hex|elf))$/iu.exec(id);
    if (!match) throw new HttpError(400, 'FIRMWARE_RESOURCE_INVALID');
    const candidate = path.join(this.#root, `${match[1]}${path.extname(match[2]).toLowerCase()}`);
    const canonical = await realpath(candidate).catch(() => { throw new HttpError(404, 'FIRMWARE_UNKNOWN'); });
    if (!inside(this.#root, canonical) || !(await stat(canonical)).isFile()) throw new HttpError(403, 'FIRMWARE_OUTSIDE_ROOT');
    return canonical;
  }
}
