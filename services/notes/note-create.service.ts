/**
 * @file services/notes/note-create.service.ts
 * @description Note Create service (notes)
 */
import { and, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { generateIdForNote, generateIdRandom } from "@utils/database/id-generation/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";
import { fireAndForgetOperation, getTimeNowForStorage } from "@utils/shared/index.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { DataEncryptionHelperService } from "@services/encryption/index.ts";
import { getNoteEncryptionService } from "./singletons.ts";
import type { INoteCreateRequest } from "@models/notes/note.model.ts";

export class NoteCreateService {
  async createNote(
    userId: string,
    environmentId: string,
    encryptionKey: Uint8Array,
    encryptionMode: DB_ENUM_ENCRYPTION_MODE,
    input: INoteCreateRequest,
  ): Promise<typeof tenantTables.notes.$inferSelect> {
    return await tracedWithServiceErrorHandling(
      "NoteCreate.createNote",
      {
        service: "NoteCreate",
        method: "createNote",
        section: loggerAppSections.NOTES,
        details: { userId, environmentId, collectionId: input.collectionId ?? null },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user.id"] = userId;
        span.attributes["note.has_collection"] = !!input.collectionId;

        const autoShareTargets = await this.resolveCollectionAndAutoShare(
          input.collectionId ?? null,
          userId,
        );

        const noteMasterKey = DataEncryptionHelperService.generateDataMasterKey();
        const wrappedNoteMasterKey = await useSymmetricEncrypt({
          key: encryptionKey,
          data: noteMasterKey,
        });

        // 3. Insert note + owner data-key row in a single transaction.
        const now = getTimeNowForStorage();
        const db = await getTenantDB();

        const id = await traced("db.note.insert", "db.query", async (s) => {
          return await databaseCreateWithRetry(async (newId) => {
            s.attributes["note.id"] = newId;
            await db.transaction(async (tx) => {
              await tx.insert(tenantTables.notes).values({
                id: newId,
                ownerId: userId,
                collectionId: input.collectionId ?? null,
                title: input.title,
                metadata: input.metadata ?? null,
                createdAt: now,
                updatedAt: now,
              });
              await tx.insert(tenantTables.notesDataKeys).values({
                id: generateIdRandom(21),
                noteId: newId,
                userId,
                encryptedMasterKey: wrappedNoteMasterKey,
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
          }, generateIdForNote);
        });

        // The wrapped copy is now persisted; the cleartext per-note master key is no
        // longer needed in this request. Zero its bytes to shorten the window in
        // which the key is recoverable from heap snapshots.
        noteMasterKey.fill(0);

        // 4. Auto-share targets — re-wrapped via the encryption sharing service.
        if (autoShareTargets.length > 0) {
          fireAndForgetOperation("note-create-sharing-auto-inheritence-from-collection", async () => {
            const encSharing = getNoteEncryptionService();
            for (const target of autoShareTargets) {
              if (encryptionMode === DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED) {
                await encSharing.shareAppEncrypted(
                  id,
                  userId,
                  target.userId,
                  target.permissionLevel,
                );
              } else {
                await encSharing.shareUserEncrypted(
                  id,
                  userId,
                  target.userId,
                  target.permissionLevel,
                  encryptionKey,
                );
              }
            }
          });
        }

        // 5. Read the row back and return the response shape.
        const row = await traced("db.note.readBack", "db.query", async () => {
          const rows = await db
            .select()
            .from(tenantTables.notes)
            .where(eq(tenantTables.notes.id, id))
            .limit(1);
          return rows[0]!;
        });

        return row;
      },
    );
  }

  private async resolveCollectionAndAutoShare(
    collectionId: string | null,
    userId: string,
  ): Promise<{ userId: string; permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL; grantedById: string }[]> {
    if (!collectionId) return [];
    const db = await getTenantDB();

    const col = await traced("db.collection.read", "db.query", async () => {
      return await db
        .select({
          ownerId: tenantTables.noteCollections.ownerId,
          autoShareNewContent: tenantTables.noteCollections.autoShareNewContent,
        })
        .from(tenantTables.noteCollections)
        .where(eq(tenantTables.noteCollections.id, collectionId))
        .limit(1);
    });

    if (!col[0] || col[0].ownerId !== userId) {
      throwHttpError("COMMON.NOT_FOUND");
    }
    if (!col[0]!.autoShareNewContent) return [];

    const sharedRows = await traced("db.collection.autoShareTargets", "db.query", async () => {
      return await db
        .select({
          userId: tenantTables.noteCollectionsSharedUsers.userId,
          permissionLevel: tenantTables.noteCollectionsSharedUsers.permissionLevel,
          grantedById: tenantTables.noteCollectionsSharedUsers.grantedById,
        })
        .from(tenantTables.noteCollectionsSharedUsers)
        .where(
          and(
            eq(tenantTables.noteCollectionsSharedUsers.collectionId, collectionId),
            eq(tenantTables.noteCollectionsSharedUsers.isActive, true),
          ),
        );
    });

    return sharedRows
      .filter((r) => r.userId && r.userId !== userId)
      .map((r) => ({
        userId: r.userId as string,
        permissionLevel: r.permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
        grantedById: r.grantedById,
      }));
  }
}
