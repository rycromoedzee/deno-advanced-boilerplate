/**
 * @file services/notes-collections/collection-sharing.service.ts
 * @description Collection Sharing service (notes collections)
 */
import { getTenantDB, tenantTables } from "@db/index.ts";
import { and, eq } from "@deps";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";
import { CollectionCrudHelpers } from "./collection-crud.helpers.ts";

export class CollectionSharingService {
  private helpers = new CollectionCrudHelpers();

  async shareWithUser(
    collectionId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.shareWithUser",
      {
        service: "NoteCollection",
        method: "shareWithUser",
        section: loggerAppSections.NOTES,
        details: { collectionId, fromUserId, toUserId, permissionLevel },
      },
      "NOTE_COLLECTION.SHARE_FAILED",
      async (span) => {
        span.attributes["collection.id"] = collectionId;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = toUserId;
        await this.helpers.requireOwner(collectionId, fromUserId);
        const db = await getTenantDB();
        const now = getTimeNowForStorage();
        const existing = await traced("db.collection.findShareRow", "db.query", async () => {
          return await db
            .select({ id: tenantTables.noteCollectionsSharedUsers.id })
            .from(tenantTables.noteCollectionsSharedUsers)
            .where(
              and(
                eq(tenantTables.noteCollectionsSharedUsers.collectionId, collectionId),
                eq(tenantTables.noteCollectionsSharedUsers.userId, toUserId),
              ),
            )
            .limit(1);
        });
        if (existing[0]) {
          await traced("db.collection.updateShareRow", "db.query", async () => {
            await db
              .update(tenantTables.noteCollectionsSharedUsers)
              .set({ permissionLevel, isActive: true, updatedAt: now })
              .where(eq(tenantTables.noteCollectionsSharedUsers.id, existing[0]!.id));
          });
          return;
        }
        await traced("db.collection.insertShareRow", "db.query", async () => {
          await databaseCreateWithRetry(async (newId) => {
            await db.insert(tenantTables.noteCollectionsSharedUsers).values({
              id: newId,
              collectionId,
              userId: toUserId,
              permissionLevel,
              isActive: true,
              grantedById: fromUserId,
              grantedByName: null,
              grantedAt: now,
              createdAt: now,
              updatedAt: now,
            });
            return newId;
          }, () => generateIdRandom(21));
        });
      },
    );
  }

  async revokeUserAccess(
    collectionId: string,
    fromUserId: string,
    targetUserId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.revokeUserAccess",
      {
        service: "NoteCollection",
        method: "revokeUserAccess",
        section: loggerAppSections.NOTES,
        details: { collectionId, fromUserId, targetUserId },
      },
      "NOTE_COLLECTION.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["collection.id"] = collectionId;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = targetUserId;
        await this.helpers.requireOwner(collectionId, fromUserId);
        const db = await getTenantDB();
        const now = getTimeNowForStorage();
        const result = await traced("db.collection.revokeAccess", "db.query", async () => {
          return await db
            .update(tenantTables.noteCollectionsSharedUsers)
            .set({ isActive: false, updatedAt: now })
            .where(
              and(
                eq(tenantTables.noteCollectionsSharedUsers.collectionId, collectionId),
                eq(tenantTables.noteCollectionsSharedUsers.userId, targetUserId),
                eq(tenantTables.noteCollectionsSharedUsers.isActive, true),
              ),
            )
            .returning({ id: tenantTables.noteCollectionsSharedUsers.id });
        });
        if (!result.length) throwHttpError("NOTE_COLLECTION.NOT_FOUND");
      },
    );
  }

  async listSharedUsers(collectionId: string, requesterId: string) {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.listSharedUsers",
      {
        service: "NoteCollection",
        method: "listSharedUsers",
        section: loggerAppSections.NOTES,
        details: { collectionId, requesterId },
      },
      "NOTE_COLLECTION.FETCH_FAILED",
      async (span) => {
        span.attributes["collection.id"] = collectionId;
        span.attributes["user.id"] = requesterId;
        await this.helpers.requireOwner(collectionId, requesterId);
        const db = await getTenantDB();
        const rows = await traced("db.collection.listSharedUsers", "db.query", async () => {
          return await db
            .select({
              userId: tenantTables.noteCollectionsSharedUsers.userId,
              permissionLevel: tenantTables.noteCollectionsSharedUsers.permissionLevel,
              grantedAt: tenantTables.noteCollectionsSharedUsers.grantedAt,
              grantedById: tenantTables.noteCollectionsSharedUsers.grantedById,
              grantedByName: tenantTables.noteCollectionsSharedUsers.grantedByName,
            })
            .from(tenantTables.noteCollectionsSharedUsers)
            .where(
              and(
                eq(tenantTables.noteCollectionsSharedUsers.collectionId, collectionId),
                eq(tenantTables.noteCollectionsSharedUsers.isActive, true),
              ),
            );
        });
        return rows.filter((r) => r.userId !== requesterId);
      },
    );
  }
}
