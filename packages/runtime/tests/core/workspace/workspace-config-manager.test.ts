import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat as realStat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceAlreadyInitializedError,
  WorkspaceConfigManager,
  WorkspaceConfigTooLargeError,
  WorkspaceInvalidRootError,
  WorkspaceNotFoundError,
  WorkspaceSchemaVersionMismatchError,
  type EvidenceSnapshot,
  type FsPrimitives,
} from '@linkterm/runtime/core/workspace/index';

async function createTmpRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'lt-ws-'));
}

const NO_PORTS: EvidenceSnapshot = { serialPorts: [] };

/** Build a real-fs–backed FsPrimitives shim that includes the new `unlink` / `size` surface. */
function realFs(): FsPrimitives {
  return {
    readFile: (p) => readFile(p, 'utf-8'),
    writeFile: async () => {
      throw new Error('writeFile not stubbed');
    },
    mkdir: async () => {},
    rename: async () => {},
    unlink: async () => {},
    stat: async (p) => {
      const s = await realStat(p);
      return { isFile: () => s.isFile(), size: s.size };
    },
  };
}

describe('WorkspaceConfigManager (real fs)', () => {
  let root: string;

  beforeEach(async () => {
    root = await createTmpRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('init creates .linkterm/config.json with schemaVersion', async () => {
    const m = new WorkspaceConfigManager();
    const cfg = await m.init(root);
    expect(cfg.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    const raw = await readFile(path.join(root, '.linkterm', 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
  });

  it('init throws WorkspaceAlreadyInitializedError on second call', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    await expect(m.init(root)).rejects.toBeInstanceOf(WorkspaceAlreadyInitializedError);
  });

  it('init force=true overwrites existing config', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    await m.update(root, { chip: { family: 'STM32F4', part: 'X' } });
    const cfg = await m.init(root, { force: true });
    // 重置后 chip 应被清空
    expect(cfg.chip).toBeUndefined();
  });

  it('init rejects non-absolute root', async () => {
    const m = new WorkspaceConfigManager();
    await expect(m.init('relative/path')).rejects.toBeInstanceOf(WorkspaceInvalidRootError);
  });

  it('init rejects ".." segments', async () => {
    const m = new WorkspaceConfigManager();
    // 直接拼接而非 path.join，避免 ".." 被规范化掉。
    const evil = `${path.sep}tmp${path.sep}..${path.sep}evil`;
    await expect(m.init(evil)).rejects.toBeInstanceOf(WorkspaceInvalidRootError);
  });

  it('load throws WorkspaceNotFoundError when config does not exist', async () => {
    const m = new WorkspaceConfigManager();
    await expect(m.load(root)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('load returns the persisted config', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    await m.update(root, { chip: { family: 'STM32F4', part: 'STM32F407' } });
    const cfg = await m.load(root);
    expect(cfg.chip).toEqual({ family: 'STM32F4', part: 'STM32F407' });
  });

  it('update shallow-merges sections (chip survives subsequent flash patch)', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    await m.update(root, { chip: { family: 'STM32F4', part: 'STM32F407' } });
    await m.update(root, { flash: { tool: 'jlink' } });
    const cfg = await m.load(root);
    expect(cfg.chip).toEqual({ family: 'STM32F4', part: 'STM32F407' });
    expect(cfg.flash).toEqual({ tool: 'jlink' });
  });

  it('update fully replaces a section (no recursive merge)', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    await m.update(root, {
      flash: { tool: 'jlink', binary: 'fw.bin', baseAddress: 0x08000000 },
    });
    await m.update(root, { flash: { tool: 'openocd' } });
    const cfg = await m.load(root);
    expect(cfg.flash).toEqual({ tool: 'openocd' });
    // binary / baseAddress 没保留 —— 整体替换
  });

  it('validateOnly=true does not write to disk', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    const result = await m.update(
      root,
      { chip: { family: 'STM32F4', part: 'X' } },
      { validateOnly: true },
    );
    expect(result.config.chip).toEqual({ family: 'STM32F4', part: 'X' });
    const persisted = await m.load(root);
    expect(persisted.chip).toBeUndefined();
  });

  it('validateOnly=true does not mutate getCurrent() snapshot', async () => {
    // M7：dry-run 不应静默切换激活工作区；调用前后 getCurrent() 应保持一致。
    const m = new WorkspaceConfigManager();
    const before = m.getCurrent();
    expect(before).toBeNull();

    await m.update(
      root,
      { chip: { family: 'STM32F4', part: 'X' } },
      { validateOnly: true },
    ).catch(() => {});
    // 由于工作区未 init，update 内部 load 会抛 WorkspaceNotFoundError；
    // 但即使抛错，#current 也不该被改写为该 root（因为 validateOnly 期望 snapshot/restore）。
    expect(m.getCurrent()).toBeNull();

    // 现在 init 一份 + 进入第二个工作区做 dry-run，验证 #current 不被切换：
    const otherRoot = await createTmpRoot();
    try {
      await m.init(root);
      const snapshot = m.getCurrent();
      expect(snapshot?.root).toBe(root);

      // 在 otherRoot 上 dry-run 会因为没初始化而抛错；但即便不抛，validateOnly 也不应切换激活。
      await m
        .update(otherRoot, { chip: { family: 'STM32F4', part: 'Y' } }, { validateOnly: true })
        .catch(() => {});
      expect(m.getCurrent()?.root).toBe(root);
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it('update returns conflict report with missingFields', async () => {
    const m = new WorkspaceConfigManager({ evidenceFn: async () => NO_PORTS });
    await m.init(root);
    const r = await m.update(root, { chip: { family: 'STM32F4', part: 'X' } });
    expect(r.conflicts.missingFields).toEqual(['flash', 'debug', 'rtt', 'serial']);
  });

  it('update reports serial port conflict via injected evidenceFn', async () => {
    const m = new WorkspaceConfigManager({ evidenceFn: async () => NO_PORTS });
    await m.init(root);
    const r = await m.update(root, {
      serial: { port: '/dev/missing', baudRate: 9600, mode: 'normal' },
    });
    expect(r.conflicts.conflicts).toHaveLength(1);
    expect(r.conflicts.conflicts[0]!.field).toBe('serial.port');
  });

  it('update rejects unknown patch keys via Zod strict mode', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    await expect(
      m.update(root, { credentials: { password: 'leak' } } as never),
    ).rejects.toThrow();
  });

  it('getCurrent returns null before any init/load', () => {
    const m = new WorkspaceConfigManager();
    expect(m.getCurrent()).toBeNull();
  });

  it('getCurrent reflects most recently activated workspace', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    const cur = m.getCurrent();
    expect(cur?.root).toBe(root);
    expect(cur?.config.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
  });

  it('getCurrent returns a deep clone (mutating it does not corrupt internal state)', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    await m.update(root, { chip: { family: 'STM32F4', part: 'A' } });
    const cur = m.getCurrent();
    expect(cur?.config.chip).toEqual({ family: 'STM32F4', part: 'A' });
    // 突变返回值不应影响内部状态
    cur!.config.chip = { family: 'EVIL', part: 'INJECTED' };
    const again = m.getCurrent();
    expect(again?.config.chip).toEqual({ family: 'STM32F4', part: 'A' });
  });

  it('atomic write: writeFile failure leaves prior config intact', async () => {
    // 1) 先正常写入一份配置；2) 注入会在 writeFile 抛错的 fs；3) update 失败；4) 仍能读到旧值。
    const m1 = new WorkspaceConfigManager();
    await m1.init(root);
    await m1.update(root, { chip: { family: 'STM32F4', part: 'OLD' } });

    let writeAttempts = 0;
    let unlinkCalled = 0;
    const flakyFs: FsPrimitives = {
      ...realFs(),
      writeFile: async () => {
        writeAttempts++;
        throw new Error('ENOSPC: simulated disk full');
      },
      unlink: async () => {
        unlinkCalled++;
      },
      mkdir: async () => {},
      rename: async () => {},
    };
    const m2 = new WorkspaceConfigManager({ fs: flakyFs });
    await expect(m2.update(root, { chip: { family: 'STM32F4', part: 'NEW' } })).rejects.toThrow(
      /ENOSPC/,
    );
    expect(writeAttempts).toBeGreaterThan(0);
    // M4：失败路径会 best-effort 调一次 unlink 清理 .tmp 残留。
    expect(unlinkCalled).toBeGreaterThan(0);

    // 旧值依旧可读：原子 temp+rename 不会破坏旧文件；这里 writeFile 直接抛错，rename 没机会触发。
    const m3 = new WorkspaceConfigManager();
    const persisted = await m3.load(root);
    expect(persisted.chip).toEqual({ family: 'STM32F4', part: 'OLD' });
  });

  it('writeAtomic cleans up .tmp residue on writeFile failure', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    const tmpFile = path.join(root, '.linkterm', 'config.json.tmp');

    const unlinkTargets: string[] = [];
    const fs: FsPrimitives = {
      ...realFs(),
      mkdir: async () => {},
      writeFile: async () => {
        throw new Error('boom');
      },
      rename: async () => {},
      unlink: async (p) => {
        unlinkTargets.push(p);
      },
    };
    const m2 = new WorkspaceConfigManager({ fs });
    await expect(m2.update(root, { chip: { family: 'STM32F4', part: 'X' } })).rejects.toThrow(
      /boom/,
    );
    expect(unlinkTargets).toContain(tmpFile);
  });

  it('load throws on JSON corruption (translated to SyntaxError)', async () => {
    const fakeFs: FsPrimitives = {
      readFile: async () => '{not valid json',
      writeFile: async () => {},
      mkdir: async () => {},
      rename: async () => {},
      unlink: async () => {},
      stat: async () => ({ isFile: () => true, size: 16 }),
    };
    const m = new WorkspaceConfigManager({ fs: fakeFs });
    await expect(m.load(root)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('load throws WorkspaceSchemaVersionMismatchError on bad schemaVersion', async () => {
    const fakeFs: FsPrimitives = {
      readFile: async () => JSON.stringify({ schemaVersion: 'wrong/0.0.0' }),
      writeFile: async () => {},
      mkdir: async () => {},
      rename: async () => {},
      unlink: async () => {},
      stat: async () => ({ isFile: () => true, size: 64 }),
    };
    const m = new WorkspaceConfigManager({ fs: fakeFs });
    await expect(m.load(root)).rejects.toBeInstanceOf(WorkspaceSchemaVersionMismatchError);
  });

  it('load rejects files larger than 1 MiB', async () => {
    const fakeFs: FsPrimitives = {
      readFile: async () => '{"schemaVersion":"linkterm-workspace/1.0.0"}',
      writeFile: async () => {},
      mkdir: async () => {},
      rename: async () => {},
      unlink: async () => {},
      stat: async () => ({ isFile: () => true, size: 2 * 1024 * 1024 }),
    };
    const m = new WorkspaceConfigManager({ fs: fakeFs });
    await expect(m.load(root)).rejects.toBeInstanceOf(WorkspaceConfigTooLargeError);
  });

  it('propagates evidenceFn errors', async () => {
    // L2 重命名：原标题 "escalates severity=error..." 与 Phase 8 全 warn 语义不符；
    // 该用例真正断言的是 evidenceFn 抛错时 update 不静默吞错。
    const m = new WorkspaceConfigManager({
      evidenceFn: async () => {
        throw new Error('evidence query failed');
      },
    });
    await m.init(root);
    await expect(
      m.update(root, { serial: { port: '/dev/x', baudRate: 9600, mode: 'normal' } }),
    ).rejects.toThrow(/evidence query failed/);
  });

  it('serializes concurrent update() calls without losing patches', async () => {
    // C1：两个并发 update 不应互相覆盖。
    const m = new WorkspaceConfigManager();
    await m.init(root);
    const [a, b] = await Promise.all([
      m.update(root, { chip: { family: 'STM32F4', part: 'A' } }),
      m.update(root, { flash: { tool: 'jlink' } }),
    ]);
    // 两次返回都应完整有效（不要求顺序，但每次都保留之前已写入的字段）。
    expect(a.config.chip ?? b.config.chip).toEqual({ family: 'STM32F4', part: 'A' });
    expect(a.config.flash ?? b.config.flash).toEqual({ tool: 'jlink' });

    const persisted = await m.load(root);
    expect(persisted.chip).toEqual({ family: 'STM32F4', part: 'A' });
    expect(persisted.flash).toEqual({ tool: 'jlink' });
  });

  it('serial lock survives rejected update (does not poison subsequent updates)', async () => {
    const m = new WorkspaceConfigManager();
    await m.init(root);
    // 首个 update 因 unknown key 失败；后续 update 仍能正常进入。
    await expect(
      m.update(root, { credentials: { password: 'leak' } } as never),
    ).rejects.toThrow();
    const ok = await m.update(root, { chip: { family: 'STM32F4', part: 'X' } });
    expect(ok.config.chip).toEqual({ family: 'STM32F4', part: 'X' });

    // 防御：清理可能残留的 .tmp（避免影响其他测试 root，但本测试 root 在 afterEach 整目录删除）
    await unlink(path.join(root, '.linkterm', 'config.json.tmp')).catch(() => {});
  });
});
