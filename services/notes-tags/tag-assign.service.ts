/**
 * @file services/notes-tags/tag-assign.service.ts
 * @description Tag Assign service (notes tags)
 */
import { and, eq, sql } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { getNotePermissionService } from "@services/notes-permission/singletons.ts";
import { TagReadService } from "./tag-read.service.ts";

export class TagAssignService {
  private read = new TagReadService();
  private get perm() {
    return getNotePermissionService();
  }

  async attachToNote(noteId: string, tagId: string, userId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteTag.attachToNote",
      {
        service: "NoteTag",
        method: "attachToNote",
        section: loggerAppSections.NOTES,
        details: { userId, noteId, tagId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["tag.id"] = tagId;
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;
        const allowed = await this.perm.checkAccess(noteId, userId, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE);
        if (!allowed) throwHttpError("NOTE.ACCESS_DENIED");
        const tag = await this.read.findById(tagId, userId);
        if (!tag) throwHttpError("NOTE_TAG.NOT_FOUND");
        const db = await getTenantDB();
        const now = getTimeNowForStorage();
        try {
          await traced("db.tagsOnNotes.insert", "db.query", async () => {
            await db.insert(tenantTables.tagsOnNotes).values({
              noteId,
              tagId,
              addedByUserId: userId,
              createdAt: now,
            });
          });
          await traced("db.tag.incrementUsage", "db.query", async () => {
            await db
              .update(tenantTables.noteTags)
              .set({ usageCount: sql`${tenantTables.noteTags.usageCount} + 1`, updatedAt: now })
              .where(eq(tenantTables.noteTags.id, tagId));
          });
        } catch (err) {
          // PK collision means the tag is already attached by this user — that's idempotent success.
          // Any other error should propagate. Walk the cause chain because drizzle/libsql
          // wrap the original SqliteError in higher-level "Failed query: ..." errors.
          const isUniqueViolation = (e: unknown): boolean => {
            let cur: unknown = e;
            while (cur) {
              const msg = cur instanceof Error ? cur.message : String(cur);
              if (/UNIQUE constraint failed|PRIMARY KEY|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(msg)) {
                return true;
              }
              cur = cur instanceof Error ? (cur as Error & { cause?: unknown }).cause : undefined;
            }
            return false;
          };
          if (!isUniqueViolation(err)) throw err;
          // already attached — no-op
        }
      },
    );
  }

  async detachFromNote(noteId: string, tagId: string, userId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteTag.detachFromNote",
      {
        service: "NoteTag",
        method: "detachFromNote",
        section: loggerAppSections.NOTES,
        details: { userId, noteId, tagId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["tag.id"] = tagId;
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;

        // Allowed if requester is the addedByUserId OR the note owner.
        const db = await getTenantDB();
        const noteRows = await traced("db.note.readOwner", "db.query", async () =>
          await db
            .select({ ownerId: tenantTables.notes.ownerId })
            .from(tenantTables.notes)
            .where(eq(tenantTables.notes.id, noteId))
            .limit(1));
        if (!noteRows[0]) throwHttpError("NOTE_TAG.NOT_FOUND");
        const isNoteOwner = noteRows[0]!.ownerId === userId;

        const existing = await traced("db.tagsOnNotes.findExisting", "db.query", async () =>
          await db
            .select()
            .from(tenantTables.tagsOnNotes)
            .where(
              and(
                eq(tenantTables.tagsOnNotes.noteId, noteId),
                eq(tenantTables.tagsOnNotes.tagId, tagId),
              ),
            ));
        if (existing.length === 0) return;

        const toDelete = isNoteOwner ? existing : existing.filter((r) => r.addedByUserId === userId);
        if (toDelete.length === 0) throwHttpError("NOTE.ACCESS_DENIED");

        const now = getTimeNowForStorage();
        for (const row of toDelete) {
          await traced("db.tagsOnNotes.delete", "db.query", async () => {
            await db
              .delete(tenantTables.tagsOnNotes)
              .where(
                and(
                  eq(tenantTables.tagsOnNotes.noteId, row.noteId),
                  eq(tenantTables.tagsOnNotes.tagId, row.tagId),
                  eq(tenantTables.tagsOnNotes.addedByUserId, row.addedByUserId),
                ),
              );
          });
          await traced("db.tag.decrementUsage", "db.query", async () => {
            await db
              .update(tenantTables.noteTags)
              .set({
                usageCount: sql`MAX(${tenantTables.noteTags.usageCount} - 1, 0)`,
                updatedAt: now,
              })
              .where(eq(tenantTables.noteTags.id, row.tagId));
          });
        }
      },
    );
  }
}
