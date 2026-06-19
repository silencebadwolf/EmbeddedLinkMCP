/** 控制工作流后台 job 生命周期管理。 */

import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import { ToolError } from '../../registry.js';
import type { ToolErrorCode } from '../../registry.js';
import type { RunControlWorkflowInput } from './schemas.js';
import type { ControlWorkflowData, ControlWorkflowStep } from './types.js';

/** 后台控制工作流 job 状态。 */
export type ControlWorkflowJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 后台 job 运行器可用的控制句柄。 */
export interface ControlWorkflowJobRunContext {
  signal: AbortSignal;
  update(data: ControlWorkflowData): void;
}

/** 后台 job 管理器配置。 */
export interface ControlWorkflowJobManagerOptions {
  now?: () => number;
  createId?: () => string;
  ttlMs?: number;
  maxRetainedJobs?: number;
}

/** 创建 job 时保留的非敏感输入快照。 */
export interface CreateControlWorkflowJobInput {
  input: RunControlWorkflowInput;
  correlationId?: string;
}

/** job 状态快照，不暴露 AbortController 等内部可变对象。 */
export interface ControlWorkflowJobSnapshot {
  jobId: string;
  state: ControlWorkflowJobState;
  mode: RunControlWorkflowInput['mode'];
  root: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  expiresAt?: number;
  updatedAt: number;
  currentStepId?: string;
  cancelRequested: boolean;
  correlationId?: string;
  workflow?: ControlWorkflowData;
}

/** cleanup 操作返回值。 */
export interface ControlWorkflowJobCleanupResult {
  removed: number;
}

interface ControlWorkflowJobRecord {
  jobId: string;
  state: ControlWorkflowJobState;
  input: RunControlWorkflowInput;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  currentStepId?: string;
  cancelRequested: boolean;
  correlationId?: string;
  workflow?: ControlWorkflowData;
  controller: AbortController;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_RETAINED_JOBS = 32;

/**
 * 管理 LinkTerm 控制工作流后台 job 的内存态生命周期。
 *
 * 该类不导入 Electron，不直接触碰硬件；调用方注入实际 workflow runner。
 */
export class ControlWorkflowJobManager {
  readonly #jobs = new Map<string, ControlWorkflowJobRecord>();
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #ttlMs: number;
  readonly #maxRetainedJobs: number;

  /**
   * 创建 job 管理器。
   *
   * @param options 测试和运行时配置；生产缺省使用随机 UUID、系统时间和固定保留策略
   */
  constructor(options: ControlWorkflowJobManagerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => `cwjob-${randomUUID()}`);
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#maxRetainedJobs = options.maxRetainedJobs ?? DEFAULT_MAX_RETAINED_JOBS;
  }

  /**
   * 创建 queued job；若已有 active job，会拒绝以保护共享硬件资源。
   *
   * @param request 已通过 schema 校验的 workflow 输入
   * @returns 新 job 的快照
   */
  create(request: CreateControlWorkflowJobInput): ControlWorkflowJobSnapshot {
    this.#cleanupExpired();
    if (this.#activeJob() !== undefined) {
      throw new ToolError(ERROR_CODES.INVALID_STATE, 'An active control workflow job is already running');
    }
    const now = this.#now();
    const record: ControlWorkflowJobRecord = {
      jobId: this.#createId(),
      state: 'queued',
      input: { ...request.input },
      createdAt: now,
      updatedAt: now,
      cancelRequested: false,
      controller: new AbortController(),
    };
    if (request.correlationId !== undefined) record.correlationId = request.correlationId;
    this.#jobs.set(record.jobId, record);
    return this.#snapshot(record);
  }

  /**
   * 启动 queued job，并在完成后写入终态和最终证据。
   *
   * @param jobId 待启动 job id
   * @param runner 实际 workflow 执行函数
   * @returns job 完成后的终态快照
   */
  async start(
    jobId: string,
    runner: (ctx: ControlWorkflowJobRunContext) => Promise<ControlWorkflowData>,
  ): Promise<ControlWorkflowJobSnapshot> {
    const record = this.#requireJob(jobId);
    if (record.state !== 'queued') {
      throw new ToolError(ERROR_CODES.INVALID_STATE, `Control workflow job ${jobId} is not queued`);
    }
    this.#markRunning(record);
    try {
      const workflow = await runner({
        signal: record.controller.signal,
        update: (data) => this.update(jobId, data),
      });
      if (record.cancelRequested || record.controller.signal.aborted) {
        this.#markCancelled(record, workflow);
      } else if (workflow.failedStep !== undefined) {
        this.#markTerminal(record, 'failed', workflow);
      } else {
        this.#markTerminal(record, 'succeeded', workflow);
      }
    } catch (err) {
      if (record.cancelRequested || isAbortError(err)) {
        this.#markCancelled(record, appendTerminalStep(record.workflow, record.input, 'job_cancelled', 'ABORTED', 'Control workflow job was cancelled'));
      } else {
        const error = err instanceof ToolError
          ? err
          : new ToolError(ERROR_CODES.INTERNAL, err instanceof Error ? err.message : String(err));
        this.#markTerminal(record, 'failed', appendTerminalStep(record.workflow, record.input, 'job_failed', error.code, error.message));
      }
    }
    this.#cleanupRetained();
    return this.#snapshot(record);
  }

  /**
   * 更新 running job 的部分或最终 workflow 证据。
   *
   * @param jobId job id
   * @param data 最新 workflow 证据
   * @returns 更新后的 job 快照
   */
  update(jobId: string, data: ControlWorkflowData): ControlWorkflowJobSnapshot {
    const record = this.#requireJob(jobId);
    record.workflow = cloneWorkflow(data);
    record.currentStepId = lastStepId(data);
    record.updatedAt = this.#now();
    return this.#snapshot(record);
  }

  /**
   * 读取轻量状态快照；不存在或已过期时抛 NOT_FOUND。
   *
   * @param jobId job id
   * @returns job 快照
   */
  getStatus(jobId: string): ControlWorkflowJobSnapshot {
    this.#cleanupExpired();
    return this.#snapshot(this.#requireJob(jobId));
  }

  /**
   * 读取 job 证据；不存在或已过期时抛 NOT_FOUND。
   *
   * @param jobId job id
   * @returns job 快照，包含 partial/final workflow
   */
  read(jobId: string): ControlWorkflowJobSnapshot {
    this.#cleanupExpired();
    return this.#snapshot(this.#requireJob(jobId));
  }

  /**
   * 请求取消 job；active job 会触发 AbortSignal，终态 job 保持幂等。
   *
   * @param jobId job id
   * @returns 取消请求后的 job 快照
   */
  cancel(jobId: string): ControlWorkflowJobSnapshot {
    this.#cleanupExpired();
    const record = this.#requireJob(jobId);
    if (isActive(record)) {
      record.cancelRequested = true;
      record.updatedAt = this.#now();
      record.controller.abort();
      if (record.state === 'queued') {
        this.#markCancelled(record, appendTerminalStep(record.workflow, record.input, 'job_cancelled', 'ABORTED', 'Control workflow job was cancelled'));
      }
    }
    return this.#snapshot(record);
  }

  /**
   * 清理 retained job。
   *
   * @param options jobId 指定单个 job；expiredOnly 只清理已过期 job
   * @returns 删除数量
   */
  cleanup(options: { jobId?: string; expiredOnly?: boolean } = {}): ControlWorkflowJobCleanupResult {
    let removed = 0;
    if (options.jobId !== undefined) {
      const record = this.#jobs.get(options.jobId);
      if (record !== undefined && !isActive(record) && (!options.expiredOnly || this.#isExpired(record))) {
        this.#jobs.delete(options.jobId);
        removed = 1;
      }
      return { removed };
    }

    for (const [jobId, record] of this.#jobs) {
      if (isActive(record)) continue;
      if (options.expiredOnly === true && !this.#isExpired(record)) continue;
      this.#jobs.delete(jobId);
      removed += 1;
    }
    return { removed };
  }

  /**
   * 列出所有 job 快照，按创建顺序返回。
   *
   * @returns job 快照数组
   */
  listJobs(): ControlWorkflowJobSnapshot[] {
    this.#cleanupExpired();
    return Array.from(this.#jobs.values()).map((record) => this.#snapshot(record));
  }

  #markRunning(record: ControlWorkflowJobRecord): void {
    const now = this.#now();
    record.state = 'running';
    record.startedAt = now;
    record.updatedAt = now;
  }

  #markTerminal(
    record: ControlWorkflowJobRecord,
    state: Exclude<ControlWorkflowJobState, 'queued' | 'running' | 'cancelled'>,
    workflow: ControlWorkflowData,
  ): void {
    const now = this.#now();
    record.state = state;
    record.workflow = cloneWorkflow(workflow);
    record.currentStepId = lastStepId(workflow);
    record.completedAt = now;
    record.updatedAt = now;
  }

  #markCancelled(record: ControlWorkflowJobRecord, workflow: ControlWorkflowData): void {
    const now = this.#now();
    record.state = 'cancelled';
    record.cancelRequested = true;
    record.workflow = cloneWorkflow(workflow);
    record.currentStepId = lastStepId(workflow);
    record.completedAt = now;
    record.updatedAt = now;
  }

  #activeJob(): ControlWorkflowJobRecord | undefined {
    return Array.from(this.#jobs.values()).find(isActive);
  }

  #requireJob(jobId: string): ControlWorkflowJobRecord {
    const record = this.#jobs.get(jobId);
    if (record === undefined) {
      throw new ToolError('NOT_FOUND', `Control workflow job ${jobId} not found`);
    }
    return record;
  }

  #cleanupExpired(): void {
    for (const [jobId, record] of this.#jobs) {
      if (!isActive(record) && this.#isExpired(record)) {
        this.#jobs.delete(jobId);
      }
    }
  }

  #cleanupRetained(): void {
    const retained = Array.from(this.#jobs.values())
      .filter((record) => !isActive(record))
      .sort((a, b) => a.updatedAt - b.updatedAt);
    while (retained.length > this.#maxRetainedJobs) {
      const oldest = retained.shift();
      if (oldest !== undefined) this.#jobs.delete(oldest.jobId);
    }
  }

  #isExpired(record: ControlWorkflowJobRecord): boolean {
    return record.completedAt !== undefined && this.#now() >= record.completedAt + this.#ttlMs;
  }

  #snapshot(record: ControlWorkflowJobRecord): ControlWorkflowJobSnapshot {
    const snapshot: ControlWorkflowJobSnapshot = {
      jobId: record.jobId,
      state: record.state,
      mode: record.input.mode,
      root: record.input.root,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      cancelRequested: record.cancelRequested,
    };
    if (record.startedAt !== undefined) snapshot.startedAt = record.startedAt;
    if (record.completedAt !== undefined) {
      snapshot.completedAt = record.completedAt;
      snapshot.expiresAt = record.completedAt + this.#ttlMs;
    }
    if (record.currentStepId !== undefined) snapshot.currentStepId = record.currentStepId;
    if (record.correlationId !== undefined) snapshot.correlationId = record.correlationId;
    if (record.workflow !== undefined) snapshot.workflow = cloneWorkflow(record.workflow);
    return snapshot;
  }
}

function isActive(record: ControlWorkflowJobRecord): boolean {
  return record.state === 'queued' || record.state === 'running';
}

function lastStepId(data: ControlWorkflowData): string | undefined {
  return data.steps.at(-1)?.id;
}

function isAbortError(err: unknown): boolean {
  return err instanceof ToolError && err.code === ERROR_CODES.ABORTED;
}

function cloneWorkflow(data: ControlWorkflowData): ControlWorkflowData {
  return {
    ...data,
    steps: data.steps.map((step) => ({ ...step, error: step.error === undefined ? undefined : { ...step.error } })),
    summary: { ...data.summary },
    nextActions: data.nextActions.map((action) => ({ ...action })),
    ...(data.blockingReasons ? { blockingReasons: data.blockingReasons.map((reason) => ({ ...reason })) } : {}),
  };
}

function appendTerminalStep(
  existing: ControlWorkflowData | undefined,
  input: RunControlWorkflowInput,
  id: string,
  code: ToolErrorCode,
  message: string,
): ControlWorkflowData {
  const base = existing ?? emptyWorkflow(input);
  const step: ControlWorkflowStep = {
    id,
    status: 'failed',
    durationMs: 0,
    error: { code, message },
  };
  return {
    ...cloneWorkflow(base),
    failedStep: id,
    steps: [...base.steps, step],
  };
}

function emptyWorkflow(input: RunControlWorkflowInput): ControlWorkflowData {
  return {
    mode: input.mode,
    root: input.root,
    steps: [],
    summary: {
      serialOpened: false,
      probeConnected: false,
      gdbServerStarted: false,
      flashed: false,
      verified: false,
      reset: false,
      serialObserved: false,
      debugCaptured: false,
    },
    nextActions: [],
  };
}
