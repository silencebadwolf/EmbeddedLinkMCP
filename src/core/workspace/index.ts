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

export {
  CONTROL_PROFILE_SCHEMA_VERSION,
  type ControlSerialProfile,
  type ControlJLinkProfile,
  type ControlFlashProfile,
  type ControlRttProfile,
  type ControlProfile,
} from './control-profile-types.js';

export {
  hexAddressSchema,
  controlSerialProfileSchema,
  controlJLinkProfileSchema,
  controlFlashProfileSchema,
  controlRttProfileSchema,
  controlProfileBodySchema,
  controlProfileSchema,
  type ControlProfileBody,
} from './control-profile-schema.js';

export {
  ControlProfileManager,
  ControlProfileAlreadyInitializedError,
  ControlProfileNotFoundError,
  ControlProfileTooLargeError,
  ControlProfileSchemaVersionMismatchError,
  controlProfilePath,
  type ControlProfileManagerOptions,
} from './control-profile-manager.js';

export {
  createHostPathResolver,
  defaultHostPathResolver,
  type HostPathResolver,
  type HostPathResolverOptions,
  type WslHostPathRoot,
} from './host-path-resolver.js';

export {
  parseControlProfileAnswer,
  inspectControlProfileCompleteness,
  buildControlProfileQuestion,
  type ControlProfileField,
  type RejectedControlProfileField,
  type ParsedControlProfileAnswer,
  type ControlProfileCompletenessReport,
} from './control-profile-answer-parser.js';
