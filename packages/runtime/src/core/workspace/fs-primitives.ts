/** Injectable fs primitives so the manager can be unit-tested without real disk. */

import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';

/**
 * 文件系统抽象，便于测试注入。
 *
 * 真实实现使用 `node:fs/promises`；fake 实现可以用 in-memory Map。
 */
export interface FsPrimitives {
  /** 读取 UTF-8 文本文件；不存在时抛 ENOENT。 */
  readFile(path: string): Promise<string>;
  /** 写入 UTF-8 文本文件（覆盖）；中间目录不存在时抛错。 */
  writeFile(path: string, data: string): Promise<void>;
  /** 递归创建目录；已存在时不报错。 */
  mkdir(path: string, opts: { recursive: true }): Promise<void>;
  /** 原子重命名；同分区内 POSIX/Win32 均原子。 */
  rename(from: string, to: string): Promise<void>;
  /** 删除文件；不存在时抛 ENOENT。 */
  unlink(path: string): Promise<void>;
  /** 查询文件元信息；不存在时抛 ENOENT。 */
  stat(path: string): Promise<{ isFile(): boolean; size: number }>;
}

/**
 * 默认 FsPrimitives 实现：直接代理 `node:fs/promises`。
 *
 * 单独导出方便 main 进程构造 WorkspaceConfigManager 时使用，也方便测试时显式断言
 * "默认实现来自这里"。
 */
export const defaultFsPrimitives: FsPrimitives = {
  readFile: (p) => readFile(p, 'utf-8'),
  writeFile: (p, d) => writeFile(p, d, 'utf-8'),
  mkdir: async (p, o) => {
    await mkdir(p, o);
  },
  rename: (from, to) => rename(from, to),
  unlink: (p) => unlink(p),
  stat: async (p) => {
    const s = await stat(p);
    return { isFile: () => s.isFile(), size: s.size };
  },
};
