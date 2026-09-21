import type { ControlProfile } from './control-profile-types.js';

export const CONTROL_PROFILE_RECORDS_SCHEMA_VERSION = 'linkterm-control-records/1.0.0' as const;

export type ControlProfileRecordSource = 'manual' | 'ai';

export interface ControlProfileRecord {
  id: string;
  label: string;
  root: string;
  source: ControlProfileRecordSource;
  profile: ControlProfile;
  createdAt: string;
  updatedAt: string;
}

export interface ControlProfileRecordsFile {
  schemaVersion: typeof CONTROL_PROFILE_RECORDS_SCHEMA_VERSION;
  records: ControlProfileRecord[];
}

export interface SaveControlProfileRecordInput {
  root: string;
  source: ControlProfileRecordSource;
  profile: ControlProfile;
  label?: string;
  /** 修复已有记录时指定；省略时继续按 root + profile 指纹创建/去重。 */
  recordId?: string;
  expectedUpdatedAt?: string;
}
