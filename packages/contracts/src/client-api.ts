/** Host-independent API implemented by desktop IPC and the Web HTTP/WS client. */
export type {
  PreloadAPI as ClientAPI,
  PreloadResult as ClientResult,
  PreloadOk as ClientSuccess,
  PreloadFail as ClientFailure,
  Unsubscribe,
} from './preload-api.js';
