import { types } from 'node:util';

export function readOwnDataPath(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || types.isProxy(current)) return undefined;
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor === undefined || !('value' in descriptor)) return undefined;
    current = descriptor.value;
  }
  return types.isProxy(current) ? undefined : current;
}
