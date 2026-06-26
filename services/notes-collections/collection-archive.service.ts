/**
 * @file services/notes-collections/collection-archive.service.ts
 * @description Collection Archive service (notes collections)
 */
import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq } from "@deps";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import type { INoteCollectionResponse } from "@models/notes/note-collection.model.ts";
import { CollectionCrudHelpers } from "./collection-crud.helpers.ts";
import { getCollectionReadService } from "./singletons.ts";

export class CollectionArchiveService {
  private helpers = new CollectionCrudHelpers();

  async archive(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<INoteCollectionResponse> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.archive",
      {
        service: "NoteCollection",
        method: "archive",
        section: loggerAppSections.NOTES,
        details: { id, userId, environmentId },
      },
      "NOTE_COLLECTION.ARCHIVE_FAILED",
      async (span) => {
        span.attributes["collection.id"] = id;
        span.attributes["user.id"] = userId;
        await this.helpers.requireOwner(id, userId);
        const db = await getTenantDB();
        const now = getTimeNowForStorage();
        await traced("db.collection.archive", "db.query", async () => {
          await db
            .update(tenantTables.noteCollections)
            .set({ isArchived: true, archivedAt: now, updatedAt: now })
            .where(eq(tenantTables.noteCollections.id, id));
        });
        return (await getCollectionReadService().findById(id, userId, environmentId))!;
      },
    );
  }

  async restore(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<INoteCollectionResponse> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.restore",
      {
        service: "NoteCollection",
        method: "restore",
        section: loggerAppSections.NOTES,
        details: { id, userId, environmentId },
      },
      "NOTE_COLLECTION.RESTORE_FAILED",
      async (span) => {
        span.attributes["collection.id"] = id;
        span.attributes["user.id"] = userId;
        await this.helpers.requireOwner(id, userId);
        const db = await getTenantDB();
        const now = getTimeNowForStorage();
        await traced("db.collection.restore", "db.query", async () => {
          await db
            .update(tenantTables.noteCollections)
            .set({ isArchived: false, archivedAt: null, updatedAt: now })
            .where(eq(tenantTables.noteCollections.id, id));
        });
        return (await getCollectionReadService().findById(id, userId, environmentId))!;
      },
    );
  }
}
