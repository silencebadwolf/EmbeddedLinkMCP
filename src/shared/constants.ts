/**
 * 跨进程共享常量。
 *
 * 用法：主进程、渲染进程、测试都可以从此处导入；任何"魔法数字"应集中在这里，避免散落各模块。
 */

/** 应用显示名称（窗口标题、关于对话框等使用）。 */
export const APP_NAME = 'LinkTerm v2';

/**
 * 默认操作超时（毫秒）。
 * 用于 sendAndWait、open/close 兜底、IPC 请求等需要超时保护的场景。
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * TranscriptBuffer 默认环形容量上限（事件条数）。
 * 超过此上限时，最旧的事件会被丢弃，后续 readSince 会通过 ReadResult.truncated 标志通知调用方。
 */
export const MAX_TRANSCRIPT_EVENTS = 100_000;

/**
 * 单个事件 data 字段大小上限（字节）。超过此大小的写入会被拆分。
 * Phase 1 仅作为常量预留，分片在 transport 层按需实现。
 */
export const MAX_EVENT_DATA_BYTES = 64 * 1024;

/** 串口默认波特率（嵌入式开发常用 115200）。 */
export const DEFAULT_SERIAL_BAUD_RATE = 115200;

/** 串口默认数据位。 */
export const DEFAULT_SERIAL_DATA_BITS = 8;

/** 串口默认停止位。 */
export const DEFAULT_SERIAL_STOP_BITS = 1;

/** 串口默认校验位。 */
export const DEFAULT_SERIAL_PARITY = 'none';

/**
 * SerialDiscovery 轮询间隔（毫秒）。
 * `serialport` 不提供 hot-plug 通知，需要轮询 list 检测增删；
 * 仅当存在订阅者时启动定时器，无订阅时停止以避免常驻消耗。
 */
export const SERIAL_DISCOVERY_POLL_INTERVAL_MS = 2000;

/** SSH 默认监听端口。 */
export const DEFAULT_SSH_PORT = 22;
