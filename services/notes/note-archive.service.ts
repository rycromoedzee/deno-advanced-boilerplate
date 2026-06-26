/**
 * @file services/notes/note-archive.service.ts
 * @description Note Archive service (notes)
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

export class NoteArchiveService {
  async archive(id: string, userId: string, environmentId: string) {
    return await this.runArchiveTransition({
      id,
      userId,
      environmentId,
      span: "NoteArchive.archive",
      method: "archive",
      isArchived: true,
    });
  }

  async restore(id: string, userId: string, environmentId: string) {
    return await this.runArchiveTransition({
      id,
      userId,
      environmentId,
      span: "NoteArchive.restore",
      method: "restore",
      isArchived: false,
    });
  }

  private async runArchiveTransition(args: {
    id: string;
    userId: string;
    environmentId: string;
    span: string;
    method: "archive" | "restore";
    isArchived: boolean;
  }) {
    return await tracedWithServiceErrorHandling(
      args.span,
      {
        service: "NoteArchive",
        method: args.method,
        section: loggerAppSections.NOTES,
        details: { id: args.id, userId: args.userId, environmentId: args.environmentId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = args.id;
        span.attributes["note.is_archived_target"] = args.isArchived;

        const allowed = await getNotePermissionService().checkAccess(
          args.id,
          args.userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
        );
        if (!allowed) throwHttpError("COMMON.NOT_FOUND");

        const db = await getTenantDB();
        const now = getTimeNowForStorage();

        await traced("db.note.archiveTransition", "db.query", async () => {
          await db
            .update(tenantTables.notes)
            .set({
              isArchived: args.isArchived,
              archivedAt: args.isArchived ? now : null,
              updatedAt: now,
            })
            .where(eq(tenantTables.notes.id, args.id));
        });

        const row = await traced("db.note.readBack", "db.query", async () => {
          const rows = await db
            .select()
            .from(tenantTables.notes)
            .where(eq(tenantTables.notes.id, args.id))
            .limit(1);
          return rows[0]!;
        });
        return row;
      },
    );
  }
}
