/** Barrel export for src/core/workspace/. */

export {
  WORKSPACE_SCHEMA_VERSION,
  REQUIRED_FIELDS,
  type ChipConfig,
  type FlashConfig,
  type DebugConfig,
  type RttConfig,
  type SerialPersistedConfig,
  type WorkspaceConfig,
  type RequiredField,
} from './types.js';

export {
  workspaceConfigSchema,
  workspaceConfigPatchSchema,
  chipSchema,
  flashSchema,
  debugSchema,
  rttSchema,
  serialPersistedSchema,
  type WorkspaceConfigPatch,
} from './config-schema.js';

export {
  detectConflicts,
  type Conflict,
  type ConflictReport,
  type EvidenceSnapshot,
} from './conflict-detect.js';

export {
  defaultFsPrimitives,
  type FsPrimitives,
} from './fs-primitives.js';

export {
  WorkspaceConfigManager,
  WorkspaceAlreadyInitializedError,
  WorkspaceNotFoundError,
  WorkspaceConflictError,
  WorkspaceInvalidRootError,
  WorkspaceConfigTooLargeError,
  WorkspaceSchemaVersionMismatchError,
  assertValidRoot,
  type WorkspaceConfigManagerOptions,
} from './workspace-config-manager.js';
