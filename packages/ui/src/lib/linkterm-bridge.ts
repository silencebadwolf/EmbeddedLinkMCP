import type { ClientAPI } from '@linkterm/contracts/client-api';

let resolveClient: () => ClientAPI | null = () => null;

/** Configure the host adapter before mounting App; the UI has no platform globals. */
export function configureLinktermClient(provider: () => ClientAPI | null): void {
  resolveClient = provider;
}

/** Return the host's current client, or null while it is unavailable. */
export function getLinkterm(): ClientAPI | null {
  return resolveClient();
}

export function isLinktermAvailable(): boolean {
  return getLinkterm() !== null;
}
