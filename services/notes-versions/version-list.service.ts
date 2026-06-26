/**
 * @file services/notes-versions/version-list.service.ts
 * @description Version List service (notes versions)
 */
import { desc, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getNotePermissionService } from "@services/notes-permission/singletons.ts";
import type { INoteVersionResponse } from "@models/notes/note-version.model.ts";
import { toVersionMeta } from "./version-crud.helpers.ts";

export class VersionListService {
  async list(
    noteId: string,
    userId: string,
    environmentId: string,
  ): Promise<INoteVersionResponse[]> {
    return await tracedWithServiceErrorHandling(
      "NoteVersion.list",
      {
        service: "NoteVersion",
        method: "list",
        section: loggerAppSections.NOTES,
        details: { noteId, userId, environmentId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;
        const allowed = await getNotePermissionService().checkAccess(
          noteId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );
        if (!allowed) throwHttpError("NOTE.ACCESS_DENIED");

        const rows = await traced("db.noteVersion.list", "db.query", async () => {
          const db = await getTenantDB();
          return await db
            .select()
            .from(tenantTables.noteVersions)
            .where(eq(tenantTables.noteVersions.noteId, noteId))
            .orderBy(desc(tenantTables.noteVersions.createdAt));
        });
        return rows.map((r) => toVersionMeta(r));
      },
    );
  }
}
