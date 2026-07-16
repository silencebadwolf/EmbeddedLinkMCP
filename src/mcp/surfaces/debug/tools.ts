/**
 * MCP debug surface 工具实现 —— 非二进制部分（22 个）。
 *
 * 二进制载荷工具（memory / flash / rtt_read / rtt_search / snapshot）见
 * `./tools-binary.ts`。两文件共同覆盖 30 个 J-Link MCP 工具。
 *
 * 每个 handler：
 * 1. 走 {@link runJLink} wrapper —— 集中翻译 JLinkError 子类；
 * 2. 返回 `evidence.kind = 'debug_output'`；
 * 3. 不直接接触 base64（属于 tools-binary 域）；
 * 4. sensitivity 与 J-Link 操作语义严格对应 —— read 类一律 read-only，write/run 类
 *    一律 state-affecting（决定 schema mismatch 时是否拒绝）。
 *
 * **注册入口**：{@link registerDebugTools}。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HostPathResolver } from '../../../core/workspace/index.js';
import type { IJLinkBackend, ProbeInfo } from '../../../jlink/types.js';
import { normalizeJLinkTargetName } from '../../../shared/jlink-target-name.js';
import { registerTool, type ToolHandlerResult } from '../../registry.js';
import { ok, runJLink, withAbortableTimeout } from './error-translate.js';
import {
  breakpointClearInputSchema,
  breakpointListInputSchema,
  breakpointSetInputSchema,
  commanderScriptInputSchema,
  cpuHaltInputSchema,
  cpuResetInputSchema,
  cpuRunInputSchema,
  cpuStepInputSchema,
  crashDiagnoseInputSchema,
  flashEraseInputSchema,
  gdbServerStartInputSchema,
  gdbServerStopInputSchema,
  jlinkRebootInputSchema,
  probeConnectInputSchema,
  probeDetectInputSchema,
  probeDisconnectInputSchema,
  probeStatusInputSchema,
  registerListInputSchema,
  registerReadInputSchema,
  registerWriteInputSchema,
  rttClearInputSchema,
  rttConnectInputSchema,
  type BreakpointClearInput,
  type BreakpointListInput,
  type BreakpointSetInput,
  type CommanderScriptInput,
  type CpuHaltInput,
  type CpuResetInput,
  type CpuRunInput,
  type CpuStepInput,
  type CrashDiagnoseInput,
  type FlashEraseInput,
  type GdbServerStartInput,
  type GdbServerStopInput,
  type JLinkRebootInput,
  type ProbeConnectInput,
  type ProbeDetectInput,
  type ProbeDisconnectInput,
  type ProbeStatusInput,
  type RegisterListInput,
  type RegisterReadInput,
  type RegisterWriteInput,
  type RttClearInput,
  type RttConnectInput,
} from './schemas.js';

/** registerDebugTools 的依赖容器；与 main 进程 MainProcessContext 同源。 */
export interface DebugToolsDeps {
  /** J-Link backend；缺省时 server 注入 NullJLinkBackend，全工具拒绝。 */
  jlinkBackend: IJLinkBackend;
  /** 把客户端/WSL profileRoot 解析为 LinkTerm 后端可读路径。 */
  hostPathResolver?: HostPathResolver;
}

/**
 * 把 backend 返回的 ProbeInfo 在 MCP 边界上去掉 `serialNumber`。
 *
 * 隐私边界：硬件序列号常贴在 J-Link probe 外壳上，部分 SEGGER 型号的 serialNumber 同时
 * 是 license key（参见 Phase9.md Q3）。MCP 评测端不应看到此字段；adapter 内部仍保留
 * 以便后期与 Commander 对接。与 workspace surface 的 ConflictReport 清洗同思路。
 */
function sanitizeProbeForMcp(p: ProbeInfo): Omit<ProbeInfo, 'serialNumber'> {
  const { serialNumber: _serialNumber, ...rest } = p;
  void _serialNumber;
  return rest;
}

/**
 * 注册非二进制 debug 工具到 McpServer（20 个）。
 *
 * @param server McpServer 实例
 * @param deps 共享依赖
 */
export function registerDebugTools(server: McpServer, deps: DebugToolsDeps): void {
  const { jlinkBackend } = deps;

  // -- probe lifecycle -------------------------------------------------

  registerTool(server, {
    name: 'probe_detect',
    description: 'Enumerate currently visible J-Link probes (one-shot).',
    sensitivity: 'read-only',
    inputSchema: probeDetectInputSchema,
    handler: async (_input: ProbeDetectInput): Promise<ToolHandlerResult> => {
      const probes = await runJLink(() => jlinkBackend.probeDetect());
      const sanitized = probes.map(sanitizeProbeForMcp);
      return ok({ evidence: { kind: 'debug_output', data: { probes: sanitized }, cursor: 0 } });
    },
  });

  registerTool(server, {
    name: 'probe_connect',
    description:
      'Connect a J-Link probe to a target device. target is required (J-Link Commander semantics). ' +
      'Returns a probeId UUID for use in subsequent calls.',
    sensitivity: 'state-affecting',
    inputSchema: probeConnectInputSchema,
    handler: async (input: ProbeConnectInput): Promise<ToolHandlerResult> => {
      const target = normalizeJLinkTargetName(input.target);
      const probe = await runJLink(() =>
        jlinkBackend.probeConnect({
          target,
          ...(input.interface !== undefined ? { interface: input.interface } : {}),
          ...(input.speedKHz !== undefined ? { speedKHz: input.speedKHz } : {}),
          ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
        }),
      );
      return ok({
        evidence: {
          kind: 'debug_output',
          data: { probe: sanitizeProbeForMcp(probe) },
          cursor: 0,
        },
      });
    },
  });

  registerTool(server, {
    name: 'probe_disconnect',
    description: 'Disconnect a probe by probeId; the id becomes invalid afterwards.',
    sensitivity: 'state-affecting',
    inputSchema: probeDisconnectInputSchema,
    handler: async (input: ProbeDisconnectInput): Promise<ToolHandlerResult> => {
      await runJLink(() => jlinkBackend.probeDisconnect(input.probeId));
      return ok({
        evidence: {
          kind: 'debug_output',
          data: { probeId: input.probeId, disconnected: true },
          cursor: 0,
        },
      });
    },
  });

  registerTool(server, {
    name: 'probe_status',
    description: 'Query the current connection state and metadata of a probe.',
    sensitivity: 'read-only',
    inputSchema: probeStatusInputSchema,
    handler: async (input: ProbeStatusInput): Promise<ToolHandlerResult> => {
      const probe = await runJLink(() => jlinkBackend.probeStatus(input.probeId));
      return ok({
        evidence: {
          kind: 'debug_output',
          data: { probe: sanitizeProbeForMcp(probe) },
          cursor: 0,
        },
      });
    },
  });

  registerTool(server, {
    name: 'jlink_reboot',
    description:
      'Reboot the J-Link probe itself through SEGGER Commander without connecting to a target. ' +
      'Use this when probe discovery or target attach is stuck, for example a red LED / USB transport lockup. ' +
      'serialNumber can select a specific physical probe; it is never echoed in evidence. ' +
      'force defaults to true for recovery. ' +
      'High-impact operations execute immediately and remain visible in Activity Center and audit records. ' +
      'No external CLI fallback.',
    sensitivity: 'state-affecting',
    inputSchema: jlinkRebootInputSchema,
    handler: async (input: JLinkRebootInput): Promise<ToolHandlerResult> => {
      return runJLink(async () => {
        const force = input.force ?? true;
        const result = await withAbortableTimeout(input.timeoutMs, (signal) =>
          jlinkBackend.jlinkReboot(
            {
              force,
              ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
              ...(input.reconnectTimeoutMs !== undefined
                ? { reconnectTimeoutMs: input.reconnectTimeoutMs }
                : {}),
              ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
            },
            signal,
          ),
        );
        return ok({
          evidence: {
            kind: 'debug_output',
            data: {
              rebooted: true,
              selection: input.serialNumber !== undefined ? 'serialNumber' : 'default',
              force,
              ...(input.reconnectTimeoutMs !== undefined
                ? { reconnectTimeoutMs: input.reconnectTimeoutMs }
                : {}),
              commander: result,
            },
            cursor: 0,
          },
        });
      });
    },
  });

  // -- cpu control ----------------------------------------------------

  registerTool(server, {
    name: 'cpu_reset',
    description:
      'Reset the CPU. halt=true holds at the first instruction after reset. ' +
      'High-impact operations execute immediately and remain visible in Activity Center and audit records. ' +
      'No external CLI fallback.',
    sensitivity: 'state-affecting',
    inputSchema: cpuResetInputSchema,
    handler: async (input: CpuResetInput): Promise<ToolHandlerResult> => {
      await runJLink(async () => {
        await jlinkBackend.cpuReset(
          input.probeId,
          input.halt !== undefined ? { halt: input.halt } : undefined,
        );
      });
      return ok({
        evidence: {
          kind: 'debug_output',
          data: { probeId: input.probeId, halt: input.halt ?? false },
          cursor: 0,
        },
      });
    },
  });

  registerTool(server, {
    name: 'cpu_halt',
    description: 'Halt CPU execution.',
    sensitivity: 'state-affecting',
    inputSchema: cpuHaltInputSchema,
    handler: async (input: CpuHaltInput): Promise<ToolHandlerResult> => {
      await runJLink(() => jlinkBackend.cpuHalt(input.probeId));
      return ok({
        evidence: { kind: 'debug_output', data: { probeId: input.probeId, halted: true }, cursor: 0 },
      });
    },
  });

  registerTool(server, {
    name: 'cpu_run',
    description: 'Resume CPU execution from halt.',
    sensitivity: 'state-affecting',
    inputSchema: cpuRunInputSchema,
    handler: async (input: CpuRunInput): Promise<ToolHandlerResult> => {
      await runJLink(() => jlinkBackend.cpuRun(input.probeId));
      return ok({
        evidence: { kind: 'debug_output', data: { probeId: input.probeId, running: true }, cursor: 0 },
      });
    },
  });

  registerTool(server, {
    name: 'cpu_step',
    description: 'Single-step one instruction (CPU must be halted).',
    sensitivity: 'state-affecting',
    inputSchema: cpuStepInputSchema,
    handler: async (input: CpuStepInput): Promise<ToolHandlerResult> => {
      await runJLink(() => jlinkBackend.cpuStep(input.probeId));
      return ok({
        evidence: { kind: 'debug_output', data: { probeId: input.probeId, stepped: true }, cursor: 0 },
      });
    },
  });

  // -- breakpoints ----------------------------------------------------

  registerTool(server, {
    name: 'breakpoint_set',
    description: 'Set a breakpoint at the given address. kind defaults to sw.',
    sensitivity: 'state-affecting',
    inputSchema: breakpointSetInputSchema,
    handler: async (input: BreakpointSetInput): Promise<ToolHandlerResult> => {
      const bp = await runJLink(() =>
        jlinkBackend.breakpointSet(
          input.probeId,
          input.address,
          input.kind !== undefined ? { kind: input.kind } : undefined,
        ),
      );
      return ok({ evidence: { kind: 'debug_output', data: { breakpoint: bp }, cursor: 0 } });
    },
  });

  registerTool(server, {
    name: 'breakpoint_clear',
    description: 'Clear a breakpoint by id.',
    sensitivity: 'state-affecting',
    inputSchema: breakpointClearInputSchema,
    handler: async (input: BreakpointClearInput): Promise<ToolHandlerResult> => {
      await runJLink(() => jlinkBackend.breakpointClear(input.probeId, input.id));
      return ok({
        evidence: { kind: 'debug_output', data: { id: input.id, cleared: true }, cursor: 0 },
      });
    },
  });

  registerTool(server, {
    name: 'breakpoint_list',
    description: 'List all currently set breakpoints.',
    sensitivity: 'read-only',
    inputSchema: breakpointListInputSchema,
    handler: async (input: BreakpointListInput): Promise<ToolHandlerResult> => {
      const breakpoints = await runJLink(() => jlinkBackend.breakpointList(input.probeId));
      return ok({ evidence: { kind: 'debug_output', data: { breakpoints }, cursor: 0 } });
    },
  });

  // -- registers ------------------------------------------------------

  registerTool(server, {
    name: 'register_read',
    description: 'Read a single register by name (e.g. r0, sp, pc).',
    sensitivity: 'read-only',
    inputSchema: registerReadInputSchema,
    handler: async (input: RegisterReadInput): Promise<ToolHandlerResult> => {
      const reg = await runJLink(() => jlinkBackend.registerRead(input.probeId, input.name));
      return ok({ evidence: { kind: 'debug_output', data: { register: reg }, cursor: 0 } });
    },
  });

  registerTool(server, {
    name: 'register_write',
    description: 'Write a register value (CPU should be halted for safety).',
    sensitivity: 'state-affecting',
    inputSchema: registerWriteInputSchema,
    handler: async (input: RegisterWriteInput): Promise<ToolHandlerResult> => {
      await runJLink(() =>
        jlinkBackend.registerWrite(input.probeId, input.name, input.value),
      );
      return ok({
        evidence: {
          kind: 'debug_output',
          data: { name: input.name, value: input.value, written: true },
          cursor: 0,
        },
      });
    },
  });

  registerTool(server, {
    name: 'register_list',
    description: 'List all architecture-visible registers and their current values.',
    sensitivity: 'read-only',
    inputSchema: registerListInputSchema,
    handler: async (input: RegisterListInput): Promise<ToolHandlerResult> => {
      const registers = await runJLink(() => jlinkBackend.registerList(input.probeId));
      return ok({ evidence: { kind: 'debug_output', data: { registers }, cursor: 0 } });
    },
  });

  // -- flash erase (no binary in/out) ---------------------------------

  registerTool(server, {
    name: 'flash_erase',
    description:
      'Erase flash; with no address/length, erases the whole chip. ' +
      'High-impact operations execute immediately and remain visible in Activity Center and audit records. ' +
      'No external CLI fallback.',
    sensitivity: 'state-affecting',
    inputSchema: flashEraseInputSchema,
    handler: async (input: FlashEraseInput): Promise<ToolHandlerResult> => {
      const opts: { address?: number; length?: number } = {};
      if (input.address !== undefined) opts.address = input.address;
      if (input.length !== undefined) opts.length = input.length;
      await runJLink(async () => {
        await jlinkBackend.flashErase(
          input.probeId,
          Object.keys(opts).length > 0 ? opts : undefined,
        );
      });
      return ok({
        evidence: { kind: 'debug_output', data: { probeId: input.probeId, erased: true }, cursor: 0 },
      });
    },
  });

  // -- RTT (connect / clear; read & search are binary) ----------------

  registerTool(server, {
    name: 'rtt_connect',
    description: 'Connect to the target RTT control block; returns visible channels.',
    sensitivity: 'state-affecting',
    inputSchema: rttConnectInputSchema,
    handler: async (input: RttConnectInput): Promise<ToolHandlerResult> => {
      const result = await runJLink(() =>
        jlinkBackend.rttConnect(
          input.probeId,
          input.controlBlockAddress !== undefined
            ? { controlBlockAddress: input.controlBlockAddress }
            : undefined,
        ),
      );
      return ok({ evidence: { kind: 'debug_output', data: result, cursor: 0 } });
    },
  });

  registerTool(server, {
    name: 'rtt_clear',
    description: 'Drain the buffer of the given RTT channel.',
    sensitivity: 'state-affecting',
    inputSchema: rttClearInputSchema,
    handler: async (input: RttClearInput): Promise<ToolHandlerResult> => {
      await runJLink(() => jlinkBackend.rttClear(input.probeId, input.channelIndex));
      return ok({
        evidence: {
          kind: 'debug_output',
          data: { probeId: input.probeId, channelIndex: input.channelIndex, cleared: true },
          cursor: 0,
        },
      });
    },
  });

  // -- GDB ------------------------------------------------------------

  registerTool(server, {
    name: 'gdb_server_start',
    description:
      'Start a GDB server bound to the given host/port. timeoutMs aborts the operation if the ' +
      'server fails to bind in time. ' +
      'High-impact operations execute immediately and remain visible in Activity Center and audit records. ' +
      'No external CLI fallback.',
    sensitivity: 'state-affecting',
    inputSchema: gdbServerStartInputSchema,
    handler: async (input: GdbServerStartInput): Promise<ToolHandlerResult> => {
      return runJLink(async () => {
        const opts: { port?: number; host?: string } = {};
        if (input.port !== undefined) opts.port = input.port;
        if (input.host !== undefined) opts.host = input.host;
        const handle = await withAbortableTimeout(input.timeoutMs, (signal) =>
          jlinkBackend.gdbServerStart(
            input.probeId,
            Object.keys(opts).length > 0 ? opts : undefined,
            signal,
          ),
        );
        return ok({ evidence: { kind: 'debug_output', data: { handle }, cursor: 0 } });
      });
    },
  });

  registerTool(server, {
    name: 'gdb_server_stop',
    description: 'Stop the GDB server associated with the probe.',
    sensitivity: 'state-affecting',
    inputSchema: gdbServerStopInputSchema,
    handler: async (input: GdbServerStopInput): Promise<ToolHandlerResult> => {
      await runJLink(() => jlinkBackend.gdbServerStop(input.probeId));
      return ok({
        evidence: { kind: 'debug_output', data: { probeId: input.probeId, stopped: true }, cursor: 0 },
      });
    },
  });

  // -- diagnostics (crash; snapshot is in tools-binary because of memorySnippets) --

  registerTool(server, {
    name: 'crash_diagnose',
    description:
      'Inspect the current fault handler context and return a structured diagnosis ' +
      '(fault kind, registers, stack trace).',
    sensitivity: 'read-only',
    inputSchema: crashDiagnoseInputSchema,
    handler: async (input: CrashDiagnoseInput): Promise<ToolHandlerResult> => {
      const diagnosis = await runJLink(() => jlinkBackend.crashDiagnose(input.probeId));
      return ok({ evidence: { kind: 'debug_output', data: { diagnosis }, cursor: 0 } });
    },
  });

  registerTool(server, {
    name: 'jlink_commander_script',
    description:
      'Run a LinkTerm-controlled J-Link Commander diagnostic script. Connection lines are generated ' +
      'from the probe handle; commands are restricted to a safe whitelist. ' +
      'High-impact operations execute immediately and remain visible in Activity Center and audit records. ' +
      'No external CLI fallback.',
    sensitivity: 'state-affecting',
    inputSchema: commanderScriptInputSchema,
    handler: async (input: CommanderScriptInput): Promise<ToolHandlerResult> => {
      return runJLink(async () => {
        const opts = input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : undefined;
        const result = await jlinkBackend.runCommanderScript(input.probeId, input.commands, opts);
        return ok({
          evidence: {
            kind: 'debug_output',
            data: result,
            cursor: 0,
          },
        });
      });
    },
  });
}
