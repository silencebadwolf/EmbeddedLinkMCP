import { createRequire } from 'node:module';
import type { RuntimeNativeBindings } from '@linkterm/runtime';
import type { SerialPortLike } from '@linkterm/runtime/transports/serial/serial-port-like';

/** Native loading belongs to the Electron host, never to shared runtime modules. */
export function createDesktopNativeBindings(): RuntimeNativeBindings {
  const requireNative = createRequire(import.meta.url);
  return {
    createSerialPort: (options) => {
      const { SerialPort } = requireNative('serialport') as typeof import('serialport');
      return new SerialPort(options) as unknown as SerialPortLike;
    },
    listSerialPorts: async () => {
      const { SerialPort } = requireNative('serialport') as typeof import('serialport');
      return SerialPort.list();
    },
    createPty: (options) => {
      const pty = requireNative('node-pty') as typeof import('node-pty');
      return pty.spawn(options.file, [...options.args], {
        name: options.name,
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: options.env,
      });
    },
  };
}
