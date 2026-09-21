import type { SerialMode, SerialSessionConfig, SessionId } from '@linkterm/contracts/types';
import { SessionBase } from '../../core/session/session-base.js';
import { SerialTransport } from './serial-transport.js';
import type { SerialPortFactory } from './serial-port-like.js';

export interface SerialSessionOptions {
  id: SessionId;
  config: SerialSessionConfig;
  /** 注入用 SerialPort 工厂；测试场景下传 FakeSerialPort 工厂。 */
  portFactory?: SerialPortFactory;
  /** TranscriptBuffer 容量上限（仅用于测试覆盖溢出场景）。 */
  transcriptCapacity?: number;
}

/**
 * 串口会话实现。
 *
 * Phase 2 仅作为 SessionBase + SerialTransport 的工厂。`mode` 字段在此保留为只读属性，
 * Phase 7 引入 `sendAndWait` / 终端规则时会在此分支：normal 透传、terminal 走规则编排。
 */
export class SerialSession extends SessionBase {
  readonly mode: SerialMode;

  constructor(options: SerialSessionOptions) {
    const transport = new SerialTransport({
      config: options.config,
      portFactory: options.portFactory,
    });
    super({
      id: options.id,
      transport,
      transcriptCapacity: options.transcriptCapacity,
    });
    this.mode = options.config.mode;
  }
}
