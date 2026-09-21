/**
 * 共享的 session 工厂：把"按 SessionCreateRequestConfig 构造 ISession"逻辑从 MCP `tools.ts`
 * 抽出，由 IPC `session:create` handler 与 MCP `open_session` 工具共用。
 *
 * Phase 6 评审中本文件从 `src/main/session-factory.ts` 迁到 `src/core/session/`：
 * - 此前 `src/mcp/` 反向 import `src/main/`，违反分层（MCP 不应该依赖 Electron 主进程层）
 * - 工厂仅做 transport 实例拼装，不依赖 Electron API；放在 core 让 main / mcp 同向消费 core
 *
 * 这一抽象的存在是 §4.5 不变量的物理基础 —— 只有当 IPC 与 MCP 共用同一构造路径，
 * 才能保证 "AI 与人创建的 session" 走完全相同的 transport 实例化序列、相同的默认值与
 * 安全约束（例：SSH `hostVerifier` 永远拒绝未知主机直到 Phase 8）。
 */

import type { ISession } from './types.js';
import type { RuntimeNativeBindings } from '../../ports.js';
import type { SessionId } from '@linkterm/contracts/types';
import type { SessionCreateRequestConfig } from '@linkterm/contracts/preload-api';
import { SerialSession } from '../../transports/serial/serial-session.js';
import { SshSession } from '../../transports/ssh/ssh-session.js';
import { LocalShellSession } from '../../transports/local-shell/local-shell-session.js';
import type {
  SshHostVerifier,
  SshCredentials as TransportSshCredentials,
} from '../../transports/ssh/ssh-client-like.js';

/**
 * 按 SessionCreateRequestConfig 的 type 字段构造 ISession 实例。
 *
 * **安全不变量**：
 * - SSH 凭据仅作为 `SshSession` 构造参数传入，由 SshTransport 在 open() 第一个 await
 *   之前清零，绝不进入 SshSessionConfig（见 transports/ssh/ssh-session.ts 注释）。
 * - SSH `hostVerifier` 在 Phase 4-7 一律返回 false（拒绝未知主机），直到 Phase 8 引入
 *   known_hosts 持久层后才可放宽。
 *
 * @param id 由 SessionManager 分配的 session id
 * @param config 已通过校验的连接参数（包含 SSH 凭据；本函数仅瞬时引用）
 * @returns 未 open 的 ISession（调用方负责 open）
 */
export type SessionBuilder = (id: SessionId, config: SessionCreateRequestConfig) => ISession;

export function buildSession(
  id: SessionId,
  config: SessionCreateRequestConfig,
  nativeBindings?: RuntimeNativeBindings,
): ISession {
  switch (config.type) {
    case 'serial':
      return new SerialSession({
        id,
        ...(nativeBindings === undefined ? {} : { portFactory: nativeBindings.createSerialPort }),
        config: {
          type: 'serial',
          port: config.port,
          baudRate: config.baudRate,
          mode: config.mode,
          dataBits: config.dataBits,
          stopBits: config.stopBits,
          parity: config.parity,
          rtscts: config.rtscts,
          xon: config.xon,
          xoff: config.xoff,
          label: config.label,
        },
      });
    case 'ssh': {
      const credentials: TransportSshCredentials =
        config.credentials.kind === 'password'
          ? { kind: 'password', password: config.credentials.password }
          : {
              kind: 'privateKey',
              privateKey: config.credentials.privateKey,
              passphrase: config.credentials.passphrase,
            };
      // Phase 4-7：MCP 与 IPC 入口都不暴露任何"信任未知主机"开关 —— 无 known_hosts 持久层，
      // hostVerifier 一律返回 false。Phase 8 引入持久化信任后会改为按指纹比对。
      const hostVerifier: SshHostVerifier = () => false;
      return new SshSession({
        id,
        config: {
          type: 'ssh',
          host: config.host,
          port: config.port,
          username: config.username,
          keepaliveIntervalMs: config.keepaliveIntervalMs,
          readyTimeoutMs: config.readyTimeoutMs,
          term: config.term,
          rows: config.rows,
          cols: config.cols,
          label: config.label,
        },
        credentials,
        hostVerifier,
      });
    }
    case 'local-shell':
      return new LocalShellSession({
        id,
        ...(nativeBindings === undefined ? {} : { ptyFactory: nativeBindings.createPty }),
        config: {
          type: 'local-shell',
          shell: config.shell,
          args: config.args,
          cwd: config.cwd,
          env: config.env,
          term: config.term,
          rows: config.rows,
          cols: config.cols,
          label: config.label,
        },
      });
  }
}
