/**
 * @file services/notes-collections/collection-read.service.ts
 * @description Collection Read service (notes collections)
 */
import { getTenantDB, tenantTables } from "@db/index.ts";
import { and, asc, eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import type { INoteCollectionResponse } from "@models/notes/note-collection.model.ts";
import { CollectionCrudHelpers } from "./collection-crud.helpers.ts";

export class CollectionReadService {
  private helpers = new CollectionCrudHelpers();

  async findById(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<INoteCollectionResponse | null> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.findById",
      {
        service: "NoteCollection",
        method: "findById",
        section: loggerAppSections.NOTES,
        details: { id, userId, environmentId },
      },
      "NOTE_COLLECTION.FETCH_FAILED",
      async (span) => {
        span.attributes["collection.id"] = id;
        span.attributes["user.id"] = userId;
        const db = await getTenantDB();
        const rows = await traced("db.collection.findById", "db.query", async () => {
          return await db
            .select()
            .from(tenantTables.noteCollections)
            .where(
              and(
                eq(tenantTables.noteCollections.id, id),
                eq(tenantTables.noteCollections.ownerId, userId),
              ),
            )
            .limit(1);
        });
        return rows[0] ? this.helpers.toResponse(rows[0]) : null;
      },
    );
  }

  async list(
    opts: { archived: "true" | "false" | "all" },
    userId: string,
    environmentId: string,
  ): Promise<INoteCollectionResponse[]> {
    return await tracedWithServiceErrorHandling(
      "NoteCollection.list",
      {
        service: "NoteCollection",
        method: "list",
        section: loggerAppSections.NOTES,
        details: { userId, environmentId, archived: opts.archived },
      },
      "NOTE_COLLECTION.FETCH_FAILED",
      async (span) => {
        span.attributes["user.id"] = userId;
        const db = await getTenantDB();
        const conditions = [eq(tenantTables.noteCollections.ownerId, userId)];
        if (opts.archived === "true") {
          conditions.push(eq(tenantTables.noteCollections.isArchived, true));
        }
        if (opts.archived === "false") {
          conditions.push(eq(tenantTables.noteCollections.isArchived, false));
        }
        const rows = await traced("db.collection.list", "db.query", async () => {
          return await db
            .select()
            .from(tenantTables.noteCollections)
            .where(and(...conditions))
            .orderBy(asc(tenantTables.noteCollections.createdAt));
        });
        return rows.map((r) => this.helpers.toResponse(r));
      },
    );
  }
}
