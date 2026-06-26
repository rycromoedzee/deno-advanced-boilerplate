/**
 * @file services/notes-collections/collection-update.service.ts
 * @description Collection Update service (notes collections)
 */
import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq } from "@deps";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import type { INoteCollectionResponse, INoteCollectionUpdateRequest } from "@models/notes/note-collection.model.ts";
import { CollectionCrudHelpers } from "./collection-crud.helpers.ts";
import { getCollectionReadService } from "./singletons.ts";

export class CollectionUpdateService {
  private helpers = new CollectionCrudHelpers();

  async update(
    id: string,
    patch: INoteCollectionUpdateRequest,
    userId: string,
    environmentId: string,
  ): Promise<INoteCollectionResponse> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.update",
      {
        service: "NoteCollection",
        method: "update",
        section: loggerAppSections.NOTES,
        details: { id, userId, environmentId },
      },
      "NOTE_COLLECTION.UPDATE_FAILED",
      async (span) => {
        span.attributes["collection.id"] = id;
        span.attributes["user.id"] = userId;
        await this.helpers.requireOwner(id, userId);
        const db = await getTenantDB();
        const now = getTimeNowForStorage();
        await traced("db.collection.update", "db.query", async () => {
          await db
            .update(tenantTables.noteCollections)
            .set({
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.description !== undefined ? { description: patch.description } : {}),
              ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
              ...(patch.color !== undefined ? { color: patch.color } : {}),
              ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
              updatedAt: now,
            })
            .where(eq(tenantTables.noteCollections.id, id));
        });
        const updated = await getCollectionReadService().findById(id, userId, environmentId);
        return updated!;
      },
    );
  }

  async setAutoShareNewContent(
    collectionId: string,
    userId: string,
    enabled: boolean,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.setAutoShareNewContent",
      {
        service: "NoteCollection",
        method: "setAutoShareNewContent",
        section: loggerAppSections.NOTES,
        details: { collectionId, userId, enabled },
      },
      "NOTE_COLLECTION.UPDATE_FAILED",
      async (span) => {
        span.attributes["collection.id"] = collectionId;
        span.attributes["user.id"] = userId;
        await this.helpers.requireOwner(collectionId, userId);
        const db = await getTenantDB();
        const now = getTimeNowForStorage();
        await traced("db.collection.setAutoShare", "db.query", async () => {
          await db
            .update(tenantTables.noteCollections)
            .set({ autoShareNewContent: enabled, updatedAt: now })
            .where(eq(tenantTables.noteCollections.id, collectionId));
        });
      },
    );
  }
}
