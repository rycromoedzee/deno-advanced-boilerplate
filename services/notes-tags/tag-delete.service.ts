/**
 * @file services/notes-tags/tag-delete.service.ts
 * @description Tag Delete service (notes tags)
 */
import { and, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { TagReadService } from "./tag-read.service.ts";

export class TagDeleteService {
  private read = new TagReadService();

  async delete(id: string, userId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteTag.delete",
      {
        service: "NoteTag",
        method: "delete",
        section: loggerAppSections.NOTES,
        details: { userId, tagId: id },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["tag.id"] = id;
        span.attributes["user.id"] = userId;
        const tag = await this.read.findById(id, userId);
        if (!tag) throwHttpError("NOTE_TAG.NOT_FOUND");
        const db = await getTenantDB();
        await traced("db.tagsOnNotes.deleteByTag", "db.query", async () => {
          await db
            .delete(tenantTables.tagsOnNotes)
            .where(eq(tenantTables.tagsOnNotes.tagId, id));
        });
        await traced("db.tag.delete", "db.query", async () => {
          await db
            .delete(tenantTables.noteTags)
            .where(and(eq(tenantTables.noteTags.id, id), eq(tenantTables.noteTags.ownerId, userId)));
        });
      },
    );
  }
}
