/**
 * @file services/notes/note-update.service.ts
 * @description Note Update service (notes)
 */
import { eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getNotePermissionService } from "@services/notes-permission/singletons.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import type { INoteUpdateRequest } from "@models/notes/note.model.ts";

export class NoteUpdateService {
  async update(
    id: string,
    patch: INoteUpdateRequest,
    userId: string,
    environmentId: string,
  ): Promise<typeof tenantTables.notes.$inferSelect> {
    return await tracedWithServiceErrorHandling(
      "NoteUpdate.update",
      {
        service: "NoteUpdate",
        method: "update",
        section: loggerAppSections.NOTES,
        details: { id, userId, environmentId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = id;
        const allowed = await getNotePermissionService().checkAccess(
          id,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
        );
        if (!allowed) throwHttpError("COMMON.NOT_FOUND");

        const db = await getTenantDB();
        const now = getTimeNowForStorage();

        if (patch.collectionId) {
          const col = await traced("db.collection.read", "db.query", async () =>
            await db
              .select({ ownerId: tenantTables.noteCollections.ownerId })
              .from(tenantTables.noteCollections)
              .where(eq(tenantTables.noteCollections.id, patch.collectionId!))
              .limit(1));
          if (!col[0] || col[0].ownerId !== userId) {
            throwHttpError("COMMON.NOT_FOUND");
          }
        }

        await traced("db.note.update", "db.query", async (s) => {
          s.attributes["note.id"] = id;
          await db
            .update(tenantTables.notes)
            .set({
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.collectionId !== undefined ? { collectionId: patch.collectionId } : {}),
              ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
              ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
              updatedAt: now,
            })
            .where(eq(tenantTables.notes.id, id));
        });

        const updated = await traced("db.note.readBack", "db.query", async () => {
          const rows = await db
            .select()
            .from(tenantTables.notes)
            .where(eq(tenantTables.notes.id, id))
            .limit(1);
          return rows[0]!;
        });

        return updated;
      },
    );
  }
}
