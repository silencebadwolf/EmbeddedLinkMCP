import { createRequire } from 'node:module';
import type { RuntimeNativeBindings } from '@linkterm/runtime';
import type { SerialPortLike } from '@linkterm/runtime/transports/serial/serial-port-like';

/** The server resolves native libraries from its own deployment directory. */
export function createServerNativeBindings(): RuntimeNativeBindings {
  const requireNative = createRequire(import.meta.url);
  return {
    listSerialPorts: async () => (requireNative('serialport') as typeof import('serialport')).SerialPort.list(),
    createSerialPort: options => {
      const { SerialPort } = requireNative('serialport') as typeof import('serialport');
      return new SerialPort(options) as unknown as SerialPortLike;
    },
    createPty: options => (requireNative('node-pty') as typeof import('node-pty')).spawn(options.file, [...options.args], {
      name: options.name, cols: options.cols, rows: options.rows, cwd: options.cwd, env: options.env,
    }),
  };
}
