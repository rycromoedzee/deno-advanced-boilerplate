/**
 * @file services/notes-tags/tag-create.service.ts
 * @description Tag Create service (notes tags)
 */
import { and, eq, sql } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { generateIdForNoteTag } from "@utils/database/id-generation/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";
import type { INoteTag, INoteTagCreate } from "./tag-crud.helpers.ts";

export class TagCreateService {
  async create(input: INoteTagCreate, userId: string): Promise<INoteTag> {
    return await tracedWithServiceErrorHandling(
      "NoteTag.create",
      {
        service: "NoteTag",
        method: "create",
        section: loggerAppSections.NOTES,
        details: { userId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user.id"] = userId;
        const db = await getTenantDB();
        const trimmed = input.name.trim();
        if (!trimmed) throwHttpError("NOTE_TAG.NOT_FOUND");

        const existing = await traced("db.tag.findByName", "db.query", async () =>
          await db
            .select()
            .from(tenantTables.noteTags)
            .where(
              and(
                eq(tenantTables.noteTags.ownerId, userId),
                sql`LOWER(${tenantTables.noteTags.name}) = LOWER(${trimmed})`,
              ),
            )
            .limit(1));
        if (existing[0]) {
          span.attributes["tag.id"] = existing[0].id;
          return existing[0] as INoteTag;
        }

        const now = getTimeNowForStorage();
        const id = await traced("db.tag.insert", "db.query", async () => {
          return await databaseCreateWithRetry(async (newId) => {
            await db.insert(tenantTables.noteTags).values({
              id: newId,
              ownerId: userId,
              name: trimmed,
              color: input.color ?? "#6b7280",
              usageCount: 0,
              createdAt: now,
              updatedAt: now,
            });
            return newId;
          }, generateIdForNoteTag);
        });
        span.attributes["tag.id"] = id;
        const rows = await traced("db.tag.readBack", "db.query", async () =>
          await db
            .select()
            .from(tenantTables.noteTags)
            .where(eq(tenantTables.noteTags.id, id))
            .limit(1));
        return rows[0] as INoteTag;
      },
    );
  }
}
