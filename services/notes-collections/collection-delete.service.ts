/**
 * @file services/notes-collections/collection-delete.service.ts
 * @description Collection Delete service (notes collections)
 */
import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { CollectionCrudHelpers } from "./collection-crud.helpers.ts";

export class CollectionDeleteService {
  private helpers = new CollectionCrudHelpers();

  async delete(id: string, userId: string, environmentId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.delete",
      {
        service: "NoteCollection",
        method: "delete",
        section: loggerAppSections.NOTES,
        details: { id, userId, environmentId },
      },
      "NOTE_COLLECTION.DELETE_FAILED",
      async (span) => {
        span.attributes["collection.id"] = id;
        span.attributes["user.id"] = userId;
        await this.helpers.requireOwner(id, userId);
        const db = await getTenantDB();
        await traced("db.collection.delete", "db.query", async () => {
          await db
            .delete(tenantTables.noteCollections)
            .where(eq(tenantTables.noteCollections.id, id));
        });
      },
    );
  }
}
