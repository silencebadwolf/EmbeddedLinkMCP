/** run_control_workflow 的确定性状态机实现。 */

import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { VerifiedDeploymentEvidence } from '../../../core/compensation/index.js';
import type { SessionManager } from '../../../core/session/session-manager.js';
import { SerialSessionConflictError } from '../../../core/session/serial-session-coordinator.js';
import {
  defaultHostPathResolver,
  type ControlProfileManager,
  type ControlProfile,
  type HostPathResolver,
} from '../../../core/workspace/index.js';
import { formatHexAddress } from '../../../core/workspace/intel-hex.js';
import {
  decodeFirmwareImageByPath,
  isFirmwareImageParseError,
  type FirmwareImageFormat,
} from '../../../core/workspace/firmware-image.js';
import type {
  FlashProgressUpdate,
  IJLinkBackend,
  ProbeConnectOptions,
  ProbeInfo,
  RegisterValue,
  RttChannelInfo,
} from '../../../jlink/types.js';
import type { JLinkDeviceCatalog } from '../../../jlink/device-catalog.js';
import { resolveJLinkTarget, type JLinkTargetResolution } from '../../../jlink/target-resolver.js';
import { JLinkNotImplementedError, JLinkOperationError } from '../../../jlink/errors.js';
import type { SerialSessionConfig } from '../../../shared/types.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import { MAX_BINARY_BYTES } from '../../limits.js';
import { ToolError, type ToolErrorCode } from '../../registry.js';
import { translateJLinkError } from '../debug/error-translate.js';
import { validateFirmwareVectorTable } from '../debug/firmware-sanity.js';
import type { ControlProfileOpenSerial } from '../control-profile/tools.js';
import type { RunControlWorkflowInput } from './schemas.js';
import type {
  ControlWorkflowBlockingReason,
  ControlWorkflowData,
  ControlWorkflowFailureCode,
  ControlWorkflowNextAction,
  ControlWorkflowStep,
  ControlWorkflowSummary,
} from './types.js';

/** run_control_workflow 状态机依赖。 */
export interface ControlWorkflowRunnerDeps {
  controlProfileManager: ControlProfileManager;
  sessionManager: SessionManager;
  jlinkBackend: IJLinkBackend;
  jlinkDeviceCatalog?: JLinkDeviceCatalog;
  openSerial: ControlProfileOpenSerial;
  hostPathResolver?: HostPathResolver;
}

/** run_control_workflow 的可选后台 job 集成点。 */
export interface ControlWorkflowRunOptions {
  signal?: AbortSignal;
  onUpdate?: (data: ControlWorkflowData) => void;
  onVerifiedDeployment?: (evidence: VerifiedDeploymentEvidence) => void;
}

interface ResolvedFirmware {
  absolutePath: string;
  baseAddress: number;
  verify: boolean;
  binary: Buffer;
  sourcePath: string;
  format: FirmwareImageFormat;
  timeoutMs?: number;
  parameterSources: {
    filePath: 'profile' | 'request';
    baseAddress: 'profile' | 'request';
    verify: 'default' | 'profile' | 'request';
    timeoutMs: 'default' | 'request';
  };
}

interface JLinkParameterSources {
  target: 'profile';
  interface: 'linkterm-default' | 'profile';
  speedKHz: 'linkterm-default' | 'profile';
}

interface TargetNormalizationEvidence {
  originalTarget: string;
  normalizedTarget: string;
  kind: 'stm32-order-code';
  message?: string;
}

interface SpeedPolicyEvidence {
  profileSpeedKHz: number | 'auto' | undefined;
  resolvedSpeedKHz: number;
  reason: 'safe-raw-flash';
}

interface WorkflowContext {
  input: RunControlWorkflowInput;
  hostRoot: string;
  profile: ControlProfile;
  steps: ControlWorkflowStep[];
  blockingReasons: ControlWorkflowBlockingReason[];
  nextActions: ControlWorkflowNextAction[];
  summary: ControlWorkflowSummary;
  failedStep?: string;
  failureCode?: ControlWorkflowFailureCode;
  serialSessionId?: string;
  observeStartCursor?: number;
  rttChannelIndex?: number;
  probe?: Omit<ProbeInfo, 'serialNumber'>;
  targetResolution?: JLinkTargetResolution;
  compensationFirmware?: ResolvedFirmware;
  signal?: AbortSignal;
  onUpdate?: (data: ControlWorkflowData) => void;
  onVerifiedDeployment?: (evidence: VerifiedDeploymentEvidence) => void;
}

interface CommanderAvailability {
  available: boolean;
  reason?: string;
  message?: string;
  target?: string;
  targetSupported?: boolean;
}

interface GdbServerAvailability {
  available: boolean;
  reason?: string;
  message?: string;
  target?: string;
  targetSupported?: boolean;
}

interface CommanderAvailabilityProvider {
  checkCommanderAvailability(
    target?: string,
  ): CommanderAvailability | Promise<CommanderAvailability>;
}

interface GdbServerAvailabilityProvider {
  checkGdbServerAvailability(
    target?: string,
  ): GdbServerAvailability | Promise<GdbServerAvailability>;
}

const AUTO_JLINK_SPEEDS_KHZ = [50_000, 25_000, 10_000, 8_000, 4_000, 1_000] as const;
const SAFE_RAW_FLASH_SPEED_KHZ = 4_000;
const DEFAULT_OBSERVE_TIMEOUT_MS = 15_000;
const DEFAULT_OBSERVE_MARKERS = ['msh', 'RT-Thread', 'ready', 'boot'] as const;
const DEFAULT_RTT_READ_MAX_BYTES = 4096;
const DEFAULT_RTT_POLL_INTERVAL_MS = 100;

/**
 * 执行高层控制工作流：读取 profile、打开串口、连接 J-Link、按需烧录/复位/观察/诊断。
 *
 * @param deps 共享运行时依赖，必须与 MCP server/main process 同实例
 * @param input 已通过 Zod 校验的工具入参
 * @returns 可直接放入 MCP evidence.data 的结构化工作流结果
 */
export async function runControlWorkflow(
  deps: ControlWorkflowRunnerDeps,
  input: RunControlWorkflowInput,
  options: ControlWorkflowRunOptions = {},
): Promise<ControlWorkflowData> {
  throwIfAborted(options.signal);
  const hostRoot = await (deps.hostPathResolver ?? defaultHostPathResolver).toHostPath(input.root);
  const profile = await deps.controlProfileManager.load(hostRoot);
  const ctx: WorkflowContext = {
    input,
    hostRoot,
    profile,
    steps: [],
    blockingReasons: [],
    nextActions: [],
    summary: emptySummary(),
  };
  if (options.signal !== undefined) ctx.signal = options.signal;
  if (options.onUpdate !== undefined) ctx.onUpdate = options.onUpdate;
  if (options.onVerifiedDeployment !== undefined) {
    ctx.onVerifiedDeployment = options.onVerifiedDeployment;
  }

  pushStep(ctx, 'load_profile', 'passed', {
    profileLoaded: true,
    root: input.root,
    hostRoot,
    rootResolved: hostRoot !== input.root,
  });

  try {
    throwIfAborted(ctx.signal);
    const firmware = await preflight(
      ctx,
      deps.jlinkBackend,
      deps.jlinkDeviceCatalog,
      deps.hostPathResolver ?? defaultHostPathResolver,
    );
    if (firmware !== undefined) ctx.compensationFirmware = firmware;
    if (ctx.failedStep !== undefined) {
      return await finalizeWorkflow(ctx, deps.jlinkBackend);
    }

    throwIfAborted(ctx.signal);
    if (input.dryRun === true) {
      pushDryRunSteps(ctx, firmware);
      return await finalizeWorkflow(ctx, deps.jlinkBackend);
    }

    if (needsSerial(input, profile)) {
      throwIfAborted(ctx.signal);
      const serialReady = await openSerialStep(ctx, deps.openSerial);
      if (!serialReady) return await finalizeWorkflow(ctx, deps.jlinkBackend);
    }

    throwIfAborted(ctx.signal);
    await connectProbeStep(ctx, deps.jlinkBackend);

    if (needsFlash(input)) {
      throwIfAborted(ctx.signal);
      await flashStep(ctx, deps.jlinkBackend, firmware);
      if (ctx.failedStep !== undefined) return await finalizeWorkflow(ctx, deps.jlinkBackend);
    }

    if (needsSerial(input, profile)) {
      throwIfAborted(ctx.signal);
      prepareSerialObservation(ctx, deps.sessionManager);
    }

    if (needsRtt(input, profile)) {
      throwIfAborted(ctx.signal);
      await startGdbServerStep(ctx, deps.jlinkBackend);
      throwIfAborted(ctx.signal);
      await connectRttStep(ctx, deps.jlinkBackend);
      if (ctx.failedStep !== undefined) return await finalizeWorkflow(ctx, deps.jlinkBackend);
    }

    if (needsReset(input)) {
      throwIfAborted(ctx.signal);
      await resetStep(ctx, deps.jlinkBackend);
    }

    if (needsSerial(input, profile)) {
      throwIfAborted(ctx.signal);
      await observeSerialStep(ctx, deps.sessionManager);
    }

    if (needsRtt(input, profile)) {
      throwIfAborted(ctx.signal);
      await observeRttStep(ctx, deps.jlinkBackend);
    }

    if (shouldCaptureDebug(ctx)) {
      throwIfAborted(ctx.signal);
      if (!ctx.summary.gdbServerStarted) {
        await startGdbServerStep(ctx, deps.jlinkBackend);
      }
      throwIfAborted(ctx.signal);
      await diagnoseStep(ctx, deps.jlinkBackend);
    }

    return await finalizeWorkflow(ctx, deps.jlinkBackend);
  } catch (err) {
    await stopManagedGdbServerStep(ctx, deps.jlinkBackend);
    throw err;
  }
}

/**
 * 预检 profile 与入参，解析固件路径和烧录地址。
 *
 * @param ctx 工作流上下文
 * @param jlinkBackend J-Link backend；可选暴露 Commander 可用性检查
 * @returns 需要烧录时返回已解析固件；debug-only 模式返回 undefined
 */
async function preflight(
  ctx: WorkflowContext,
  jlinkBackend: IJLinkBackend,
  jlinkDeviceCatalog: JLinkDeviceCatalog | undefined,
  hostPathResolver: HostPathResolver,
): Promise<ResolvedFirmware | undefined> {
  const { input, profile } = ctx;
  if (profile.jlink?.enabled !== true || profile.jlink.target === undefined) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      'run_control_workflow requires jlink.enabled=true and jlink.target in control-profile.json',
    );
  }

  if (needsSerial(input, profile) && !serialProfileComplete(profile)) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      'serial observation requires serial.enabled=true, serial.port, serial.baudRate, and serial.mode in control-profile.json',
    );
  }

  ctx.targetResolution = await resolveJLinkTarget(profile.jlink.target, jlinkDeviceCatalog);

  if (needsFlash(input) && input.dryRun !== true) {
    const target = ctx.targetResolution.target;
    const availability = await getCommanderAvailability(jlinkBackend, target);
    if (availability?.available === false) {
      const targetUnsupported = availability.reason === 'target-unsupported';
      const errorMessage = targetUnsupported
        ? `J-Link target ${availability.target ?? profile.jlink.target} is not supported by local SEGGER device databases`
        : 'J-Link Commander executable is not available';
      addBlockingReason(ctx, {
        kind: targetUnsupported ? 'jlink_target_unsupported' : 'jlink_commander_unavailable',
        code: ERROR_CODES.JLINK_OPERATION_FAILED,
        message: availability.message ?? errorMessage,
        details: { reason: availability.reason ?? 'not-found', target: availability.target },
      });
      ctx.failedStep = 'preflight';
      ctx.nextActions.push({
        kind: 'user_action',
        message: targetUnsupported
          ? `安装包含 ${availability.target ?? profile.jlink.target} 的 SEGGER device add-on，或把 control-profile.json 中的 jlink.target 改为本机 J-Link 支持的目标名后重试。`
          : '安装 SEGGER J-Link，或把 LINKTERM_JLINK_COMMANDER 设置为已存在的 J-Link Commander 绝对路径后重试。',
      });
      pushStep(ctx, 'preflight', 'failed', { blockingReasons: ctx.blockingReasons }, undefined, {
        code: ERROR_CODES.JLINK_OPERATION_FAILED,
        message: errorMessage,
        details: { reason: availability.reason ?? 'not-found', target: availability.target },
      });
      return undefined;
    }
  }

  if (
    (input.mode === 'debug-diagnose' ||
      input.debug?.rttRead === true ||
      needsRtt(input, profile)) &&
    input.dryRun !== true
  ) {
    const target = ctx.targetResolution.target;
    const availability = await getGdbServerAvailability(jlinkBackend, target);
    if (availability?.available === false) {
      const targetUnsupported = availability.reason === 'target-unsupported';
      const errorMessage = targetUnsupported
        ? `J-Link target ${availability.target ?? profile.jlink.target} is not supported by local SEGGER device databases`
        : 'J-Link GDB server executable is not available';
      addBlockingReason(ctx, {
        kind: targetUnsupported ? 'jlink_target_unsupported' : 'jlink_gdb_server_unavailable',
        code: ERROR_CODES.JLINK_OPERATION_FAILED,
        message: availability.message ?? errorMessage,
        details: { reason: availability.reason ?? 'not-found', target: availability.target },
      });
      ctx.failedStep = 'preflight';
      ctx.nextActions.push({
        kind: 'user_action',
        message: targetUnsupported
          ? `安装包含 ${availability.target ?? profile.jlink.target} 的 SEGGER device add-on，或把 control-profile.json 中的 jlink.target 改为本机 J-Link 支持的目标名后重试。`
          : '安装 SEGGER J-Link，或把 LINKTERM_JLINK_GDB_SERVER 设置为已存在的 J-Link GDB server 绝对路径后重试。',
      });
      pushStep(ctx, 'preflight', 'failed', { blockingReasons: ctx.blockingReasons }, undefined, {
        code: ERROR_CODES.JLINK_OPERATION_FAILED,
        message: errorMessage,
        details: { reason: availability.reason ?? 'not-found', target: availability.target },
      });
      return undefined;
    }
  }

  let firmware: ResolvedFirmware | undefined;
  if (needsFlash(input)) {
    firmware = await resolveFirmware(ctx.hostRoot, input.firmware, profile, hostPathResolver);
  }

  pushStep(ctx, 'preflight', 'passed', {
    needsSerial: needsSerial(input, profile),
    needsRtt: needsRtt(input, profile),
    needsFlash: needsFlash(input),
    needsDebug: input.mode === 'debug-diagnose',
    targetResolution: ctx.targetResolution,
  });
  return firmware;
}

/**
 * 按 profile 打开串口，并把会话 id 放入上下文。
 *
 * @param ctx 工作流上下文
 * @param openSerial 串口打开函数
 * @returns true 表示串口已就绪；false 表示已记录结构化阻塞原因
 */
async function openSerialStep(
  ctx: WorkflowContext,
  openSerial: ControlProfileOpenSerial,
): Promise<boolean> {
  const started = Date.now();
  try {
    if (!serialProfileComplete(ctx.profile)) {
      throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'serial profile is incomplete');
    }
    const serial = ctx.profile.serial;
    const result = await openSerial({
      type: 'serial',
      port: serial.port,
      baudRate: serial.baudRate,
      mode: serial.mode,
      label: 'LinkTerm Control Workflow: serial',
    } satisfies SerialSessionConfig);
    ctx.serialSessionId = result.sessionId;
    ctx.summary.serialOpened = true;
    pushStep(
      ctx,
      'open_serial',
      'passed',
      {
        sessionId: result.sessionId,
        state: result.state,
        ...(result.reused !== undefined ? { reused: result.reused } : {}),
      },
      started,
    );
    return true;
  } catch (err) {
    if (serialProfileComplete(ctx.profile)) {
      const serial = ctx.profile.serial;
      const errorCode =
        err instanceof SerialSessionConflictError
          ? ERROR_CODES.SERIAL_SESSION_CONFLICT
          : ERROR_CODES.INVALID_STATE;
      addBlockingReason(ctx, {
        kind: 'serial_open_failed',
        code: errorCode,
        message: safeErrorMessage(err),
        details: { port: serial.port, baudRate: serial.baudRate, mode: serial.mode },
      });
      ctx.failedStep = 'open_serial';
      ctx.nextActions.push({
        kind: 'user_action',
        message: `串口 ${serial.port} 无法打开；请关闭占用该端口的终端/烧录工具，或在 control-profile 中改成当前可用串口后重试。`,
      });
      pushStep(ctx, 'open_serial', 'failed', { blockingReasons: ctx.blockingReasons }, started, {
        code: errorCode,
        message: 'Serial port is not available for control workflow',
        details: { port: serial.port, baudRate: serial.baudRate, mode: serial.mode },
      });
      return false;
    }
    failStepAndThrow(ctx, 'open_serial', started, err);
  }
}

/**
 * 连接 J-Link probe，支持 profile speedKHz='auto' 时降速回退。
 *
 * @param ctx 工作流上下文
 * @param jlinkBackend J-Link backend
 */
async function connectProbeStep(ctx: WorkflowContext, jlinkBackend: IJLinkBackend): Promise<void> {
  const started = Date.now();
  try {
    const jlink = ctx.profile.jlink;
    if (jlink?.target === undefined) {
      throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'jlink.target is required');
    }
    if (jlink.interface === undefined) {
      throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'jlink.interface is required');
    }
    if (jlink.speedKHz === undefined) {
      throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'jlink.speedKHz is required');
    }
    const targetResolution = ctx.targetResolution ?? (await resolveJLinkTarget(jlink.target));
    const opts: ProbeConnectOptions = {
      target: targetResolution.target,
      interface: jlink.interface,
    };
    const speedPolicy = resolveSafeSpeedPolicy(ctx);
    const speedKHz = speedPolicy?.resolvedSpeedKHz ?? jlink.speedKHz;
    const probe = await connectProbeWithConfiguredSpeed(jlinkBackend, opts, speedKHz);
    ctx.probe = sanitizeProbeForMcp(probe);
    ctx.summary.probeConnected = true;
    const evidence: {
      probe: Omit<ProbeInfo, 'serialNumber'>;
      parameterSources: JLinkParameterSources;
      speedPolicy?: SpeedPolicyEvidence;
      targetNormalization?: TargetNormalizationEvidence;
    } = {
      probe: ctx.probe,
      parameterSources: {
        target: 'profile',
        interface: jlink.interface === undefined ? 'linkterm-default' : 'profile',
        speedKHz: jlink.speedKHz === undefined ? 'linkterm-default' : 'profile',
      },
    };
    if (targetResolution.normalization !== undefined) {
      evidence.targetNormalization = targetResolution.normalization;
    }
    if (speedPolicy !== undefined) evidence.speedPolicy = speedPolicy;
    pushStep(ctx, 'connect_probe', 'passed', evidence, started);
  } catch (err) {
    failStepAndThrow(ctx, 'connect_probe', started, err);
  }
}

/**
 * 从服务器侧读取固件文件并烧录；避免让 AI 在 MCP JSON 中切分 base64。
 *
 * @param ctx 工作流上下文
 * @param jlinkBackend J-Link backend
 * @param firmware 已解析固件信息
 */
async function flashStep(
  ctx: WorkflowContext,
  jlinkBackend: IJLinkBackend,
  firmware: ResolvedFirmware | undefined,
): Promise<void> {
  const started = Date.now();
  try {
    if (firmware === undefined) {
      throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'flash workflow requires firmware');
    }
    const probeId = requireProbeId(ctx);
    const runningEvidence = {
      firmwarePath: firmware.absolutePath,
      sourcePath: firmware.sourcePath,
      address: firmware.baseAddress,
      bytesTotal: firmware.binary.byteLength,
      verify: firmware.verify,
      firmwareFormat: firmware.format,
      timeoutMs: firmware.timeoutMs,
      parameterSources: firmware.parameterSources,
    };
    let latestProgress: FlashProgressUpdate | undefined;
    const updateProgress = (progress: FlashProgressUpdate): void => {
      latestProgress = progress;
      const last = ctx.steps[ctx.steps.length - 1];
      if (last?.id !== 'flash' || last.status !== 'running') return;
      last.durationMs = Math.max(0, Date.now() - started);
      last.evidence = { ...runningEvidence, progress };
      ctx.onUpdate?.(toData(ctx));
    };
    pushStep(ctx, 'flash', 'running', runningEvidence, started);
    const result = await jlinkBackend.flashDownload(
      probeId,
      firmware.binary,
      {
        address: firmware.baseAddress,
        verify: firmware.verify,
        timeoutMs: firmware.timeoutMs,
        onProgress: updateProgress,
      },
      ctx.signal,
    );
    ctx.summary.flashed = true;
    ctx.summary.verified = result.verified;
    const passedEvidence = {
      firmwarePath: firmware.absolutePath,
      sourcePath: firmware.sourcePath,
      bytesWritten: result.bytesWritten,
      verified: result.verified,
      verification: {
        requested: firmware.verify,
        method: firmware.verify ? 'commander-verifybin-plus-savebin-readback' : 'not-requested',
        postDownloadReadbackRequired: firmware.verify,
      },
      address: firmware.baseAddress,
      firmwareFormat: firmware.format,
      timeoutMs: firmware.timeoutMs,
      parameterSources: firmware.parameterSources,
      ...(latestProgress !== undefined ? { progress: latestProgress } : {}),
    };
    pushStep(ctx, 'flash', 'passed', passedEvidence, started);
  } catch (err) {
    if (captureClassifiedStepFailure(ctx, 'flash', started, err)) return;
    failStepAndThrow(ctx, 'flash', started, err);
  }
}

/**
 * 尝试 reset；当前 backend 未实现时按用户选项 C 降级为 skipped，继续串口观察。
 *
 * @param ctx 工作流上下文
 * @param jlinkBackend J-Link backend
 */
async function resetStep(ctx: WorkflowContext, jlinkBackend: IJLinkBackend): Promise<void> {
  const started = Date.now();
  try {
    await jlinkBackend.cpuReset(requireProbeId(ctx), { halt: false });
    ctx.summary.reset = true;
    pushStep(ctx, 'cpu_reset', 'passed', { halt: false }, started);
  } catch (err) {
    if (err instanceof JLinkNotImplementedError) {
      pushStep(
        ctx,
        'cpu_reset',
        'skipped',
        undefined,
        started,
        toStepError(
          new ToolError(ERROR_CODES.NOT_IMPLEMENTED, err.message, { method: err.method }),
        ),
      );
      ctx.nextActions.push({
        kind: 'diagnose',
        tool: 'cpu_reset',
        message:
          '当前 J-Link backend 尚未实现 cpu_reset；已继续观察串口。可实现 cpu_reset 后重试完整复位链路。',
      });
      return;
    }
    failStepAndThrow(ctx, 'cpu_reset', started, err);
  }
}

/**
 * 观察串口输出直到命中 marker 或超时。
 *
 * @param ctx 工作流上下文
 * @param sessionManager 共享 SessionManager
 */
async function observeSerialStep(
  ctx: WorkflowContext,
  sessionManager: SessionManager,
): Promise<void> {
  const started = Date.now();
  const sessionId = ctx.serialSessionId;
  if (sessionId === undefined) {
    throw new ToolError(ERROR_CODES.SESSION_NOT_FOUND, 'serial session was not opened');
  }

  const startCursor = ctx.observeStartCursor ?? sessionManager.read(sessionId, 0).cursor;
  const markers = ctx.input.observe?.markers ?? [...DEFAULT_OBSERVE_MARKERS];
  const timeoutMs = ctx.input.observe?.timeoutMs ?? DEFAULT_OBSERVE_TIMEOUT_MS;
  let observedText = '';

  const outcome = await raceAbort(
    sessionManager.waitFor(
      sessionId,
      (event) => {
        if (event.type !== 'data' || event.origin !== 'device' || event.data === undefined) {
          return false;
        }
        observedText += Buffer.from(event.data).toString('utf8');
        if (markers.length === 0) return true;
        return markers.some((marker) => observedText.includes(marker));
      },
      { timeoutMs, replayHistorySince: startCursor },
    ),
    ctx.signal,
  );

  const readBack = sessionManager.read(sessionId, startCursor);
  const output = readBack.events
    .filter(
      (event) => event.type === 'data' && event.origin === 'device' && event.data !== undefined,
    )
    .map((event) => Buffer.from(event.data ?? new Uint8Array()).toString('utf8'))
    .join('');

  if (outcome.kind === 'match') {
    ctx.summary.serialObserved = true;
    pushStep(
      ctx,
      'observe_serial',
      'passed',
      { sessionId, markers, cursor: readBack.cursor, outputPreview: tail(output, 4096) },
      started,
    );
    return;
  }

  ctx.failedStep = 'observe_serial';
  ctx.nextActions.push({
    kind: 'diagnose',
    tool: 'run_control_workflow',
    message:
      '串口观察未命中完成标记；建议检查复位是否生效、波特率是否匹配，或进入 debug-diagnose。',
  });
  pushStep(
    ctx,
    'observe_serial',
    'failed',
    { sessionId, markers, cursor: readBack.cursor, outputPreview: tail(output, 4096) },
    started,
    {
      code: outcome.kind === 'timeout' ? ERROR_CODES.TIMEOUT : ERROR_CODES.SESSION_CLOSED,
      message:
        outcome.kind === 'timeout'
          ? `Timed out waiting for serial markers within ${timeoutMs}ms`
          : `Serial session closed while observing: ${outcome.state}`,
    },
  );
}

async function connectRttStep(ctx: WorkflowContext, jlinkBackend: IJLinkBackend): Promise<void> {
  const started = Date.now();
  try {
    const probeId = requireProbeId(ctx);
    const rtt = await jlinkBackend.rttConnect(probeId);
    const channelIndex = selectRttChannel(ctx.profile.rtt?.channels, rtt.channels, 0);
    const clearBeforeObserve = ctx.input.observe?.clearBeforeObserve ?? true;
    if (clearBeforeObserve) {
      await jlinkBackend.rttClear(probeId, channelIndex);
    }
    ctx.rttChannelIndex = channelIndex;
    pushStep(
      ctx,
      'connect_rtt',
      'passed',
      { channelIndex, channels: rtt.channels, cleared: clearBeforeObserve },
      started,
    );
  } catch (err) {
    if (captureClassifiedStepFailure(ctx, 'connect_rtt', started, err)) return;
    failStepAndThrow(ctx, 'connect_rtt', started, err);
  }
}

async function observeRttStep(ctx: WorkflowContext, jlinkBackend: IJLinkBackend): Promise<void> {
  const started = Date.now();
  const channelIndex = ctx.rttChannelIndex;
  if (channelIndex === undefined) {
    throw new ToolError(ERROR_CODES.INVALID_STATE, 'RTT channel was not connected');
  }

  const probeId = requireProbeId(ctx);
  const markers = ctx.input.observe?.markers ?? [...DEFAULT_OBSERVE_MARKERS];
  const timeoutMs = ctx.input.observe?.timeoutMs ?? DEFAULT_OBSERVE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let observedText = '';
  let bytesRead = 0;

  for (;;) {
    throwIfAborted(ctx.signal);
    const result = await raceAbort(
      jlinkBackend.rttRead(probeId, channelIndex, DEFAULT_RTT_READ_MAX_BYTES),
      ctx.signal,
    );
    if (result.data.byteLength > 0) {
      bytesRead += result.data.byteLength;
      observedText = tail(observedText + result.data.toString('utf8'), 8192);
      if (markers.length === 0 || markers.some((marker) => observedText.includes(marker))) {
        ctx.summary.rttObserved = true;
        pushStep(
          ctx,
          'observe_rtt',
          'passed',
          {
            channelIndex,
            markers,
            bytesRead,
            outputPreview: tail(observedText, 4096),
            truncated: result.truncated,
          },
          started,
        );
        return;
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleepOrAbort(Math.min(DEFAULT_RTT_POLL_INTERVAL_MS, remainingMs), ctx.signal);
  }

  ctx.failedStep = 'observe_rtt';
  ctx.nextActions.push({
    kind: 'diagnose',
    tool: 'run_control_workflow',
    message:
      'RTT 观察未命中完成标记；请确认固件启用了 RTT 输出、通道号匹配，或进入 flash-observe-diagnose 捕获寄存器/RTT 诊断。',
  });
  pushStep(
    ctx,
    'observe_rtt',
    'failed',
    { channelIndex, markers, bytesRead, outputPreview: tail(observedText, 4096) },
    started,
    {
      code: ERROR_CODES.TIMEOUT,
      message: 'RTT observation did not reach expected markers before timeout',
    },
  );
}

/**
 * 启动 LinkTerm 托管的 GDB server；backend 未实现时降级为 skipped。
 *
 * @param ctx 工作流上下文
 * @param jlinkBackend J-Link backend
 */
async function startGdbServerStep(
  ctx: WorkflowContext,
  jlinkBackend: IJLinkBackend,
): Promise<void> {
  const started = Date.now();
  try {
    const handle = await jlinkBackend.gdbServerStart(requireProbeId(ctx), undefined, ctx.signal);
    ctx.summary.gdbServerStarted = true;
    pushStep(ctx, 'gdb_server_start', 'passed', { handle }, started);
  } catch (err) {
    if (err instanceof JLinkNotImplementedError) {
      pushStep(
        ctx,
        'gdb_server_start',
        'skipped',
        undefined,
        started,
        toStepError(
          new ToolError(ERROR_CODES.NOT_IMPLEMENTED, err.message, { method: err.method }),
        ),
      );
      ctx.nextActions.push({
        kind: 'diagnose',
        tool: 'gdb_server_start',
        message: '当前 J-Link backend 尚未实现 GDB server 启动；已继续采集可用诊断证据。',
      });
      return;
    }
    addBlockingReason(ctx, {
      kind: 'jlink_gdb_server_start_failed',
      code: toToolError(err).code as ToolErrorCode,
      message: safeErrorMessage(err),
    });
    ctx.nextActions.push({
      kind: 'user_action',
      tool: 'gdb_server_start',
      message: 'GDB server 启动失败；请检查端口占用、SEGGER 安装和目标芯片支持后重试。',
    });
    failStepAndThrow(ctx, 'gdb_server_start', started, err);
  }
}

async function finalizeWorkflow(
  ctx: WorkflowContext,
  jlinkBackend: IJLinkBackend,
): Promise<ControlWorkflowData> {
  await stopManagedGdbServerStep(ctx, jlinkBackend);
  recordVerifiedDeploymentIfEligible(ctx);
  return toData(ctx);
}

function recordVerifiedDeploymentIfEligible(ctx: WorkflowContext): void {
  if (ctx.onVerifiedDeployment === undefined) return;
  if (ctx.compensationFirmware === undefined) return;
  if (ctx.input.dryRun === true) return;
  if (ctx.failedStep !== undefined) return;
  if (ctx.steps.some((step) => step.status === 'failed')) return;
  if (!ctx.summary.flashed || !ctx.summary.verified || !observationSucceeded(ctx)) return;

  try {
    ctx.onVerifiedDeployment(buildVerifiedDeploymentEvidence(ctx, ctx.compensationFirmware));
  } catch {
    // Known-good projection is advisory Main-only state; it must not alter workflow outcome.
  }
}

function buildVerifiedDeploymentEvidence(
  ctx: WorkflowContext,
  firmware: ResolvedFirmware,
): VerifiedDeploymentEvidence {
  const targetLabel = ctx.targetResolution?.target ?? ctx.profile.jlink?.target ?? 'J-Link target';
  const contentSha256 = createHash('sha256').update(firmware.binary).digest('hex');
  const targetBindingDigest = digestCanonical({
    target: targetLabel,
    interface: ctx.profile.jlink?.interface,
    speedKHz: ctx.profile.jlink?.speedKHz,
  });
  return {
    workspace: {
      root: ctx.hostRoot,
      profile: {
        schemaVersion: ctx.profile.schemaVersion,
        ...(ctx.profile.serial !== undefined ? { serial: { ...ctx.profile.serial } } : {}),
        ...(ctx.profile.jlink !== undefined ? { jlink: { ...ctx.profile.jlink } } : {}),
        ...(ctx.profile.flash !== undefined ? { flash: { ...ctx.profile.flash } } : {}),
        ...(ctx.profile.rtt !== undefined
          ? { rtt: { ...ctx.profile.rtt, channels: ctx.profile.rtt.channels?.slice() } }
          : {}),
      },
    },
    sourceOperationId: `workflow_${digestHex({
      root: ctx.hostRoot,
      targetBindingDigest,
      sourcePath: firmware.sourcePath,
      contentSha256,
    }).slice(0, 32)}`,
    targetLabel,
    targetBindingDigest,
    profileRevision: digestCanonical({ root: ctx.hostRoot, profile: ctx.profile }),
    workflowMode: ctx.input.mode,
    manifestDigest: digestCanonical({
      mode: ctx.input.mode,
      observe: ctx.input.observe,
      targetBindingDigest,
      firmware: {
        sourcePath: firmware.sourcePath,
        baseAddress: firmware.baseAddress,
        verify: firmware.verify,
        format: firmware.format,
        byteLength: firmware.binary.byteLength,
        contentSha256,
      },
    }),
    firmware: {
      mainOwnedSourceRef: firmware.absolutePath,
      displayName: path.basename(firmware.absolutePath),
      contentSha256,
      byteLength: firmware.binary.byteLength,
      format: readinessFirmwareFormat(firmware.format),
      baseAddress: firmware.baseAddress,
    },
    result: {
      flashed: ctx.summary.flashed,
      verified: ctx.summary.verified,
      observationSucceeded: observationSucceeded(ctx),
    },
  };
}

async function stopManagedGdbServerStep(
  ctx: WorkflowContext,
  jlinkBackend: IJLinkBackend,
): Promise<void> {
  if (!ctx.summary.gdbServerStarted) return;
  if (ctx.steps.some((step) => step.id === 'gdb_server_stop')) return;
  const probeId = ctx.probe?.probeId;
  if (probeId === undefined) return;

  const started = Date.now();
  try {
    await jlinkBackend.gdbServerStop(probeId);
    pushStep(ctx, 'gdb_server_stop', 'passed', { probeId, stopped: true }, started);
  } catch (err) {
    const toolError = toToolError(err);
    pushStep(
      ctx,
      'gdb_server_stop',
      'failed',
      { probeId, stopped: false },
      started,
      toStepError(toolError),
    );
    ctx.nextActions.push({
      kind: 'user_action',
      tool: 'gdb_server_stop',
      message:
        '托管 GDB server 停止失败；请先停止该 probe 上的 GDB server 或断开 probe，再继续烧录/调试。',
    });
  }
}

/**
 * 执行轻量诊断采集。未实现的 debug backend 会降级为 skipped 并给出 nextActions。
 *
 * @param ctx 工作流上下文
 * @param jlinkBackend J-Link backend
 */
async function diagnoseStep(ctx: WorkflowContext, jlinkBackend: IJLinkBackend): Promise<void> {
  const started = Date.now();
  try {
    const probeId = requireProbeId(ctx);
    const registers: RegisterValue[] | undefined =
      ctx.input.debug?.readRegisters === false
        ? undefined
        : await jlinkBackend.registerList(probeId);
    const memory = [];
    for (const range of ctx.input.debug?.readMemory ?? []) {
      const data = await jlinkBackend.memoryRead(probeId, range);
      memory.push({
        address: range.address,
        length: data.byteLength,
        dataBase64: data.toString('base64'),
      });
    }
    const rtt = await readRttForDebug(ctx, jlinkBackend, probeId);
    ctx.summary.debugCaptured = registers !== undefined || memory.length > 0 || rtt !== undefined;
    pushStep(ctx, 'debug_diagnose', 'passed', { registers, memory, rtt }, started);
  } catch (err) {
    if (err instanceof JLinkNotImplementedError) {
      pushStep(
        ctx,
        'debug_diagnose',
        'skipped',
        undefined,
        started,
        toStepError(
          new ToolError(ERROR_CODES.NOT_IMPLEMENTED, err.message, { method: err.method }),
        ),
      );
      ctx.nextActions.push({
        kind: 'diagnose',
        tool: err.method,
        message: '当前 J-Link backend 尚未实现该诊断能力；已保留前序步骤证据。',
      });
      return;
    }
    failStepAndThrow(ctx, 'debug_diagnose', started, err);
  }
}

/**
 * 按 control-profile 中配置的速度连接 J-Link；auto 从最高速向下回退。
 *
 * @param jlinkBackend J-Link backend
 * @param baseOpts 不含 speedKHz 的连接参数
 * @param speedKHz 数字速度或 auto
 * @returns backend 返回的 probe 信息
 */
async function connectProbeWithConfiguredSpeed(
  jlinkBackend: IJLinkBackend,
  baseOpts: ProbeConnectOptions,
  speedKHz: number | 'auto' | undefined,
): Promise<ProbeInfo> {
  if (speedKHz === undefined)
    return translateJLinkPromise(() => jlinkBackend.probeConnect(baseOpts));
  if (typeof speedKHz === 'number') {
    return translateJLinkPromise(() => jlinkBackend.probeConnect({ ...baseOpts, speedKHz }));
  }

  let lastError: JLinkOperationError | undefined;
  for (const candidate of AUTO_JLINK_SPEEDS_KHZ) {
    try {
      return await jlinkBackend.probeConnect({ ...baseOpts, speedKHz: candidate });
    } catch (err) {
      if (!(err instanceof JLinkOperationError)) throw translateJLinkError(err);
      lastError = err;
    }
  }
  throw new ToolError(
    ERROR_CODES.JLINK_OPERATION_FAILED,
    lastError?.message ?? 'Unable to connect J-Link with auto speed',
    { operation: 'probeConnect' },
  );
}

/**
 * 把 J-Link Promise 的错误翻译为 ToolError.
 *
 * @param fn 实际 backend 调用闭包
 * @returns backend 成功结果
 */
async function translateJLinkPromise<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    translateJLinkError(err);
  }
}

/**
 * 解析固件路径、地址和校验选项，并确保路径不逃逸 root.
 *
 * @param root 工作区根目录
 * @param firmwareOverride 工具入参中的固件覆盖项
 * @param profile 控制配置
 * @returns 已解析固件元信息
 */
async function resolveFirmware(
  root: string,
  firmwareOverride: RunControlWorkflowInput['firmware'],
  profile: ControlProfile,
  hostPathResolver: HostPathResolver,
): Promise<ResolvedFirmware> {
  const filePathSource = firmwareOverride?.filePath !== undefined ? 'request' : 'profile';
  const baseAddressSource = firmwareOverride?.baseAddress !== undefined ? 'request' : 'profile';
  const verifySource =
    firmwareOverride?.verify !== undefined
      ? 'request'
      : profile.flash?.verify !== undefined
        ? 'profile'
        : 'default';
  const timeoutSource = firmwareOverride?.timeoutMs !== undefined ? 'request' : 'default';
  const filePath = firmwareOverride?.filePath ?? profile.flash?.binary;
  const baseAddressHex = firmwareOverride?.baseAddress ?? profile.flash?.baseAddress;
  const verify = firmwareOverride?.verify ?? profile.flash?.verify ?? true;
  const timeoutMs = firmwareOverride?.timeoutMs;
  if (filePath === undefined || baseAddressHex === undefined) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      'flash workflow requires firmware.filePath/profile.flash.binary and firmware.baseAddress/profile.flash.baseAddress',
    );
  }

  const pathResolution = await resolveFirmwarePath(
    root,
    filePath,
    filePathSource,
    hostPathResolver,
  );
  const firmware = await readFirmwareCapped(pathResolution.path, pathResolution.realRoot);
  const baseAddress = parseHexAddress(baseAddressHex);
  if (firmware.baseAddress !== undefined && firmware.baseAddress !== baseAddress) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      `${firmwareFormatLabel(firmware.format)} image base address ${formatHexAddress(firmware.baseAddress)} does not match configured flash base address ${formatHexAddress(baseAddress)}`,
    );
  }
  validateFirmwareVectorTable(firmware.binary, baseAddress);
  return {
    absolutePath: firmware.absolutePath,
    baseAddress,
    verify,
    timeoutMs,
    binary: firmware.binary,
    sourcePath: filePath,
    format: firmware.format,
    parameterSources: {
      filePath: filePathSource,
      baseAddress: baseAddressSource,
      verify: verifySource,
      timeoutMs: timeoutSource,
    },
  };
}

/** 固件路径解析结果；realRoot 存在时读取阶段必须做 root containment。 */
interface FirmwarePathResolution {
  path: string;
  realRoot?: string;
}

/**
 * 按来源解析固件路径。
 *
 * request 覆盖值仍被限制在 root 内，避免 AI 临时参数读取任意主机文件；profile 中的绝对路径
 * 来自用户/App 持久化控制配置，按显式配置使用，但仍会在读取阶段检查常规文件和大小上限。
 *
 * @param root 工作区根目录
 * @param filePath profile 或 request 中的固件路径
 * @param source 路径来源
 * @returns 已规范化路径，以及需要 root containment 时的真实 root
 */
async function resolveFirmwarePath(
  root: string,
  filePath: string,
  source: 'profile' | 'request',
  hostPathResolver: HostPathResolver,
): Promise<FirmwarePathResolution> {
  if (source === 'profile' && path.isAbsolute(filePath)) {
    return { path: path.normalize(await hostPathResolver.toHostPath(filePath)) };
  }
  return {
    path: resolvePathInsideRoot(root, filePath),
    realRoot: await realpathOrInvalid(root, 'root'),
  };
}

/**
 * 读取固件并限制大小，避免高层 workflow 绕过二进制上限。
 *
 * @param filePath 固件绝对路径
 * @param realRoot 存在时要求固件 realpath 仍位于该 root 内
 * @returns 固件 Buffer
 */
async function readFirmwareCapped(
  filePath: string,
  realRoot?: string,
): Promise<{
  absolutePath: string;
  binary: Buffer;
  format: FirmwareImageFormat;
  baseAddress?: number;
}> {
  const handle = await openFileOrInvalid(filePath);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    const realFirmwarePath = await realpathOrInvalid(filePath, 'firmware.filePath');
    if (realRoot !== undefined) {
      assertPathInsideRoot(realRoot, realFirmwarePath);
    }
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new ToolError(
        ERROR_CODES.INVALID_ARGUMENT,
        'Firmware path must point to a regular file',
        {
          field: 'firmware.filePath',
        },
      );
    }
    if (info.size > MAX_BINARY_BYTES) {
      throw new ToolError(ERROR_CODES.BUFFER_TOO_LARGE, 'Firmware image exceeds 16 MiB limit', {
        actualBytes: info.size,
        maxBytes: MAX_BINARY_BYTES,
      });
    }

    const scratch = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(scratch, 0, scratch.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_BINARY_BYTES) {
        throw new ToolError(ERROR_CODES.BUFFER_TOO_LARGE, 'Firmware image exceeds 16 MiB limit', {
          actualBytes: total,
          maxBytes: MAX_BINARY_BYTES,
        });
      }
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
    }
    const image = decodeFirmwareImageByPath(realFirmwarePath, Buffer.concat(chunks, total), {
      maxImageBytes: MAX_BINARY_BYTES,
    });
    return {
      absolutePath: realFirmwarePath,
      binary: image.binary,
      format: image.format,
      baseAddress: image.baseAddress,
    };
  } catch (err) {
    if (err instanceof ToolError) throw err;
    if (isFirmwareImageParseError(err)) {
      throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, err.message, {
        field: 'firmware.filePath',
      });
    }
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Firmware path is not readable', {
      field: 'firmware.filePath',
    });
  } finally {
    await handle.close();
  }
}

function firmwareFormatLabel(format: FirmwareImageFormat): string {
  if (format === 'intel-hex') return 'Intel HEX';
  if (format === 'elf') return 'ELF';
  return 'Firmware';
}

function readinessFirmwareFormat(format: FirmwareImageFormat): VerifiedDeploymentEvidence['firmware']['format'] {
  if (format === 'raw-binary') return 'bin';
  if (format === 'intel-hex') return 'hex';
  if (format === 'elf') return 'elf';
  return 'unknown';
}

/**
 * 确保相对路径解析后仍位于 root 内。
 *
 * @param root 工作区根目录
 * @param maybeRelative 用户提供路径
 * @returns root 内的绝对路径
 */
function resolvePathInsideRoot(root: string, maybeRelative: string): string {
  const candidate = path.isAbsolute(maybeRelative)
    ? path.normalize(maybeRelative)
    : path.resolve(root, maybeRelative);
  const relative = path.relative(root, candidate);
  if (isPathInsideRelative(relative)) {
    return candidate;
  }
  throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Firmware path must stay inside root', {
    field: 'firmware.filePath',
  });
}

/**
 * 对 realpath 结果再次做 root containment，阻止 symlink/junction 逃逸。
 *
 * @param realRoot root 的真实路径
 * @param realFirmwarePath 固件的真实路径
 */
function assertPathInsideRoot(realRoot: string, realFirmwarePath: string): void {
  const relative = path.relative(realRoot, realFirmwarePath);
  if (!isPathInsideRelative(relative)) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Firmware path must stay inside root', {
      field: 'firmware.filePath',
    });
  }
}

/**
 * 检查 path.relative 的结果是否表示目标位于 root 内。
 *
 * @param relative path.relative(root, target) 的结果
 * @returns true 表示 target 没有逃逸 root
 */
function isPathInsideRelative(relative: string): boolean {
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 获取真实路径，失败时转换为不泄漏主机绝对路径的 INVALID_ARGUMENT.
 *
 * @param filePath 待解析路径
 * @param field 入参字段名
 * @returns realpath 结果
 */
async function realpathOrInvalid(filePath: string, field: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Firmware path is not readable', { field });
  }
}

/**
 * 打开固件文件，失败时转换为不泄漏主机路径的 INVALID_ARGUMENT.
 *
 * @param filePath 固件真实路径
 * @returns 文件句柄
 */
async function openFileOrInvalid(filePath: string): Promise<Awaited<ReturnType<typeof open>>> {
  try {
    return await open(filePath, 'r');
  } catch {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Firmware path is not readable', {
      field: 'firmware.filePath',
    });
  }
}

/**
 * 解析 profile 中强制要求的十六进制地址.
 *
 * @param value 形如 0x08000000 的字符串
 * @returns 非负安全整数地址
 */
function parseHexAddress(value: string): number {
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, `Invalid flash base address: ${value}`);
  }
  return parsed;
}

function resolveSafeSpeedPolicy(ctx: WorkflowContext): SpeedPolicyEvidence | undefined {
  const speedKHz = ctx.profile.jlink?.speedKHz;
  if (!needsFlash(ctx.input) || speedKHz !== 'auto') return undefined;
  return {
    profileSpeedKHz: speedKHz,
    resolvedSpeedKHz: SAFE_RAW_FLASH_SPEED_KHZ,
    reason: 'safe-raw-flash',
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new ToolError(ERROR_CODES.ABORTED, 'Control workflow job was aborted');
  }
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  throwIfAborted(signal);
  if (signal === undefined) return promise;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new ToolError(ERROR_CODES.ABORTED, 'Control workflow job was aborted')),
        { once: true },
      );
    }),
  ]);
}

async function sleepOrAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return;
  await raceAbort(new Promise((resolve) => setTimeout(resolve, ms)), signal);
}

function selectRttChannel(
  configuredChannels: number[] | undefined,
  visibleChannels: RttChannelInfo[],
  fallback: number,
): number {
  const upChannels = visibleChannels.filter((channel) => channel.direction === 'up');
  if (configuredChannels !== undefined) {
    const configured = configuredChannels.find((index) =>
      upChannels.some((channel) => channel.index === index),
    );
    if (configured !== undefined) return configured;
  }
  return upChannels[0]?.index ?? fallback;
}

function needsFlash(input: RunControlWorkflowInput): boolean {
  return input.mode === 'flash-observe' || input.mode === 'flash-observe-diagnose';
}

function needsSerial(input: RunControlWorkflowInput, profile?: ControlProfile): boolean {
  if (input.observe?.enabled === false) return false;
  if (input.observe?.serial === false) return false;
  if (input.observe?.serial === true) return true;
  if (profile?.rtt?.enabled === true) return false;
  return input.mode === 'flash-observe' || input.mode === 'flash-observe-diagnose';
}

function needsRtt(input: RunControlWorkflowInput, profile?: ControlProfile): boolean {
  if (input.observe?.enabled === false) return false;
  if (input.observe?.serial === true) return false;
  if (profile?.rtt?.enabled !== true) return false;
  return input.mode === 'flash-observe' || input.mode === 'flash-observe-diagnose';
}

function needsReset(input: RunControlWorkflowInput): boolean {
  return input.mode === 'flash-observe' || input.mode === 'flash-observe-diagnose';
}

function shouldCaptureDebug(ctx: WorkflowContext): boolean {
  return (
    ctx.input.mode === 'debug-diagnose' ||
    ctx.input.debug?.rttRead === true ||
    (ctx.input.mode === 'flash-observe-diagnose' && !observationSucceeded(ctx))
  );
}

function observationSucceeded(ctx: WorkflowContext): boolean {
  return ctx.summary.serialObserved || ctx.summary.rttObserved;
}

async function readRttForDebug(
  ctx: WorkflowContext,
  jlinkBackend: IJLinkBackend,
  probeId: string,
): Promise<{ channelIndex: number; dataBase64: string; truncated: boolean } | undefined> {
  if (ctx.input.debug?.rttRead !== true) return undefined;
  const rtt = await jlinkBackend.rttConnect(probeId);
  const channelIndex = selectRttChannel(ctx.profile.rtt?.channels, rtt.channels, 0);
  const result = await jlinkBackend.rttRead(probeId, channelIndex, DEFAULT_RTT_READ_MAX_BYTES);
  return {
    channelIndex: result.channelIndex,
    dataBase64: result.data.toString('base64'),
    truncated: result.truncated,
  };
}

function serialProfileComplete(profile: ControlProfile): profile is ControlProfile & {
  serial: { enabled: true; port: string; baudRate: number; mode: 'normal' | 'terminal' };
} {
  return (
    profile.serial?.enabled === true &&
    profile.serial.port !== undefined &&
    profile.serial.baudRate !== undefined &&
    profile.serial.mode !== undefined
  );
}

function requireProbeId(ctx: WorkflowContext): string {
  if (ctx.probe === undefined) {
    throw new ToolError(ERROR_CODES.PROBE_NOT_FOUND, 'probe was not connected');
  }
  return ctx.probe.probeId;
}

function sanitizeProbeForMcp(p: ProbeInfo): Omit<ProbeInfo, 'serialNumber'> {
  const { serialNumber: _serialNumber, ...rest } = p;
  void _serialNumber;
  return rest;
}

function emptySummary(): ControlWorkflowSummary {
  return {
    serialOpened: false,
    probeConnected: false,
    gdbServerStarted: false,
    flashed: false,
    verified: false,
    reset: false,
    serialObserved: false,
    rttObserved: false,
    debugCaptured: false,
  };
}

function pushDryRunSteps(ctx: WorkflowContext, firmware: ResolvedFirmware | undefined): void {
  if (needsSerial(ctx.input, ctx.profile))
    pushStep(ctx, 'open_serial', 'skipped', { dryRun: true });
  pushStep(ctx, 'connect_probe', 'skipped', { dryRun: true });
  if (needsFlash(ctx.input)) {
    pushStep(ctx, 'flash', 'skipped', {
      dryRun: true,
      ...(firmware
        ? {
            firmwarePath: firmware.absolutePath,
            sourcePath: firmware.sourcePath,
            address: firmware.baseAddress,
            verify: firmware.verify,
            timeoutMs: firmware.timeoutMs,
            parameterSources: firmware.parameterSources,
          }
        : {}),
    });
  }
  if (needsRtt(ctx.input, ctx.profile)) {
    pushStep(ctx, 'gdb_server_start', 'skipped', { dryRun: true });
    pushStep(ctx, 'connect_rtt', 'skipped', { dryRun: true });
  }
  if (needsReset(ctx.input)) pushStep(ctx, 'cpu_reset', 'skipped', { dryRun: true });
  if (needsSerial(ctx.input, ctx.profile))
    pushStep(ctx, 'observe_serial', 'skipped', { dryRun: true });
  if (needsRtt(ctx.input, ctx.profile)) pushStep(ctx, 'observe_rtt', 'skipped', { dryRun: true });
}

function pushStep(
  ctx: WorkflowContext,
  id: string,
  status: ControlWorkflowStep['status'],
  evidence?: unknown,
  startedAt?: number,
  error?: ControlWorkflowStep['error'],
): void {
  const step: ControlWorkflowStep = {
    id,
    status,
    durationMs: startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt),
  };
  if (evidence !== undefined) step.evidence = evidence;
  if (error !== undefined) step.error = error;
  const lastIndex = ctx.steps.length - 1;
  const last = ctx.steps[lastIndex];
  if (last?.id === id && last.status === 'running' && status !== 'running') {
    if (step.evidence === undefined && last.evidence !== undefined) {
      step.evidence = last.evidence;
    }
    ctx.steps[lastIndex] = step;
  } else {
    ctx.steps.push(step);
  }
  ctx.onUpdate?.(toData(ctx));
}

function failStepAndThrow(
  ctx: WorkflowContext,
  id: string,
  startedAt: number,
  err: unknown,
): never {
  ctx.failedStep = id;
  const toolError = toToolError(err);
  pushStep(ctx, id, 'failed', undefined, startedAt, toStepError(toolError));
  throw toolError;
}

function captureClassifiedStepFailure(
  ctx: WorkflowContext,
  id: string,
  startedAt: number,
  err: unknown,
): boolean {
  const toolError = toToolError(err);
  const failureCode = classifyWorkflowFailure(id, toolError);
  if (failureCode === undefined) return false;
  ctx.failedStep = id;
  ctx.failureCode = failureCode;
  pushStep(ctx, id, 'failed', undefined, startedAt, toStepError(toolError, failureCode));
  addNextActionForFailure(ctx, failureCode);
  return true;
}

function classifyWorkflowFailure(
  id: string,
  err: ToolError,
): ControlWorkflowFailureCode | undefined {
  const message = err.message;
  if (err.code === ERROR_CODES.NOT_IMPLEMENTED) return 'capability_not_implemented';
  if (err.code === ERROR_CODES.PROBE_NOT_FOUND) return 'probe_not_found';
  if (err.code === ERROR_CODES.ABORTED && /timeout|timed out/i.test(message))
    return 'command_timeout';
  if (id === 'connect_rtt' && err.code === ERROR_CODES.JLINK_OPERATION_FAILED) {
    return 'rtt_connect_failed';
  }
  if (id !== 'flash' || err.code !== ERROR_CODES.JLINK_OPERATION_FAILED) return undefined;
  if (
    /Timeout while erasing sectors|Failed to erase sectors/i.test(message) &&
    /RAMCode did not respond/i.test(message)
  ) {
    return 'flash_sector_erase_timeout';
  }
  if (/preserve target RAM|prepare for programming|RAMCode did not respond/i.test(message)) {
    return 'flash_ram_preserve_failed';
  }
  if (/verify failed|verification failed/i.test(message)) return 'flash_verify_failed';
  if (
    /target.*(rejected|unknown|unsupported)|device.*(unknown|unsupported)|cannot connect to target|could not connect to target/i.test(
      message,
    )
  ) {
    return 'target_rejected';
  }
  return 'jlink_operation_failed';
}

function addNextActionForFailure(
  ctx: WorkflowContext,
  failureCode: ControlWorkflowFailureCode,
): void {
  if (failureCode === 'flash_ram_preserve_failed') {
    if (ctx.profile.jlink?.speedKHz === SAFE_RAW_FLASH_SPEED_KHZ) {
      ctx.nextActions.push({
        kind: 'user_action',
        message:
          'J-Link 烧录前保存目标 RAM 失败，且当前已使用 4000 kHz；请检查 SEGGER device add-on/flash algorithm、目标板供电、NRST/BOOT、低功耗状态和写保护后再重试。',
      });
      return;
    }
    ctx.nextActions.push({
      kind: 'retry',
      tool: 'run_control_workflow',
      message:
        'J-Link 烧录前保存目标 RAM 失败；请将 control-profile 的 jlink.speedKHz 固定为 4000 kHz 后重试高层工作流。',
      argsPatch: { jlink: { speedKHz: SAFE_RAW_FLASH_SPEED_KHZ } },
      requiresConfirm: false,
    });
  }
  if (failureCode === 'rtt_connect_failed') {
    ctx.nextActions.push({
      kind: 'diagnose',
      tool: 'run_control_workflow',
      message:
        '固件已烧录/校验，但 RTT 连接失败；建议先运行 debug-diagnose 或检查固件 RTT control block/channel 配置，不要重复发起第二次烧录。',
      argsPatch: { mode: 'debug-diagnose', debug: { rttRead: true } },
      requiresConfirm: false,
    });
  }
  if (failureCode === 'flash_sector_erase_timeout') {
    ctx.nextActions.push({
      kind: 'user_action',
      message:
        'J-Link 在擦除 flash sector 时 RAMCode 超时；请优先检查 SEGGER 是否安装匹配目标芯片的 vendor device add-on/flash algorithm，并确认目标板供电、BOOT/NRST、写保护和高地址 flash sector 状态后再重试。',
    });
  }
}

function toToolError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  try {
    translateJLinkError(err);
  } catch (translated) {
    if (translated instanceof ToolError) return translated;
    if (translated instanceof Error) return new ToolError(ERROR_CODES.INTERNAL, translated.message);
    return new ToolError(ERROR_CODES.INTERNAL, String(translated));
  }
}

function toStepError(
  err: ToolError,
  failureCode?: ControlWorkflowFailureCode,
): NonNullable<ControlWorkflowStep['error']> {
  return {
    code: err.code as ToolErrorCode,
    message: err.message,
    failureCode,
    details: err.details,
  };
}

function toData(ctx: WorkflowContext): ControlWorkflowData {
  const data: ControlWorkflowData = {
    mode: ctx.input.mode,
    root: ctx.input.root,
    steps: ctx.steps,
    summary: ctx.summary,
    nextActions: ctx.nextActions,
  };
  if (ctx.failedStep !== undefined) data.failedStep = ctx.failedStep;
  if (ctx.failureCode !== undefined) data.failureCode = ctx.failureCode;
  if (ctx.blockingReasons.length > 0) data.blockingReasons = ctx.blockingReasons;
  return data;
}

function tail(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}

/**
 * 在 reset 前确定串口观察起点，避免 reset 后立即输出的启动日志被后续 clear 丢弃。
 *
 * @param ctx 工作流上下文
 * @param sessionManager 共享 SessionManager
 */
function prepareSerialObservation(ctx: WorkflowContext, sessionManager: SessionManager): void {
  const sessionId = ctx.serialSessionId;
  if (sessionId === undefined) {
    throw new ToolError(ERROR_CODES.SESSION_NOT_FOUND, 'serial session was not opened');
  }
  const clearBeforeObserve = ctx.input.observe?.clearBeforeObserve ?? true;
  ctx.observeStartCursor = clearBeforeObserve
    ? sessionManager.clear(sessionId, 'ai').sequence
    : sessionManager.read(sessionId, 0).cursor;
}

/**
 * 读取 backend 暴露的 Commander 可用性检查；旧 backend 未暴露时不阻塞工作流。
 *
 * @param jlinkBackend J-Link backend
 * @param target 可选 SEGGER 目标名，用于本地 device database 预检
 * @returns 可用性结果；undefined 表示 backend 没有该预检能力
 */
function getCommanderAvailability(
  jlinkBackend: IJLinkBackend,
  target?: string,
): Promise<CommanderAvailability | undefined> | CommanderAvailability | undefined {
  const candidate = jlinkBackend as Partial<CommanderAvailabilityProvider>;
  if (typeof candidate.checkCommanderAvailability !== 'function') return undefined;
  return candidate.checkCommanderAvailability(target);
}

/**
 * 读取 backend 暴露的 GDB server 可用性检查；旧 backend 未暴露时不阻塞工作流。
 *
 * @param jlinkBackend J-Link backend
 * @param target 可选 SEGGER 目标名，用于本地 device database 预检
 * @returns 可用性结果；undefined 表示 backend 没有该预检能力
 */
function getGdbServerAvailability(
  jlinkBackend: IJLinkBackend,
  target?: string,
): Promise<GdbServerAvailability | undefined> | GdbServerAvailability | undefined {
  const candidate = jlinkBackend as Partial<GdbServerAvailabilityProvider>;
  if (typeof candidate.checkGdbServerAvailability !== 'function') return undefined;
  return candidate.checkGdbServerAvailability(target);
}

/**
 * 把可机读阻塞原因追加到工作流上下文。
 *
 * @param ctx 工作流上下文
 * @param reason 阻塞原因
 */
function addBlockingReason(ctx: WorkflowContext, reason: ControlWorkflowBlockingReason): void {
  ctx.blockingReasons.push(reason);
}

/**
 * 提取短错误消息，避免把未知异常原样扩散成超长 MCP 输出。
 *
 * @param err 任意错误
 * @returns 最多 1000 字符的消息
 */
function safeErrorMessage(err: unknown): string {
  if (err instanceof ToolError) return err.message;
  if (err instanceof Error) return err.message.slice(0, 1000);
  return String(err).slice(0, 1000);
}

function digestCanonical(value: unknown): string {
  return `sha256:${digestHex(value)}`;
}

function digestHex(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }
  return value;
}
