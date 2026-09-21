import type { ClientAPI } from '@linkterm/contracts/client-api';

declare global {
  interface Window {
    linkterm: ClientAPI;
  }
}
