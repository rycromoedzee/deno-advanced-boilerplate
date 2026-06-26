/**
 * @file handlers/notes/sharing.handler.ts
 * @description Sharing request handler
 */
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import {
  SchemaNotePermissionsListResponse,
  SchemaNotePublicShareResponse,
  SchemaNoteShareListResponse,
} from "@models/notes/note-sharing.model.ts";
import { DataAccessService } from "@services/encryption/index.ts";
import { getNotePublicShareService, getNoteSharingService } from "@services/notes-sharing/singletons.ts";
import {
  createNotePublicShareRoute,
  disableNotePublicShareRoute,
  listNotePermissionsRoute,
  listSharesRoute,
  revokeNoteShareRoute,
  shareNoteRoute,
} from "@routes/notes/sharing.route.ts";

const baseMeta = {
  entityType: "note" as const,
  loggerSection: loggerAppSections.NOTES,
};

export const listSharesHandler = defineHandler(
  {
    route: listSharesRoute,
    operationName: "note_shares_list",
    responseSchema: SchemaNoteShareListResponse,
    ...baseMeta,
  },
  async (ctx) => {
    const filter = ctx.query.type;
    const items: Array<{
      type: "internal" | "public";
      noteId: string;
      noteTitle: string;
      permissionLevel: string;
      createdAt: number;
      sharedWithUserId: string | null;
      sharedWithEmail: string | null;
      sharedWithName: string | null;
      shareToken: string | null;
      isPasswordProtected: boolean | null;
      isActive: boolean | null;
      expiresAt: number | null;
    }> = [];

    if (filter === "all" || filter === "internal") {
      const internal = await getNoteSharingService().listAllInternalSharesForOwner(ctx.userId);
      items.push(...internal.map((s) => ({
        type: "internal" as const,
        noteId: s.noteId,
        noteTitle: s.noteTitle,
        permissionLevel: s.permissionLevel,
        createdAt: s.grantedAt,
        sharedWithUserId: s.sharedWithUserId,
        sharedWithEmail: s.sharedWithEmail,
        sharedWithName: s.sharedWithName,
        shareToken: null,
        isPasswordProtected: null,
        isActive: null,
        expiresAt: null,
      })));
    }

    if (filter === "all" || filter === "public") {
      const publicShares = await getNotePublicShareService().listAllPublicSharesForOwner(ctx.userId);
      items.push(...publicShares.map((s) => ({
        type: "public" as const,
        noteId: s.noteId,
        noteTitle: s.noteTitle,
        permissionLevel: s.permissionLevel,
        createdAt: s.createdAt,
        sharedWithUserId: null,
        sharedWithEmail: null,
        sharedWithName: null,
        shareToken: s.shareToken,
        isPasswordProtected: s.isPasswordProtected,
        isActive: s.isActive,
        expiresAt: s.expiresAt,
      })));
    }

    return { data: { items }, status: 200 };
  },
);

export const shareNoteHandler = defineHandler(
  { route: shareNoteRoute, operationName: "note_share", ...baseMeta },
  async (ctx) => {
    await getNoteSharingService().shareWithUser(
      ctx.params.id,
      ctx.userId,
      ctx.body.toUserId,
      ctx.body.permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
    );
    return { data: null, status: 204 };
  },
);

export const revokeNoteShareHandler = defineHandler(
  { route: revokeNoteShareRoute, operationName: "note_share_revoke", ...baseMeta },
  async (ctx) => {
    await getNoteSharingService().revokeUserAccess(
      ctx.params.id,
      ctx.userId,
      ctx.body.targetUserId,
    );
    return { data: null, status: 204 };
  },
);

export const listNotePermissionsHandler = defineHandler(
  {
    route: listNotePermissionsRoute,
    operationName: "note_permissions_list",
    responseSchema: SchemaNotePermissionsListResponse,
    ...baseMeta,
  },
  async (ctx) => ({
    data: {
      users: await getNoteSharingService().listSharedUsersWithProfiles(
        ctx.params.id,
        ctx.userId,
      ),
    },
    status: 200,
  }),
);

export const createNotePublicShareHandler = defineHandler(
  {
    route: createNotePublicShareRoute,
    operationName: "note_public_share_create",
    responseSchema: SchemaNotePublicShareResponse,
    ...baseMeta,
  },
  async (ctx) => {
    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(ctx.c);
    return {
      data: await getNotePublicShareService().createPublicShare(
        ctx.params.id,
        ctx.userId,
        {
          password: ctx.body.password,
          expiresAt: ctx.body.expiresAt ?? null,
          permissionLevel: ctx.body.permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL | undefined,
        },
        keyDetails.key,
      ),
      status: 200,
    };
  },
);

export const disableNotePublicShareHandler = defineHandler(
  {
    route: disableNotePublicShareRoute,
    operationName: "note_public_share_disable",
    ...baseMeta,
  },
  async (ctx) => {
    await getNotePublicShareService().disablePublicShare(ctx.params.id, ctx.userId);
    return { data: null, status: 204 };
  },
);
