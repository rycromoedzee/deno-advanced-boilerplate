/**
 * @file services/object-backup/index.ts
 * @description Barrel re-exports for the object-storage backup module.
 *
 * Intentionally a script/infra-style module (like `services/db-backup/`): a
 * collection of pure helpers — the preflight safety guard, the per-tenant
 * catalog queries, and the object copy — driven by the `object-storage-backup`
 * job. There is no service class and therefore no `singletons.ts`, by design
 * (D4 infra exception). Do not wrap these in a fake service class.
 */

// Preflight (DD7)
export { assertObjectBackupStorageSafe } from "./preflight.ts";
export type { ObjectBackupPreflightDestination, ObjectBackupPreflightInput } from "./preflight.ts";

// Catalog queries (DD1/DD2)
export {
  markAttachmentBackedUp,
  markDocumentMainBackedUp,
  markDocumentThumbnailBackedUp,
  selectUnbackedAttachments,
  selectUnbackedDocuments,
} from "./catalog.ts";
export type { UnbackedAttachment, UnbackedDocument } from "./catalog.ts";

// Object copy (DD3)
export { copyObject } from "./copy.ts";
export type { CopyObjectDeps } from "./copy.ts";

// Backup-side purge (Phase B/C)
export { purgeBackupObject, purgeEnvironmentBackupSubtree } from "./purge.ts";
export type { PurgeDeps } from "./purge.ts";

// Deferred-delete queue (DD4/DD8)
export {
  backupDeleteAfter,
  buildBackupTombstoneRows,
  buildEnvironmentPurgeRow,
  bumpEnvironmentPurgeAttempts,
  bumpTombstoneAttempts,
  enqueueEnvironmentPurge,
  environmentBackupPrefix,
  markEnvironmentPurgeDone,
  markTombstonePurged,
  selectDueEnvironmentPurges,
  selectDueTombstones,
} from "./tombstone.ts";
export type { BackupTombstoneRow, DueEnvPurge, DueTombstone, EnvironmentPurgeRow } from "./tombstone.ts";
