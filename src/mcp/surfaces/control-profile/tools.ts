/** MCP control-profile surface: create/read/activate workspace-local control profile. */

import { ZodError } from 'zod';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ControlProfileAlreadyInitializedError,
  ControlProfileManager,
  ControlProfileNotFoundError,
  ControlProfileSchemaVersionMismatchError,
  ControlProfileTooLargeError,
  WorkspaceInvalidRootError,
  buildControlProfileQuestion,
  controlProfilePath,
  defaultHostPathResolver,
  inspectControlProfileCompleteness,
  parseControlProfileAnswer,
  type ControlProfile,
  type HostPathResolver,
} from '../../../core/workspace/index.js';
import type { SessionManager } from '../../../core/session/session-manager.js';
import type { IJLinkBackend, ProbeConnectOptions, ProbeInfo } from '../../../jlink/types.js';
import type { JLinkDeviceCatalog, JLinkDeviceInfo } from '../../../jlink/device-catalog.js';
import { JLinkOperationError } from '../../../jlink/errors.js';
import type { SerialSessionConfig, SessionState } from '../../../shared/types.js';
import type { SessionCreateRequestConfig } from '../../../shared/preload-api.js';
import { classifyJLinkTargetName } from '../../../shared/jlink-target-name.js';
import { buildSession } from '../../../core/session/factory.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import {
  registerTool,
  ToolError,
  type ToolHandlerResult,
} from '../../registry.js';
import { runJLink } from '../debug/error-translate.js';
import { checkFirmwareVectorTable } from '../debug/firmware-sanity.js';
import {
  activateControlProfileInputSchema,
  applyControlProfileAnswerInputSchema,
  getControlProfileInputSchema,
  initControlProfileInputSchema,
  inspectControlProfileInputSchema,
  prepareControlProfileQuestionsInputSchema,
  type ActivateControlProfileInput,
  type ApplyControlProfileAnswerInput,
  type GetControlProfileInput,
  type InitControlProfileInput,
  type InspectControlProfileInput,
  type PrepareControlProfileQuestionsInput,
} from './schemas.js';

/** activate_control_profile 打开串口后的最小结果。 */
export interface ControlProfileSerialActivation {
  sessionId: string;
  state: SessionState;
}

/** 串口激活函数；测试可注入 fake，生产默认走 SessionManager + buildSession。 */
export type ControlProfileOpenSerial = (
  config: SerialSessionConfig,
) => Promise<ControlProfileSerialActivation>;

/** registerControlProfileTools 的依赖容器。 */
export interface ControlProfileToolsDeps {
  controlProfileManager: ControlProfileManager;
  sessionManager: SessionManager;
  jlinkBackend: IJLinkBackend;
  jlinkDeviceCatalog?: JLinkDeviceCatalog;
  hostPathResolver?: HostPathResolver;
  controlProfileOpenSerial?: ControlProfileOpenSerial;
}

/** J-Link auto speed 从最高速向下尝试，避免最高速不稳定时直接失败。 */
const AUTO_JLINK_SPEEDS_KHZ = [50_000, 25_000, 10_000, 8_000, 4_000, 1_000] as const;
const FIRMWARE_DIAGNOSTIC_READ_BYTES = 1024 * 1024;

interface ControlProfileDiagnostic {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  suggestions?: JLinkDeviceInfo[];
}

/**
 * 注册控制配置 MCP 工具。
 *
 * @param server McpServer 实例
 * @param deps 共享依赖；manager/session/J-Link backend 均与主进程同实例
 */
export function registerControlProfileTools(
  server: McpServer,
  deps: ControlProfileToolsDeps,
): void {
  const openSerial = deps.controlProfileOpenSerial ?? defaultOpenSerial(deps.sessionManager);
  const hostPathResolver = deps.hostPathResolver ?? defaultHostPathResolver;

  registerTool(server, {
    name: 'init_control_profile',
    description:
      'Create <root>/.linkterm/control-profile.json for fast reuse of serial/J-Link/flash/RTT facts. ' +
      'The flash baseAddress must be a hex string such as "0x08000000"; decimal numbers are rejected. ' +
      'Sensitive fields are rejected by strict schema. Use force=true to overwrite an existing profile.',
    sensitivity: 'state-affecting',
    inputSchema: initControlProfileInputSchema,
    handler: async (input: InitControlProfileInput): Promise<ToolHandlerResult> => {
      try {
        const rootContext = await resolveControlRoot(input.root, hostPathResolver);
        const profile = await deps.controlProfileManager.init(rootContext.hostRoot, input.profile, {
          force: input.force ?? false,
        });
        return successProfile(rootContext, profile);
      } catch (err) {
        translateControlProfileError(err);
      }
    },
  });

  registerTool(server, {
    name: 'get_control_profile',
    description:
      'Read <root>/.linkterm/control-profile.json so an Agent can reuse serial/J-Link/flash/RTT facts ' +
      'without rediscovering them on every MCP session.',
    sensitivity: 'read-only',
    inputSchema: getControlProfileInputSchema,
    handler: async (input: GetControlProfileInput): Promise<ToolHandlerResult> => {
      try {
        const rootContext = await resolveControlRoot(input.root, hostPathResolver);
        const profile = await deps.controlProfileManager.load(rootContext.hostRoot);
        return successProfile(rootContext, profile);
      } catch (err) {
        translateControlProfileError(err);
      }
    },
  });

  registerTool(server, {
    name: 'inspect_control_profile',
    description:
      'Inspect <root>/.linkterm/control-profile.json and report whether the serial/J-Link/flash facts ' +
      'needed for fast control activation are complete. If the file is absent, returns exists=false and a missing-field list.',
    sensitivity: 'read-only',
    inputSchema: inspectControlProfileInputSchema,
    handler: async (input: InspectControlProfileInput): Promise<ToolHandlerResult> => {
      const rootContext = await resolveControlRoot(input.root, hostPathResolver);
      const { profile, exists } = await loadProfileIfPresent(deps.controlProfileManager, rootContext.hostRoot);
      const report = inspectControlProfileCompleteness(profile);
      const diagnostics = await inspectControlProfileDiagnostics(rootContext.hostRoot, profile, deps.jlinkDeviceCatalog);
      return {
        success: true,
        evidence: {
          kind: 'workspace_config',
          data: { ...rootEvidence(rootContext), exists, ...report, profile, diagnostics },
          cursor: 0,
        },
      };
    },
  });

  registerTool(server, {
    name: 'prepare_control_profile_questions',
    description:
      'Generate a concise human-facing question for missing control-profile fields. This tool does not write files or touch hardware.',
    sensitivity: 'read-only',
    inputSchema: prepareControlProfileQuestionsInputSchema,
    handler: async (input: PrepareControlProfileQuestionsInput): Promise<ToolHandlerResult> => {
      const rootContext = await resolveControlRoot(input.root, hostPathResolver);
      const { profile, exists } = await loadProfileIfPresent(deps.controlProfileManager, rootContext.hostRoot);
      const report = inspectControlProfileCompleteness(profile);
      return {
        success: true,
        evidence: {
          kind: 'workspace_config',
          data: {
            ...rootEvidence(rootContext),
            exists,
            ...report,
            question: buildControlProfileQuestion(report),
          },
          cursor: 0,
        },
      };
    },
  });

  registerTool(server, {
    name: 'apply_control_profile_answer',
    description:
      'Parse a human natural-language answer into <root>/.linkterm/control-profile.json. ' +
      'Decimal flash addresses are rejected; provide baseAddress as hex like 0x08000000. This tool only writes config and never touches hardware.',
    sensitivity: 'state-affecting',
    inputSchema: applyControlProfileAnswerInputSchema,
    handler: async (input: ApplyControlProfileAnswerInput): Promise<ToolHandlerResult> => {
      try {
        const rootContext = await resolveControlRoot(input.root, hostPathResolver);
        const parsed = parseControlProfileAnswer(input.answer);
        const profile = await deps.controlProfileManager.init(rootContext.hostRoot, parsed.patch, { force: true });
        const report = inspectControlProfileCompleteness(profile);
        return {
          success: true,
          evidence: {
            kind: 'workspace_config',
            data: {
              ...rootEvidence(rootContext),
              profile,
              ...report,
              needsClarification: !report.complete || parsed.rejectedFields.length > 0,
              parsedFields: parsed.parsedFields,
              rejectedFields: parsed.rejectedFields,
              question: !report.complete ? buildControlProfileQuestion(report) : undefined,
            },
            cursor: 0,
          },
        };
      } catch (err) {
        translateControlProfileError(err);
      }
    },
  });

  registerTool(server, {
    name: 'activate_control_profile',
    description:
      'Read <root>/.linkterm/control-profile.json and non-destructively bring control online: open the ' +
      'configured serial session and connect the configured J-Link probe. This never flashes, erases, resets, ' +
      'halts, or starts a GDB server.',
    sensitivity: 'state-affecting',
    inputSchema: activateControlProfileInputSchema,
    handler: async (input: ActivateControlProfileInput): Promise<ToolHandlerResult> => {
      try {
        const rootContext = await resolveControlRoot(input.root, hostPathResolver);
        const profile = await deps.controlProfileManager.load(rootContext.hostRoot);
        const serial = await activateSerial(profile, openSerial);
        const jlink = await activateJLink(profile, deps.jlinkBackend);
        return {
          success: true,
          sessionId: serial?.sessionId,
          state: serial?.state,
          evidence: {
            kind: 'workspace_config',
            data: {
              ...rootEvidence(rootContext),
              serial,
              jlink,
              flash: profile.flash,
              rtt: profile.rtt,
              activated: {
                serial: serial !== undefined,
                jlink: jlink !== undefined,
                flash: false,
                rtt: false,
              },
            },
            cursor: 0,
          },
        };
      } catch (err) {
        translateControlProfileError(err);
      }
    },
  });
}

/**
 * 构造默认串口激活函数。
 *
 * @param sessionManager 主进程共享 SessionManager
 * @returns 可打开串口 session 的函数
 */
export function defaultOpenSerial(sessionManager: SessionManager): ControlProfileOpenSerial {
  return async (config: SerialSessionConfig): Promise<ControlProfileSerialActivation> => {
    const createConfig = config as SessionCreateRequestConfig;
    const session = await sessionManager.createAndOpen((id) => buildSession(id, createConfig), {
      connectionType: 'serial',
      label: config.label,
      createdBy: 'ai',
      serial: { port: config.port, baudRate: config.baudRate, mode: config.mode },
    });
    return { sessionId: session.id, state: session.state };
  };
}

/**
 * 尝试按 profile 打开串口；未启用时返回 undefined。
 *
 * @param profile 已校验的控制配置
 * @param openSerial 串口打开函数
 * @returns 串口激活结果，或未启用时 undefined
 */
async function activateSerial(
  profile: ControlProfile,
  openSerial: ControlProfileOpenSerial,
): Promise<ControlProfileSerialActivation | undefined> {
  if (profile.serial?.enabled !== true) return undefined;
  const { port, baudRate, mode } = profile.serial;
  if (port === undefined || baudRate === undefined || mode === undefined) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      'serial.enabled=true requires serial.port, serial.baudRate, and serial.mode in control-profile.json',
    );
  }
  return openSerial({
    type: 'serial',
    port,
    baudRate,
    mode,
    label: 'LinkTerm Control: serial',
  });
}

/**
 * 尝试按 profile 连接 J-Link probe；未启用时返回 undefined。
 *
 * @param profile 已校验的控制配置
 * @param jlinkBackend J-Link backend
 * @returns 去除 serialNumber 后的 probe 信息，或未启用时 undefined
 */
async function activateJLink(
  profile: ControlProfile,
  jlinkBackend: IJLinkBackend,
): Promise<Omit<ProbeInfo, 'serialNumber'> | undefined> {
  if (profile.jlink?.enabled !== true) return undefined;
  const { target } = profile.jlink;
  if (target === undefined) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      'jlink.enabled=true requires jlink.target in control-profile.json',
    );
  }
  const targetClassification = classifyJLinkTargetName(target);
  const opts: ProbeConnectOptions = { target: targetClassification.normalizedTarget };
  if (profile.jlink.interface !== undefined) opts.interface = profile.jlink.interface;
  const probe = await runJLink(() => connectProbeWithConfiguredSpeed(jlinkBackend, opts, profile.jlink?.speedKHz));
  return sanitizeProbeForMcp(probe);
}

async function inspectControlProfileDiagnostics(
  root: string,
  profile: ControlProfile | undefined,
  jlinkDeviceCatalog: JLinkDeviceCatalog | undefined,
): Promise<ControlProfileDiagnostic[]> {
  const diagnostics: ControlProfileDiagnostic[] = [];
  const target = profile?.jlink?.target;
  if (target !== undefined) {
    const targetClassification = classifyJLinkTargetName(target);
    if (targetClassification.kind === 'stm32-order-code') {
      diagnostics.push({
        id: 'jlink-target-name',
        status: 'warn',
        message: targetClassification.message ?? `Use ${targetClassification.normalizedTarget} as the SEGGER J-Link target name.`,
      });
    }
    if (jlinkDeviceCatalog !== undefined) {
      const targetForCatalog = targetClassification.normalizedTarget;
      const search = await jlinkDeviceCatalog.search({ query: target, limit: 5 });
      if (search.available && !(await jlinkDeviceCatalog.has(targetForCatalog))) {
        diagnostics.push({
          id: 'jlink-target-catalog',
          status: 'warn',
          message: `J-Link target ${targetForCatalog} is not in the installed SEGGER device catalog.`,
          suggestions: search.devices.slice(0, 5),
        });
      }
    }
  }
  if (!profile?.flash?.binary || !profile.flash.baseAddress) return diagnostics;
  const baseAddress = Number.parseInt(profile.flash.baseAddress, 16);
  if (!Number.isFinite(baseAddress)) return diagnostics;
  try {
    const firmwarePath = path.isAbsolute(profile.flash.binary)
      ? profile.flash.binary
      : path.join(root, profile.flash.binary);
    const binary = await readFile(firmwarePath);
    const check = checkFirmwareVectorTable(binary.subarray(0, FIRMWARE_DIAGNOSTIC_READ_BYTES), baseAddress);
    if (check.status === 'fail') {
      diagnostics.push({
        id: 'firmware-vector-base',
        status: 'fail',
        message: check.message ?? 'firmware reset vector does not match profile.flash.baseAddress',
      });
      return diagnostics;
    }
    if (check.status === 'pass') {
      diagnostics.push({
        id: 'firmware-vector-base',
        status: 'pass',
        message: 'firmware reset vector points inside profile.flash.baseAddress image range',
      });
      return diagnostics;
    }
    return diagnostics;
  } catch (err) {
    diagnostics.push({
      id: 'firmware-readable',
      status: 'warn',
      message: `Unable to read profile.flash.binary for preflight diagnostics: ${err instanceof Error ? err.message : String(err)}`,
    });
    return diagnostics;
  }
}

/**
 * 按 control-profile 中配置的速度连接 J-Link；auto 会从最高速向下回退。
 *
 * @param jlinkBackend J-Link backend
 * @param baseOpts 不含 speedKHz 的连接选项
 * @param speedKHz 数字速度或 auto
 * @returns backend 返回的 probe 信息
 */
async function connectProbeWithConfiguredSpeed(
  jlinkBackend: IJLinkBackend,
  baseOpts: ProbeConnectOptions,
  speedKHz: number | 'auto' | undefined,
): Promise<ProbeInfo> {
  if (speedKHz === undefined) return jlinkBackend.probeConnect(baseOpts);
  if (typeof speedKHz === 'number') {
    return jlinkBackend.probeConnect({ ...baseOpts, speedKHz });
  }

  let lastError: JLinkOperationError | undefined;
  for (const candidate of AUTO_JLINK_SPEEDS_KHZ) {
    try {
      return await jlinkBackend.probeConnect({ ...baseOpts, speedKHz: candidate });
    } catch (err) {
      if (!(err instanceof JLinkOperationError)) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new JLinkOperationError('Unable to connect J-Link with auto speed', { operation: 'probeConnect' });
}

/**
 * 去掉 MCP 边界不应暴露的 J-Link serialNumber.
 *
 * @param p backend 返回的 probe 信息
 * @returns 不含 serialNumber 的 probe 信息
 */
function sanitizeProbeForMcp(p: ProbeInfo): Omit<ProbeInfo, 'serialNumber'> {
  const { serialNumber: _serialNumber, ...rest } = p;
  void _serialNumber;
  return rest;
}

interface ControlRootContext {
  root: string;
  hostRoot: string;
}

async function resolveControlRoot(root: string, hostPathResolver: HostPathResolver): Promise<ControlRootContext> {
  return { root, hostRoot: await hostPathResolver.toHostPath(root) };
}

function rootEvidence(ctx: ControlRootContext): Record<string, unknown> {
  return {
    root: ctx.root,
    path: controlProfilePath(ctx.hostRoot),
    hostRoot: ctx.hostRoot,
    rootResolved: ctx.hostRoot !== ctx.root,
  };
}

/**
 * 构造控制配置读取/写入成功结果。
 *
 * @param rootContext 工作区 root 解析上下文
 * @param profile 控制配置
 * @returns MCP 工具成功结果
 */
function successProfile(rootContext: ControlRootContext, profile: ControlProfile): ToolHandlerResult {
  return {
    success: true,
    evidence: {
      kind: 'workspace_config',
      data: { ...rootEvidence(rootContext), profile },
      cursor: 0,
    },
  };
}

/**
 * 读取 profile；文件不存在时返回 exists=false 而不是错误。
 *
 * @param manager 控制配置管理器
 * @param root 工作区根目录
 * @returns profile 可选值及存在标记
 */
async function loadProfileIfPresent(
  manager: ControlProfileManager,
  root: string,
): Promise<{ exists: boolean; profile: ControlProfile | undefined }> {
  try {
    return { exists: true, profile: await manager.load(root) };
  } catch (err) {
    if (err instanceof ControlProfileNotFoundError) {
      return { exists: false, profile: undefined };
    }
    translateControlProfileError(err);
  }
}

/**
 * 把控制配置域错误翻译为 ToolError 并抛出。
 *
 * @param err 任意 throw 出的错误
 */
function translateControlProfileError(err: unknown): never {
  if (err instanceof ToolError) {
    throw err;
  }
  if (err instanceof ControlProfileAlreadyInitializedError) {
    throw new ToolError(ERROR_CODES.CONTROL_PROFILE_ALREADY_INITIALIZED, err.message, {
      root: err.root,
    });
  }
  if (err instanceof ControlProfileNotFoundError) {
    throw new ToolError(ERROR_CODES.CONTROL_PROFILE_NOT_FOUND, err.message, {
      root: err.root,
    });
  }
  if (err instanceof ControlProfileTooLargeError) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, err.message, {
      root: err.root,
      size: err.size,
    });
  }
  if (err instanceof ControlProfileSchemaVersionMismatchError) {
    throw new ToolError(ERROR_CODES.CONTROL_PROFILE_SCHEMA_VERSION_MISMATCH, err.message, {
      expected: err.expected,
      actual: err.actual,
      root: err.root,
    });
  }
  if (err instanceof WorkspaceInvalidRootError) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, err.message, {
      root: err.root,
    });
  }
  if (err instanceof ZodError) {
    const safeIssues = err.issues.map((i) => ({
      path: i.path,
      message: i.message,
      code: i.code,
    }));
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Invalid control profile payload', {
      issues: safeIssues,
    });
  }
  if (err instanceof SyntaxError) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGUMENT,
      `Control profile file is not valid JSON: ${err.message}`,
    );
  }
  throw err;
}
