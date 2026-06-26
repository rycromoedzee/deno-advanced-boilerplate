/**
 * @file services/notes-tags/tag-update.service.ts
 * @description Tag Update service (notes tags)
 */
import { and, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import type { INoteTag, INoteTagUpdate } from "./tag-crud.helpers.ts";
import { TagReadService } from "./tag-read.service.ts";

export class TagUpdateService {
  private read = new TagReadService();

  async update(id: string, patch: INoteTagUpdate, userId: string): Promise<INoteTag> {
    return await tracedWithServiceErrorHandling(
      "NoteTag.update",
      {
        service: "NoteTag",
        method: "update",
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
        const now = getTimeNowForStorage();
        const set: Record<string, unknown> = { updatedAt: now };
        if (patch.name !== undefined) set.name = patch.name.trim();
        if (patch.color !== undefined) set.color = patch.color;
        await traced("db.tag.update", "db.query", async () => {
          await db
            .update(tenantTables.noteTags)
            .set(set)
            .where(and(eq(tenantTables.noteTags.id, id), eq(tenantTables.noteTags.ownerId, userId)));
        });
        return (await this.read.findById(id, userId))!;
      },
    );
  }
}
