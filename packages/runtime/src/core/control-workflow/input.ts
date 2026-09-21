/** Domain input accepted by the deterministic workflow runner after boundary validation. */
export interface RunControlWorkflowInput {
  root: string;
  mode: ControlWorkflowMode;
  firmware?: {
    filePath?: string;
    baseAddress?: string;
    verify?: boolean;
    timeoutMs?: number;
  };
  observe?: {
    enabled?: boolean;
    serial?: boolean;
    timeoutMs?: number;
    markers?: string[];
    clearBeforeObserve?: boolean;
  };
  debug?: {
    readRegisters?: boolean;
    readMemory?: { address: number; length: number }[];
    rttRead?: boolean;
    haltOnFailure?: boolean;
  };
  /** Legacy metadata retained for callers; the runner never uses it as authorization. */
  confirm?: boolean;
  dryRun?: boolean;
  execution?: { mode: 'sync' | 'background' };
  correlationId?: string;
  clientSchemaVersion?: string;
}

export type ControlWorkflowMode = 'flash-observe' | 'debug-diagnose' | 'flash-observe-diagnose';
