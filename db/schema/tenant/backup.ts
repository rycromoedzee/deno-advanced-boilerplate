/**
 * @file db/schema/tenant/backup.ts
 * @description Object-storage backup deferred-delete tombstone queue (DD4).
 *
 * One row per storage key whose LIVE object was hard-deleted. Phase B of the
 * object-storage-backup job purges the BACKUP copy of that key only once
 * `now >= deleteAfter` (the grace window that preserves recoverability of an
 * accidental/malicious delete). Tombstones are captured at delete time because
 * catalog rows are hard-deleted — deletions cannot be discovered by scanning
 * live tables (transactional outbox). Each delete site enqueues a tombstone
 * carrying the exact key(s) it already computed (see the §9 sites).
 */
import { dbTable, index, integer, text } from "../../entities.ts";

export const backupDeletionQueue = dbTable("backup_deletion_queue", {
  id: text("id").primaryKey().notNull(),
  storageKey: text("storage_key").notNull(),
  deletedAt: integer("deleted_at").notNull(),
  deleteAfter: integer("delete_after").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
}, (t) => [
  index("idx_backup_deletion_queue_delete_after").on(t.deleteAfter),
]);
