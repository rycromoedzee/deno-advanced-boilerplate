/**
 * @file services/notes/note-read.service.ts
 * @description Note Read service (notes)
 */
import { and, desc, eq, inArray, like, or } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { calculatePagination } from "@utils/shared/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getNotePermissionService } from "@services/notes-permission/singletons.ts";
import { getVersionReadService } from "@services/notes-versions/singletons.ts";
import { getNoteTagService } from "@services/notes-tags/singletons.ts";
import { getNotePublicShareService, getNoteSharingService } from "@services/notes-sharing/singletons.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import type { INoteListQuery } from "@models/notes/note.model.ts";

export class NoteReadService {
  async findById(
    id: string,
    userId: string,
    environmentId: string,
  ) {
    return await tracedWithServiceErrorHandling(
      "NoteRead.findById",
      {
        service: "NoteRead",
        method: "findById",
        section: loggerAppSections.NOTES,
        details: { id, userId, environmentId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = id;
        const allowed = await getNotePermissionService().checkAccess(
          id,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );
        if (!allowed) return null;

        const row = await traced("db.note.findById", "db.query", async () => {
          const db = await getTenantDB();
          const rows = await db
            .select()
            .from(tenantTables.notes)
            .where(eq(tenantTables.notes.id, id))
            .limit(1);
          return rows[0] ?? null;
        });
        return row ?? null;
      },
    );
  }

  async getDetailById(
    id: string,
    userId: string,
    environmentId: string,
    userMasterKey: Uint8Array,
  ) {
    return await tracedWithServiceErrorHandling(
      "NoteRead.getDetailById",
      {
        service: "NoteRead",
        method: "getDetailById",
        section: loggerAppSections.NOTES,
        details: { id, userId, environmentId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = id;
        span.attributes["user.id"] = userId;

        const myLevel = await getNotePermissionService().getAccessLevel(id, userId);
        if (myLevel === null || !permissionLevelMeets(myLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.READ)) return null;

        const result = await traced("db.note.findById", "db.query", async () => {
          const db = await getTenantDB();
          const rows = await db
            .select({
              note: tenantTables.notes,
              collection: tenantTables.noteCollections,
            })
            .from(tenantTables.notes)
            .leftJoin(
              tenantTables.noteCollections,
              eq(tenantTables.notes.collectionId, tenantTables.noteCollections.id),
            )
            .where(eq(tenantTables.notes.id, id))
            .limit(1);
          return rows[0] ?? null;
        });
        if (!result) return null;

        const row = result.note;

        type PublicSharesResult = Awaited<ReturnType<ReturnType<typeof getNotePublicShareService>["listPublicShares"]>>;
        const [latestVersion, tagRows, sharedUsers, publicSharesResult] = await Promise.all([
          row.lastVersionId
            ? getVersionReadService().getDetail(
              id,
              row.lastVersionId,
              userId,
              environmentId,
              userMasterKey,
            )
            : Promise.resolve(null),
          getNoteTagService().listForNote(id, userId),
          getNoteSharingService().listSharedUsersForEmbed(id, userId),
          getNotePublicShareService().listPublicShares(id, userId, userMasterKey)
            .catch(() => ({ publicShares: [] }) as PublicSharesResult),
        ]);

        const {
          name: collectionName,
          description: collectionDescription,
          icon: collectionIcon,
          color: collectionColor,
          isArchived: collectionIsArchived,
        } = result.collection ?? {};

        return {
          ...row,
          latestVersion: latestVersion
            ? {
              id: latestVersion.id,
              body: latestVersion.body,
              createdAt: latestVersion.createdAt,
              createdByUserId: latestVersion.authorId,
            }
            : null,
          tags: tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color })),
          permissions: {
            users: sharedUsers,
            myPermissionLevel: myLevel,
          },
          publicShares: publicSharesResult.publicShares.map((share) => ({
            token: share.shareToken,
            url: share.publicUrl,
            hasPassword: share.isPasswordProtected,
            expiresAt: share.expiresAt,
            recipientEmail: share.recipientEmail,
            createdAt: share.createdAt,
          })),
          collectionName: collectionName ?? null,
          collectionDescription: collectionDescription ?? null,
          collectionIcon: collectionIcon ?? null,
          collectionColor: collectionColor ?? null,
          collectionIsArchived: collectionIsArchived ?? null,
        };
      },
    );
  }

  async list(
    opts: INoteListQuery,
    userId: string,
    environmentId: string,
  ) {
    return await tracedWithServiceErrorHandling(
      "NoteRead.list",
      {
        service: "NoteRead",
        method: "list",
        section: loggerAppSections.NOTES,
        details: { userId, environmentId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user.id"] = userId;
        span.attributes["list.page"] = opts.page;
        span.attributes["list.limit"] = opts.limit;

        const db = await getTenantDB();

        const sharedIds = await traced("db.note.sharedIds", "db.query", async () => {
          const rows = await db
            .select({ noteId: tenantTables.notesDataKeys.noteId })
            .from(tenantTables.notesDataKeys)
            .where(
              and(
                eq(tenantTables.notesDataKeys.userId, userId),
                eq(tenantTables.notesDataKeys.isActive, true),
              ),
            );
          return rows.map((r) => r.noteId);
        });

        const visibility = sharedIds.length > 0
          ? or(eq(tenantTables.notes.ownerId, userId), inArray(tenantTables.notes.id, sharedIds))!
          : eq(tenantTables.notes.ownerId, userId);

        const conditions = [visibility];
        if (opts.collectionId) {
          conditions.push(eq(tenantTables.notes.collectionId, opts.collectionId));
        }
        if (opts.archived === "true") conditions.push(eq(tenantTables.notes.isArchived, true));
        if (opts.archived === "false") conditions.push(eq(tenantTables.notes.isArchived, false));
        if (opts.pinned === "true") conditions.push(eq(tenantTables.notes.isPinned, true));
        if (opts.pinned === "false") conditions.push(eq(tenantTables.notes.isPinned, false));
        if (opts.q) conditions.push(like(tenantTables.notes.title, `%${opts.q}%`));

        const totalRows = await traced("db.note.listCount", "db.query", async () =>
          await db
            .select({ id: tenantTables.notes.id })
            .from(tenantTables.notes)
            .where(and(...conditions)));
        const total = totalRows.length;
        const { offset, pagination } = calculatePagination(opts.page, opts.limit, total);

        const rows = await traced("db.note.listPage", "db.query", async () =>
          await db
            .select({
              note: tenantTables.notes,
              collectionName: tenantTables.noteCollections.name,
            })
            .from(tenantTables.notes)
            .leftJoin(
              tenantTables.noteCollections,
              eq(tenantTables.notes.collectionId, tenantTables.noteCollections.id),
            )
            .where(and(...conditions))
            .orderBy(desc(tenantTables.notes.updatedAt))
            .limit(opts.limit)
            .offset(offset));

        // Batch the per-note enrichment (no N+1): author display names from the
        // tenant userProfiles table, plus tags via the pre-existing listForNotes.
        const noteIds = rows.map((r) => r.note.id);
        const ownerIds = [...new Set(rows.map((r) => r.note.ownerId))];

        const [ownerProfiles, tagsByNote] = await Promise.all([
          ownerIds.length === 0 ? Promise.resolve([]) : traced("db.note.listOwnerProfiles", "db.query", async () =>
            await db
              .select({
                userId: tenantTables.userProfiles.userId,
                firstName: tenantTables.userProfiles.firstName,
                lastName: tenantTables.userProfiles.lastName,
              })
              .from(tenantTables.userProfiles)
              .where(inArray(tenantTables.userProfiles.userId, ownerIds))),
          getNoteTagService().listForNotes(noteIds, userId),
        ]);

        const ownerNameById = new Map(
          ownerProfiles.map((p) => [p.userId, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()]),
        );

        return {
          items: rows.map((r) => ({
            ...r.note,
            ownerName: ownerNameById.get(r.note.ownerId) ?? null,
            collectionName: r.collectionName ?? null,
            tags: (tagsByNote[r.note.id] ?? []).map((t) => ({ name: t.name, color: t.color })),
          })),
          pagination,
        };
      },
    );
  }
}
