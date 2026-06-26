/**
 * @file services/notes-attachments/note-attachment.service.ts
 * @description Note attachment service. Owns the lifecycle of attachments
 * (upload, list, stream, delete) and the per-attachment data-key wrap.
 *
 * Encryption notes (Slice 7):
 * - Each attachment gets a fresh 32-byte symmetric "attachment master key"
 *   that is wrapped with the caller's data master key via useSymmetricEncrypt.
 * - The wrap is stored in `note_attachments_data_keys.encrypted_master_key`.
 * - Share propagation re-wraps the per-attachment key for each recipient,
 *   dispatching on encryption mode:
 *     - APP_CONTROLLED → byte-copy via EncryptionSharingService.shareAppEncrypted.
 *     - USER_CONTROLLED → ECIES re-wrap via shareUserEncrypted, using the
 *       owner's user master key threaded through from NoteSharingService.
 *       If the owner key is not provided (legacy/non-context callers) the
 *       propagation is skipped with a logged warning rather than tearing
 *       down the share.
 * - Bytes-on-the-wire are encrypted server-side under the per-attachment
 *   master key using AES-GCM with a fresh 12-byte IV prefixed to the
 *   ciphertext (`useSymmetricEncrypt` with the default `includeNonce: true`).
 *   The `note_attachments.iv_blob` column is therefore unused for new
 *   uploads — it remains for potential future client-supplied IVs (and as
 *   a backwards-compat carrier); dropping it is a follow-up.
 * - Buffer-once decryption: with MAX_BYTES = 25MB it is acceptable to
 *   buffer the entire ciphertext into memory before decrypting. Streaming
 *   AES-GCM (chunked) is documented for documents (StreamProcessorService)
 *   and is out of scope here.
 */

import { getTenantDB, requestContext, tenantTables } from "@db/index.ts";
import { buildBackupTombstoneRows } from "@services/object-backup/tombstone.ts";
import { completeStoragePathForNoteAttachment } from "@constants/storage-paths.ts";
import { and, eq, inArray, sql } from "@deps";
import { throwHttpError } from "@utils/http-exception.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { EncryptionSharingService } from "@services/encryption/encryption-sharing.service.ts";
import { getNotePermissionService } from "@services/notes-permission/singletons.ts";
import { getNoteAttachmentPermissionService } from "@services/notes-attachments/singletons.ts";
import { getStorage } from "@services/storage/index.ts";
import { generateIdForStorage } from "@utils/database/id-generation/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

const MAX_BYTES = 25 * 1024 * 1024;

const ATTACHMENTS_TABLE_CONFIG = {
  tableName: tenantTables.noteAttachmentsDataKeys,
  resourceIdColumn: "noteAttachmentId",
} as const;

/**
 * Buffer a ReadableStream<Uint8Array> into a single Uint8Array.
 *
 * Used by streamContent to load the entire encrypted attachment object so
 * AES-GCM can decrypt it in one shot. With MAX_BYTES = 25MB this is fine;
 * if MAX_BYTES grows substantially this should be replaced with a chunked
 * AES-GCM scheme (see StreamProcessorService for the documents pattern).
 */
async function bufferReadableStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore — the reader may already be released
    }
  }
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export interface INoteAttachment {
  id: string;
  noteId: string;
  ownerId: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: number;
}

export interface IUploadInput {
  noteId: string;
  mimeType: string;
  originalName: string;
  bytes: Uint8Array;
  iv?: Uint8Array;
}

export class NoteAttachmentService {
  private encSharing = new EncryptionSharingService(ATTACHMENTS_TABLE_CONFIG);

  private get notePerm() {
    return getNotePermissionService();
  }
  private get attPerm() {
    return getNoteAttachmentPermissionService();
  }

  /**
   * Upload an attachment. Wraps a fresh per-attachment master key with the
   * caller's data master key and stores the wrap in the data-key row.
   *
   * The attachment bytes are encrypted server-side under the per-attachment
   * master key (useSymmetricEncrypt with a fresh IV); the stored object holds
   * the resulting ciphertext blob, which streamContent reverses on read.
   */
  async upload(
    input: IUploadInput,
    userId: string,
    userMasterKey: Uint8Array,
    encryptionMode: DB_ENUM_ENCRYPTION_MODE = DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED,
  ): Promise<INoteAttachment> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.upload",
      {
        service: "NoteAttachment",
        method: "upload",
        section: loggerAppSections.NOTES,
        details: {
          noteId: input.noteId,
          userId,
          mimeType: input.mimeType,
          sizeBytes: input.bytes.byteLength,
        },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = input.noteId;
        span.attributes["user.id"] = userId;

        if (!ALLOWED_MIME.has(input.mimeType)) {
          throwHttpError("COMMON.UNSUPPORTED_MEDIA_TYPE");
        }
        if (input.bytes.byteLength > MAX_BYTES) {
          throwHttpError("COMMON.TOO_LARGE");
        }
        const allowed = await this.notePerm.checkAccess(
          input.noteId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
        );
        if (!allowed) throwHttpError("COMMON.NOT_FOUND");

        const environmentId = requestContext.getStore()?.environmentId;
        if (!environmentId) throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
        const now = getTimeNowForStorage();

        // Generate per-attachment master key and wrap it with the user's data master key.
        const attachmentMasterKey = crypto.getRandomValues(new Uint8Array(32));
        const wrappedAttachmentMasterKey = await useSymmetricEncrypt({
          key: userMasterKey,
          data: attachmentMasterKey,
        });

        // Server-side bytes encryption: encrypt the plaintext bytes under the
        // per-attachment master key with a fresh 12-byte IV that is prefixed
        // to the ciphertext. The storage object is the ciphertext blob;
        // streamContent reverses this.
        const encryptedBytes = await useSymmetricEncrypt({
          key: attachmentMasterKey,
          data: input.bytes,
        });

        const db = await getTenantDB();
        const id = await traced("db.attachment.insert", "db.query", async (s) => {
          return await databaseCreateWithRetry(async (newId) => {
            const storageKey = completeStoragePathForNoteAttachment(environmentId!, newId, input.mimeType);
            s.attributes["attachment.id"] = newId;
            try {
              await traced("storage.uploadFile", "storage", async (st) => {
                st.attributes["storage.key"] = storageKey;
                await getStorage().uploadFile(storageKey, encryptedBytes);
              });
            } finally {
              attachmentMasterKey.fill(0);
            }
            await db.transaction(async (tx) => {
              await tx.insert(tenantTables.noteAttachments).values({
                id: newId,
                noteId: input.noteId,
                ownerId: userId,
                mimeType: input.mimeType,
                originalName: input.originalName,
                sizeBytes: input.bytes.byteLength,
                storageKey,
                ivBlob: input.iv ?? null,
                createdAt: now,
              });
              await tx.insert(tenantTables.noteAttachmentsDataKeys).values({
                id: generateIdRandom(21),
                noteAttachmentId: newId,
                userId,
                encryptedMasterKey: wrappedAttachmentMasterKey,
                encryptionMode,
                permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
                isActive: true,
                grantedBy: userId,
                grantedAt: now,
                createdAt: now,
                updatedAt: now,
              });
            });
            return newId;
          }, generateIdForStorage);
        });
        span.attributes["attachment.id"] = id;

        const fetched = await this.findById(id, userId);
        if (!fetched) throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
        return fetched!;
      },
    );
  }

  async findById(id: string, userId: string): Promise<INoteAttachment | null> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.findById",
      {
        service: "NoteAttachment",
        method: "findById",
        section: loggerAppSections.NOTES,
        details: { id, userId },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["attachment.id"] = id;
        span.attributes["user.id"] = userId;

        const allowed = await this.attPerm.checkAccess(
          id,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );
        if (!allowed) return null;
        const rows = await traced("db.attachment.findById", "db.query", async () => {
          const db = await getTenantDB();
          return await db
            .select()
            .from(tenantTables.noteAttachments)
            .where(eq(tenantTables.noteAttachments.id, id))
            .limit(1);
        });
        return rows[0] ? (rows[0] as INoteAttachment) : null;
      },
    );
  }

  async listForNote(noteId: string, userId: string): Promise<INoteAttachment[]> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.listForNote",
      {
        service: "NoteAttachment",
        method: "listForNote",
        section: loggerAppSections.NOTES,
        details: { noteId, userId },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;

        const allowed = await this.notePerm.checkAccess(
          noteId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );
        if (!allowed) throwHttpError("COMMON.NOT_FOUND");
        const rows = await traced("db.attachment.listForNote", "db.query", async () => {
          const db = await getTenantDB();
          return await db
            .select()
            .from(tenantTables.noteAttachments)
            .where(eq(tenantTables.noteAttachments.noteId, noteId));
        });
        return rows as INoteAttachment[];
      },
    );
  }

  /**
   * List all attachments owned by the authenticated user, across all their notes.
   * Used by the Settings UI to show the user's complete attachment inventory.
   *
   * Access control: filtering by ownerId (the authenticated userId) is sufficient —
   * users can only see their own attachments. No additional permission check needed.
   */
  async listAllForOwner(userId: string): Promise<INoteAttachment[]> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.listAllForOwner",
      {
        service: "NoteAttachment",
        method: "listAllForOwner",
        section: loggerAppSections.NOTES,
        details: { userId },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user.id"] = userId;

        const rows = await traced("db.attachment.listAllForOwner", "db.query", async () => {
          const db = await getTenantDB();
          return await db
            .select()
            .from(tenantTables.noteAttachments)
            .where(eq(tenantTables.noteAttachments.ownerId, userId));
        });

        return rows as INoteAttachment[];
      },
    );
  }

  /**
   * Aggregate attachment stats for a user, split by whether the parent note
   * is archived. Returns { active, archived, total } — each bucket has
   * { count, totalBytes }.
   *
   * Access control: same reasoning as listAllForOwner — filtering by
   * ownerId (the authenticated userId) is sufficient.
   */
  async statsForOwner(userId: string): Promise<{
    active: { count: number; totalBytes: number };
    archived: { count: number; totalBytes: number };
    total: { count: number; totalBytes: number };
  }> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.statsForOwner",
      {
        service: "NoteAttachment",
        method: "statsForOwner",
        section: loggerAppSections.NOTES,
        details: { userId },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user.id"] = userId;

        const [result] = await traced("db.attachment.stats", "db.query", async () => {
          const db = await getTenantDB();
          return await db
            .select({
              activeCount: sql<number>`COUNT(*) FILTER (WHERE ${tenantTables.notes.isArchived} = false)`,
              activeBytes: sql<
                number
              >`COALESCE(SUM(${tenantTables.noteAttachments.sizeBytes}) FILTER (WHERE ${tenantTables.notes.isArchived} = false), 0)`,
              archivedCount: sql<number>`COUNT(*) FILTER (WHERE ${tenantTables.notes.isArchived} = true)`,
              archivedBytes: sql<
                number
              >`COALESCE(SUM(${tenantTables.noteAttachments.sizeBytes}) FILTER (WHERE ${tenantTables.notes.isArchived} = true), 0)`,
              totalCount: sql<number>`COUNT(*)`,
              totalBytes: sql<number>`COALESCE(SUM(${tenantTables.noteAttachments.sizeBytes}), 0)`,
            })
            .from(tenantTables.noteAttachments)
            .innerJoin(tenantTables.notes, eq(tenantTables.noteAttachments.noteId, tenantTables.notes.id))
            .where(eq(tenantTables.noteAttachments.ownerId, userId));
        });

        span.attributes["attachment.active_count"] = Number(result?.activeCount ?? 0);
        span.attributes["attachment.archived_count"] = Number(result?.archivedCount ?? 0);

        return {
          active: {
            count: Number(result?.activeCount ?? 0),
            totalBytes: Number(result?.activeBytes ?? 0),
          },
          archived: {
            count: Number(result?.archivedCount ?? 0),
            totalBytes: Number(result?.archivedBytes ?? 0),
          },
          total: {
            count: Number(result?.totalCount ?? 0),
            totalBytes: Number(result?.totalBytes ?? 0),
          },
        };
      },
    );
  }

  async streamContent(
    id: string,
    userId: string,
    userMasterKey: Uint8Array,
  ): Promise<{
    attachment: INoteAttachment;
    stream: ReadableStream<Uint8Array>;
    contentLength?: number;
  }> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.streamContent",
      {
        service: "NoteAttachment",
        method: "streamContent",
        section: loggerAppSections.NOTES,
        details: { id, userId },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["attachment.id"] = id;
        span.attributes["user.id"] = userId;

        const att = await this.findById(id, userId);
        if (!att) throwHttpError("COMMON.NOT_FOUND");

        // Look up the caller's data-key row and unwrap the per-attachment
        // master key with their user master key.
        const dataKeyRow = await traced("db.attachmentDataKey.fetchForUser", "db.query", async () => {
          const db = await getTenantDB();
          const [row] = await db
            .select({ encryptedMasterKey: tenantTables.noteAttachmentsDataKeys.encryptedMasterKey })
            .from(tenantTables.noteAttachmentsDataKeys)
            .where(
              and(
                eq(tenantTables.noteAttachmentsDataKeys.noteAttachmentId, id),
                eq(tenantTables.noteAttachmentsDataKeys.userId, userId),
                eq(tenantTables.noteAttachmentsDataKeys.isActive, true),
              ),
            )
            .limit(1);
          return row;
        });
        if (!dataKeyRow?.encryptedMasterKey) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Buffer the encrypted bytes from storage. With MAX_BYTES = 25MB this
        // is acceptable; streaming AES-GCM is out of scope here.
        const dl = await traced("storage.downloadFile", "storage", async (s) => {
          s.attributes["storage.key"] = att!.storageKey;
          return await getStorage().downloadFile(att!.storageKey);
        });
        const encryptedBytes = await bufferReadableStream(dl.stream);

        // Unwrap the per-attachment master key, decrypt, then zero the key.
        const attachmentMasterKey = await useSymmetricDecrypt({
          key: userMasterKey,
          data: dataKeyRow.encryptedMasterKey as Uint8Array,
        });
        let plaintextBytes: Uint8Array;
        try {
          plaintextBytes = await useSymmetricDecrypt({
            key: attachmentMasterKey,
            data: encryptedBytes,
          });
        } finally {
          attachmentMasterKey.fill(0);
        }

        // The decrypted plaintext goes out via a single-chunk ReadableStream.
        // We can't zero the buffer once it's been handed to the consumer.
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(plaintextBytes);
            controller.close();
          },
        });
        return {
          attachment: att!,
          stream,
          contentLength: plaintextBytes.byteLength,
        };
      },
    );
  }

  async delete(id: string, userId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.delete",
      {
        service: "NoteAttachment",
        method: "delete",
        section: loggerAppSections.NOTES,
        details: { id, userId },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["attachment.id"] = id;
        span.attributes["user.id"] = userId;

        const rows = await traced("db.attachment.findOwner", "db.query", async () => {
          const db = await getTenantDB();
          return await db
            .select({
              ownerId: tenantTables.noteAttachments.ownerId,
              storageKey: tenantTables.noteAttachments.storageKey,
            })
            .from(tenantTables.noteAttachments)
            .where(eq(tenantTables.noteAttachments.id, id))
            .limit(1);
        });
        if (!rows[0]) throwHttpError("COMMON.NOT_FOUND");
        if (rows[0]!.ownerId !== userId) throwHttpError("COMMON.NOT_FOUND");

        try {
          await traced("storage.deleteFile", "storage", async (s) => {
            s.attributes["storage.key"] = rows[0]!.storageKey;
            await getStorage().deleteFile(rows[0]!.storageKey);
          });
        } catch (err) {
          // Best-effort: storage object may already be gone.
          await useLogger(LoggerLevels.warn, {
            message: "Failed to delete attachment storage object (best-effort)",
            section: loggerAppSections.NOTES,
            messageKey: "note_attachment.storage_delete_failed",
            details: {
              attachmentId: id,
              storageKey: rows[0]!.storageKey,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
        await traced("db.attachment.delete", "db.query", async () => {
          const db = await getTenantDB();
          const now = Math.floor(Date.now() / 1000);
          await db.transaction(async (tx) => {
            // Enqueue the backup-purge tombstone in the same tx as the row
            // delete (DD4 transactional outbox) — capture the key BEFORE the
            // row is gone (noteAttachments rows cascade-delete on note delete).
            await tx
              .insert(tenantTables.backupDeletionQueue)
              .values(buildBackupTombstoneRows([rows[0]!.storageKey], now));
            await tx
              .delete(tenantTables.noteAttachments)
              .where(eq(tenantTables.noteAttachments.id, id));
          });
        });
      },
    );
  }

  /**
   * Cleanup attachments belonging to a note (used by NoteDeleteService.delete).
   * Removes storage objects then deletes rows; FK cascade handles data-key rows.
   */
  async deleteAllForNote(noteId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.deleteAllForNote",
      {
        service: "NoteAttachment",
        method: "deleteAllForNote",
        section: loggerAppSections.NOTES,
        details: { noteId },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;

        const rows = await traced("db.attachment.listForCleanup", "db.query", async () => {
          const db = await getTenantDB();
          return await db
            .select({
              id: tenantTables.noteAttachments.id,
              storageKey: tenantTables.noteAttachments.storageKey,
            })
            .from(tenantTables.noteAttachments)
            .where(eq(tenantTables.noteAttachments.noteId, noteId));
        });
        for (const r of rows) {
          try {
            await traced("storage.deleteFile", "storage", async (s) => {
              s.attributes["storage.key"] = r.storageKey;
              await getStorage().deleteFile(r.storageKey);
            });
          } catch (err) {
            // Best-effort.
            await useLogger(LoggerLevels.warn, {
              message: "Failed to delete attachment storage object during note cleanup (best-effort)",
              section: loggerAppSections.NOTES,
              messageKey: "note_attachment.storage_delete_failed_cleanup",
              details: {
                noteId,
                attachmentId: r.id,
                storageKey: r.storageKey,
                error: err instanceof Error ? err.message : String(err),
              },
            });
          }
        }
        if (rows.length > 0) {
          await traced("db.attachment.deleteAll", "db.query", async () => {
            const db = await getTenantDB();
            const now = Math.floor(Date.now() / 1000);
            await db.transaction(async (tx) => {
              // Enqueue a tombstone per attachment key (DD4), in-tx with the
              // row delete. Keys were captured above before any cascade.
              await tx
                .insert(tenantTables.backupDeletionQueue)
                .values(buildBackupTombstoneRows(rows.map((r) => r.storageKey), now));
              await tx
                .delete(tenantTables.noteAttachments)
                .where(inArray(tenantTables.noteAttachments.id, rows.map((r) => r.id)));
            });
          });
        }
      },
    );
  }

  /**
   * Mirror an attachment's data-key row to a recipient user.
   *
   * Dispatches on the owner row's encryption mode:
   * - APP_CONTROLLED → delegates to EncryptionSharingService.shareAppEncrypted,
   *   which copies the wrapped key bytes verbatim (the same app key wraps
   *   the value for both users).
   * - USER_CONTROLLED → delegates to EncryptionSharingService.shareUserEncrypted,
   *   which decrypts the owner's wrapped attachment key with the owner's
   *   user master key and re-wraps it under the recipient's ECIES public key.
   *   Requires `ownerUserMasterKey` to be passed through. If it's missing the
   *   call is skipped with a logged warning (so legacy/non-context callers
   *   don't tear down the share).
   *
   * If the recipient already has an active row, this is a no-op.
   */
  async propagateKeyToUser(
    attachmentId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.propagateKeyToUser",
      {
        service: "NoteAttachment",
        method: "propagateKeyToUser",
        section: loggerAppSections.NOTES,
        details: { attachmentId, fromUserId, toUserId, permissionLevel },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["attachment.id"] = attachmentId;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = toUserId;

        // Short-circuit if recipient already has an active row.
        const existing = await traced("db.attachmentDataKey.existsForUser", "db.query", async () => {
          const db = await getTenantDB();
          return await db
            .select({ id: tenantTables.noteAttachmentsDataKeys.id })
            .from(tenantTables.noteAttachmentsDataKeys)
            .where(
              and(
                eq(tenantTables.noteAttachmentsDataKeys.noteAttachmentId, attachmentId),
                eq(tenantTables.noteAttachmentsDataKeys.userId, toUserId),
                eq(tenantTables.noteAttachmentsDataKeys.isActive, true),
              ),
            )
            .limit(1);
        });
        if (existing[0]) return;

        // Dispatch based on the owner's row mode.
        const ownerMode = await traced("db.attachmentDataKey.ownerMode", "db.query", async () => {
          const db = await getTenantDB();
          const [row] = await db
            .select({ encryptionMode: tenantTables.noteAttachmentsDataKeys.encryptionMode })
            .from(tenantTables.noteAttachmentsDataKeys)
            .where(
              and(
                eq(tenantTables.noteAttachmentsDataKeys.noteAttachmentId, attachmentId),
                eq(tenantTables.noteAttachmentsDataKeys.userId, fromUserId),
                eq(tenantTables.noteAttachmentsDataKeys.isActive, true),
              ),
            )
            .limit(1);
          return row?.encryptionMode;
        });
        if (ownerMode === undefined) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        if (ownerMode === DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED) {
          await this.encSharing.shareAppEncrypted(
            attachmentId,
            fromUserId,
            toUserId,
            permissionLevel,
          );
          return;
        }

        if (ownerMode === DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED) {
          if (!ownerUserMasterKey) {
            // No owner key threaded through — skip this attachment with a
            // logged warning rather than tearing down the share. Callers
            // that go through NoteSharingService.shareWithUser DO pass the
            // owner key now, so this branch is only hit for legacy paths.
            await useLogger(LoggerLevels.warn, {
              message: "Skipping attachment-key propagation: owner is USER_CONTROLLED but no master key was provided to this layer",
              section: loggerAppSections.NOTES,
              messageKey: "note_attachment.propagate_skipped_missing_owner_key",
              details: { attachmentId, fromUserId, toUserId, ownerMode },
            });
            return;
          }
          await this.encSharing.shareUserEncrypted(
            attachmentId,
            fromUserId,
            toUserId,
            permissionLevel,
            ownerUserMasterKey,
          );
          return;
        }

        // Any other owner mode (e.g. PUBLIC_*) is not a valid owner-row
        // encryption mode for an attachment data key — surface as NOT_FOUND.
        await useLogger(LoggerLevels.warn, {
          message: "Skipping attachment-key propagation: unsupported owner encryption mode",
          section: loggerAppSections.NOTES,
          messageKey: "note_attachment.propagate_skipped_unsupported_mode",
          details: { attachmentId, fromUserId, toUserId, ownerMode },
        });
        throwHttpError("COMMON.NOT_FOUND");
      },
    );
  }

  /**
   * Propagate ALL attachments of a note to a user. Called by
   * NoteSharingService.shareWithUser. Dispatches per-attachment based on
   * the owner row's encryption mode (see propagateKeyToUser).
   *
   * `ownerUserMasterKey` is forwarded to each per-attachment call so that
   * USER_CONTROLLED attachments can be re-wrapped under the recipient's
   * ECIES public key. If it's not supplied the USER_CONTROLLED branch
   * skips with a logged warning rather than tearing down the share.
   */
  async propagateNoteAttachmentsToUser(
    noteId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<number> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachment.propagateNoteAttachmentsToUser",
      {
        service: "NoteAttachment",
        method: "propagateNoteAttachmentsToUser",
        section: loggerAppSections.NOTES,
        details: { noteId, fromUserId, toUserId, permissionLevel },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = toUserId;

        const rows = await traced("db.attachment.listForPropagate", "db.query", async () => {
          const db = await getTenantDB();
          return await db
            .select({ id: tenantTables.noteAttachments.id })
            .from(tenantTables.noteAttachments)
            .where(eq(tenantTables.noteAttachments.noteId, noteId));
        });
        let propagated = 0;
        for (const r of rows) {
          try {
            await this.propagateKeyToUser(
              r.id,
              fromUserId,
              toUserId,
              permissionLevel,
              ownerUserMasterKey,
            );
            propagated++;
          } catch (err) {
            // For unsupported owner modes (and any sub-call failure) the
            // per-attachment propagate throws; surface as a logged skip
            // rather than tearing down the entire share.
            await useLogger(LoggerLevels.warn, {
              message: "Skipped attachment during note share propagation",
              section: loggerAppSections.NOTES,
              messageKey: "note_attachment.propagate_skipped",
              details: {
                noteId,
                attachmentId: r.id,
                fromUserId,
                toUserId,
                error: err instanceof Error ? err.message : String(err),
              },
            });
          }
        }
        span.attributes["attachments.propagated"] = propagated;
        return propagated;
      },
    );
  }
}
