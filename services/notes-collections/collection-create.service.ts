/**
 * @file services/notes-collections/collection-create.service.ts
 * @description Collection Create service (notes collections)
 */
import { getTenantDB, tenantTables } from "@db/index.ts";
import { generateIdForNoteCollection, generateIdRandom } from "@utils/database/id-generation/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";
import type { INoteCollectionCreateRequest, INoteCollectionResponse } from "@models/notes/note-collection.model.ts";
import { CollectionCrudHelpers } from "./collection-crud.helpers.ts";
import { getCollectionReadService } from "./singletons.ts";

export class CollectionCreateService {
  private helpers = new CollectionCrudHelpers();

  async create(
    input: INoteCollectionCreateRequest,
    userId: string,
    environmentId: string,
  ): Promise<INoteCollectionResponse> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.create",
      {
        service: "NoteCollection",
        method: "create",
        section: loggerAppSections.NOTES,
        details: { userId, environmentId },
      },
      "NOTE_COLLECTION.CREATE_FAILED",
      async (span) => {
        span.attributes["user.id"] = userId;
        const db = await getTenantDB();
        const now = getTimeNowForStorage();
        const id = await traced("db.collection.insert", "db.query", async (s) => {
          return await databaseCreateWithRetry(async (newId) => {
            s.attributes["collection.id"] = newId;
            await db.insert(tenantTables.noteCollections).values({
              id: newId,
              ownerId: userId,
              name: input.name,
              description: input.description ?? null,
              icon: input.icon ?? null,
              color: input.color ?? null,
              metadata: input.metadata ?? null,
              autoShareNewContent: input.autoShareNewContent ?? false,
              createdAt: now,
              updatedAt: now,
            });
            await db.insert(tenantTables.noteCollectionsSharedUsers).values({
              id: generateIdRandom(21),
              collectionId: newId,
              userId,
              permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
              isActive: true,
              grantedById: userId,
              grantedByName: null,
              grantedAt: now,
              createdAt: now,
              updatedAt: now,
            });
            return newId;
          }, generateIdForNoteCollection);
        });
        span.attributes["collection.id"] = id;
        const row = await getCollectionReadService().findById(id, userId, environmentId);
        if (!row) throwHttpError("NOTE_COLLECTION.INTERNAL_SERVER_ERROR");
        return row!;
      },
    );
  }
}
