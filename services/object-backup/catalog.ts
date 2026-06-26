/**
 * @file services/object-backup/catalog.ts
 * @description Per-tenant catalog queries for object-storage backup (DD1/DD2).
 *
 * Drives the backup off the DB catalog (not bucket listing): selects rows whose
 * `backedUpAt IS NULL` (and, for documents, rows whose thumbnail is not yet
 * backed up via a separate `thumbnailBackedUpAt`), and marks them backed up
 * ONLY after a confirmed upload (see copy.ts + the job's Phase A).
 *
 * Object keys are read directly off the row (`folderPath`, `thumbnailPath`,
 * `storageKey`) — never reconstructed from mimeType — because the upload path
 * already persisted the full keys. Rows are ordered by `createdAt` for a
 * deterministic, resumable first-run seed (the flag is self-healing regardless
 * of order, but a stable order makes seed progress observable).
 */
import { and, asc, eq, isNotNull, isNull, or } from "@deps";
import type { TenantDB } from "@db/db.ts";
import { tenantTables } from "@db/index.ts";

export interface UnbackedDocument {
  id: string;
  /** Full document object key (storage_metadata.folderPath). */
  folderPath: string;
  /** Full thumbnail object key, or null if the document has no thumbnail. */
  thumbnailPath: string | null;
  /** True when the main object still needs copying (backedUpAt IS NULL). */
  needsMain: boolean;
  /** True when a thumbnail exists and is not yet backed up. */
  needsThumbnail: boolean;
}

export interface UnbackedAttachment {
  id: string;
  /** Full attachment object key (note_attachments.storageKey). */
  storageKey: string;
}

/**
 * Document rows needing backup: main object un-backed, OR a thumbnail present
 * but un-backed. Ordered by createdAt, capped at `limit`.
 */
export async function selectUnbackedDocuments(
  db: TenantDB,
  limit: number,
): Promise<UnbackedDocument[]> {
  const sm = tenantTables.storageMetadata;
  const rows = await db
    .select({
      id: sm.id,
      folderPath: sm.folderPath,
      thumbnailPath: sm.thumbnailPath,
      backedUpAt: sm.backedUpAt,
      thumbnailBackedUpAt: sm.thumbnailBackedUpAt,
    })
    .from(sm)
    .where(or(isNull(sm.backedUpAt), and(isNotNull(sm.thumbnailPath), isNull(sm.thumbnailBackedUpAt))))
    .orderBy(asc(sm.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    folderPath: r.folderPath,
    thumbnailPath: r.thumbnailPath,
    needsMain: r.backedUpAt == null,
    needsThumbnail: r.thumbnailPath != null && r.thumbnailBackedUpAt == null,
  }));
}

/** Note-attachment rows needing backup (backedUpAt IS NULL), ordered by createdAt. */
export async function selectUnbackedAttachments(
  db: TenantDB,
  limit: number,
): Promise<UnbackedAttachment[]> {
  const na = tenantTables.noteAttachments;
  const rows = await db
    .select({ id: na.id, storageKey: na.storageKey })
    .from(na)
    .where(isNull(na.backedUpAt))
    .orderBy(asc(na.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, storageKey: r.storageKey }));
}

/** Mark a document's MAIN object as backed up — call only after a confirmed upload. */
export async function markDocumentMainBackedUp(
  db: TenantDB,
  id: string,
  now: number,
): Promise<void> {
  await db
    .update(tenantTables.storageMetadata)
    .set({ backedUpAt: now })
    .where(eq(tenantTables.storageMetadata.id, id));
}

/** Mark a document's THUMBNAIL as backed up — independent of the main object. */
export async function markDocumentThumbnailBackedUp(
  db: TenantDB,
  id: string,
  now: number,
): Promise<void> {
  await db
    .update(tenantTables.storageMetadata)
    .set({ thumbnailBackedUpAt: now })
    .where(eq(tenantTables.storageMetadata.id, id));
}

/** Mark a note attachment as backed up — call only after a confirmed upload. */
export async function markAttachmentBackedUp(
  db: TenantDB,
  id: string,
  now: number,
): Promise<void> {
  await db
    .update(tenantTables.noteAttachments)
    .set({ backedUpAt: now })
    .where(eq(tenantTables.noteAttachments.id, id));
}
