import type { ClientAPI } from '@linkterm/contracts/client-api';
import {
  configureLinktermClient,
  getLinkterm,
  isLinktermAvailable,
} from '@linkterm/ui/lib/linkterm-bridge';
import { afterEach, expect, it } from 'vitest';

afterEach(() => configureLinktermClient(() => null));

it('uses the host-supplied client and observes replacement or disconnection', () => {
  const desktop = {} as ClientAPI;
  const web = {} as ClientAPI;
  let client: ClientAPI | null = desktop;
  configureLinktermClient(() => client);
  expect(getLinkterm()).toBe(desktop);
  client = web;
  expect(getLinkterm()).toBe(web);
  expect(isLinktermAvailable()).toBe(true);
  client = null;
  expect(getLinkterm()).toBeNull();
  expect(isLinktermAvailable()).toBe(false);
});
