/**
 * @file services/notes-collections/collection-crud.helpers.ts
 * @description Helper functions for notes collections services
 */
import { eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { traced } from "@services/tracing/index.ts";
import type { INoteCollectionResponse } from "@models/notes/note-collection.model.ts";

export class CollectionCrudHelpers {
  async requireOwner(id: string, userId: string): Promise<void> {
    const db = await getTenantDB();
    const rows = await traced("db.collection.requireOwner", "db.query", async () => {
      return await db
        .select({ ownerId: tenantTables.noteCollections.ownerId })
        .from(tenantTables.noteCollections)
        .where(eq(tenantTables.noteCollections.id, id))
        .limit(1);
    });
    if (!rows[0]) throwHttpError("NOTE_COLLECTION.NOT_FOUND");
    if (rows[0]!.ownerId !== userId) throwHttpError("NOTE_COLLECTION.NOT_FOUND");
  }

  toResponse(
    row: typeof tenantTables.noteCollections.$inferSelect,
  ): INoteCollectionResponse {
    return {
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      description: row.description,
      icon: row.icon,
      color: row.color,
      isArchived: row.isArchived,
      archivedAt: row.archivedAt,
      metadata: row.metadata,
      autoShareNewContent: row.autoShareNewContent,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
