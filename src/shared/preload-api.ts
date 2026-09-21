/** Compatibility export during the pnpm workspace migration. */
export * from '@linkterm/contracts/preload-api';

import type { PreloadAPI } from '@linkterm/contracts/preload-api';

declare global {
  interface Window {
    /** Electron preload API, owned by the desktop host. */
    linkterm: PreloadAPI;
  }
}
