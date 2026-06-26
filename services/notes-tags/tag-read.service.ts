/**
 * @file services/notes-tags/tag-read.service.ts
 * @description Tag Read service (notes tags)
 */
import { and, asc, desc, eq, inArray, like } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { calculatePagination } from "@utils/shared/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { getNotePermissionService } from "@services/notes-permission/singletons.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import type { INoteTag, INoteTagListQuery } from "./tag-crud.helpers.ts";
import type { INoteTagListResponse } from "@models/notes/note-tag.model.ts";

export class TagReadService {
  private get perm() {
    return getNotePermissionService();
  }

  async findById(id: string, userId: string): Promise<INoteTag | null> {
    return await tracedWithServiceErrorHandling(
      "NoteTag.findById",
      {
        service: "NoteTag",
        method: "findById",
        section: loggerAppSections.NOTES,
        details: { userId, tagId: id },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["tag.id"] = id;
        span.attributes["user.id"] = userId;
        const db = await getTenantDB();
        const rows = await traced("db.tag.findById", "db.query", async () =>
          await db
            .select()
            .from(tenantTables.noteTags)
            .where(and(eq(tenantTables.noteTags.id, id), eq(tenantTables.noteTags.ownerId, userId)))
            .limit(1));
        return rows[0] ? (rows[0] as INoteTag) : null;
      },
    );
  }

  async list(opts: INoteTagListQuery, userId: string): Promise<INoteTagListResponse> {
    return await tracedWithServiceErrorHandling(
      "NoteTag.list",
      {
        service: "NoteTag",
        method: "list",
        section: loggerAppSections.NOTES,
        details: { userId, page: opts.page, limit: opts.limit },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user.id"] = userId;
        const db = await getTenantDB();
        const conditions = [eq(tenantTables.noteTags.ownerId, userId)];
        if (opts.q) conditions.push(like(tenantTables.noteTags.name, `%${opts.q}%`));

        const sortBy = opts.sortBy ?? "name";
        const sortOrder = opts.sortOrder ?? "asc";
        const sortColumn = sortBy === "usageCount"
          ? tenantTables.noteTags.usageCount
          : sortBy === "createdAt"
          ? tenantTables.noteTags.createdAt
          : tenantTables.noteTags.name;
        const order = sortOrder === "desc" ? desc(sortColumn) : asc(sortColumn);

        const totalRows = await traced("db.tag.listCount", "db.query", async () =>
          await db
            .select({ id: tenantTables.noteTags.id })
            .from(tenantTables.noteTags)
            .where(and(...conditions)));
        const total = totalRows.length;
        const { offset, pagination } = calculatePagination(opts.page, opts.limit, total);
        const rows = await traced("db.tag.list", "db.query", async () =>
          await db
            .select()
            .from(tenantTables.noteTags)
            .where(and(...conditions))
            .orderBy(order)
            .limit(opts.limit)
            .offset(offset));
        return {
          items: rows.map((r) => r as INoteTag),
          pagination,
        };
      },
    );
  }

  async listForNote(noteId: string, userId: string): Promise<INoteTag[]> {
    return await tracedWithServiceErrorHandling(
      "NoteTag.listForNote",
      {
        service: "NoteTag",
        method: "listForNote",
        section: loggerAppSections.NOTES,
        details: { userId, noteId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;
        const allowed = await this.perm.checkAccess(noteId, userId, DB_ENUM_PERMISSION_ACCESS_LEVEL.READ);
        if (!allowed) throwHttpError("NOTE.ACCESS_DENIED");
        const db = await getTenantDB();
        const rows = await traced("db.tag.listForNote", "db.query", async () =>
          await db
            .select({
              id: tenantTables.noteTags.id,
              ownerId: tenantTables.noteTags.ownerId,
              name: tenantTables.noteTags.name,
              color: tenantTables.noteTags.color,
              usageCount: tenantTables.noteTags.usageCount,
              createdAt: tenantTables.noteTags.createdAt,
              updatedAt: tenantTables.noteTags.updatedAt,
            })
            .from(tenantTables.tagsOnNotes)
            .innerJoin(
              tenantTables.noteTags,
              eq(tenantTables.tagsOnNotes.tagId, tenantTables.noteTags.id),
            )
            .where(eq(tenantTables.tagsOnNotes.noteId, noteId)));
        return rows as INoteTag[];
      },
    );
  }

  async listForNotes(noteIds: string[], userId: string): Promise<Record<string, INoteTag[]>> {
    return await tracedWithServiceErrorHandling(
      "NoteTag.listForNotes",
      {
        service: "NoteTag",
        method: "listForNotes",
        section: loggerAppSections.NOTES,
        details: { userId, noteIdsCount: noteIds.length },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user.id"] = userId;
        span.attributes["note.ids"] = noteIds.length;
        if (noteIds.length === 0) return {};
        const db = await getTenantDB();
        const rows = await traced("db.tag.listForNotes", "db.query", async () =>
          await db
            .select({
              noteId: tenantTables.tagsOnNotes.noteId,
              id: tenantTables.noteTags.id,
              ownerId: tenantTables.noteTags.ownerId,
              name: tenantTables.noteTags.name,
              color: tenantTables.noteTags.color,
              usageCount: tenantTables.noteTags.usageCount,
              createdAt: tenantTables.noteTags.createdAt,
              updatedAt: tenantTables.noteTags.updatedAt,
            })
            .from(tenantTables.tagsOnNotes)
            .innerJoin(
              tenantTables.noteTags,
              eq(tenantTables.tagsOnNotes.tagId, tenantTables.noteTags.id),
            )
            .where(inArray(tenantTables.tagsOnNotes.noteId, noteIds)));
        const out: Record<string, INoteTag[]> = {};
        for (const r of rows) {
          const { noteId, ...rest } = r;
          (out[noteId] ??= []).push(rest as INoteTag);
        }
        return out;
      },
    );
  }
}
