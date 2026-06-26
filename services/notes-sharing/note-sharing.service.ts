/**
 * @file services/notes-sharing/note-sharing.service.ts
 * @description Internal user-to-user sharing for notes. Wraps the generic
 * EncryptionSharingService + SharingService bound to notes_data_keys.
 */

import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { and, eq, inArray, ne } from "@deps";
import { SharingService } from "@services/encryption/sharing.service.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getNotePermissionService } from "@services/notes-permission/index.ts";
import { getNoteEncryptionService } from "@services/notes/index.ts";
import { getNoteEventsSSEService } from "@services/notes-events/index.ts";
import { requestContext } from "@db/context.ts";
import type { INoteEventEmitter } from "@interfaces/notes.ts";
import { getNoteAttachmentService } from "@services/notes-attachments/index.ts";

const NOTES_TABLE_CONFIG = {
  tableName: tenantTables.notesDataKeys,
  resourceIdColumn: "noteId",
} as const;

export interface INoteSharedUser {
  userId: string;
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  grantedAt: number;
  grantedBy: string | null;
}

export interface INoteSharedUserWithProfile {
  userId: string;
  email: string | null;
  name: string;
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  grantedAt: number;
  grantedBy: string | null;
}

export interface INoteEmbeddedSharedUser {
  userId: string;
  firstName: string;
  lastName: string;
  avatarColor: string | null;
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
}

export interface INoteInternalShareListItem {
  noteId: string;
  noteTitle: string;
  sharedWithUserId: string | null;
  sharedWithEmail: string | null;
  sharedWithName: string;
  permissionLevel: string;
  grantedAt: number;
}

export class NoteSharingService {
  private sharingService = new SharingService(NOTES_TABLE_CONFIG);

  private get perm() {
    return getNotePermissionService();
  }

  private get enc() {
    return getNoteEncryptionService();
  }

  async shareWithUser(
    noteId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteSharing.shareWithUser",
      {
        service: "NoteSharing",
        method: "shareWithUser",
        section: loggerAppSections.NOTES,
        details: { noteId, fromUserId, toUserId, permissionLevel },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = toUserId;
        span.attributes["permission_level"] = permissionLevel;

        const ownerLevel = await this.perm.getAccessLevel(noteId, fromUserId);
        if (ownerLevel === null) throwHttpError("COMMON.NOT_FOUND");
        if (!permissionLevelMeets(ownerLevel!, DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE)) throwHttpError("COMMON.NOT_FOUND");
        if (!permissionLevelMeets(ownerLevel!, permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL)) throwHttpError("COMMON.NOT_FOUND");

        const mode = await this.enc.getEncryptionMode(noteId);
        if (mode === DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED) {
          await this.enc.shareAppEncrypted(noteId, fromUserId, toUserId, permissionLevel);
        } else {
          if (!ownerUserMasterKey) throwHttpError("COMMON.NOT_FOUND");
          await this.enc.shareUserEncrypted(
            noteId,
            fromUserId,
            toUserId,
            permissionLevel,
            ownerUserMasterKey!,
          );
        }

        // Propagate access to all of the note's attachments. Import lazily to avoid
        // circular dependency between notes-sharing and notes-attachments.
        // The propagation must succeed atomically with the note share: if any
        // attachment-key wrap fails, compensate by revoking the just-granted note
        // access so callers never observe a partial share.
        // NOTE: Slice 7 owns the proper interface-based fix for this lazy import.
        try {
          await getNoteAttachmentService().propagateNoteAttachmentsToUser(
            noteId,
            fromUserId,
            toUserId,
            permissionLevel,
            ownerUserMasterKey,
          );
        } catch (err) {
          try {
            await this.sharingService.revokeAccess(noteId, toUserId);
          } catch (revokeError) {
            await useLogger(LoggerLevels.error, {
              message: "Compensating revoke failed after attachment propagation error",
              section: loggerAppSections.NOTES,
              messageKey: "notes_share_compensating_revoke_failed",
              details: {
                noteId,
                toUserId,
                error: revokeError instanceof Error ? revokeError.message : String(revokeError),
              },
            });
          }
          throw err;
        }

        // Best-effort: emit note.shared to both the recipient (so their UI
        // surfaces the new share) and the sharer (so other tabs sync).
        try {
          const ctx = requestContext.getStore();
          const env = ctx?.environmentId ?? "";
          const evt = { type: "note.shared", noteId, recipientUserId: toUserId } as const;
          const emitter: INoteEventEmitter = getNoteEventsSSEService();
          emitter.broadcast(evt, toUserId, env);
          emitter.broadcast(evt, fromUserId, env);
        } catch (error) {
          await useLogger(LoggerLevels.error, {
            message: "Failed to emit note.shared event",
            section: loggerAppSections.NOTES,
            messageKey: "notes_share_event_emit_error",
            details: {
              noteId,
              fromUserId,
              toUserId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    );
  }

  async revokeUserAccess(
    noteId: string,
    fromUserId: string,
    targetUserId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteSharing.revokeUserAccess",
      {
        service: "NoteSharing",
        method: "revokeUserAccess",
        section: loggerAppSections.NOTES,
        details: { noteId, fromUserId, targetUserId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = targetUserId;

        const requesterLevel = await this.perm.getAccessLevel(noteId, fromUserId);
        if (requesterLevel === null) throwHttpError("COMMON.NOT_FOUND");
        if (!permissionLevelMeets(requesterLevel!, DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE)) throwHttpError("COMMON.NOT_FOUND");
        const result = await this.sharingService.revokeAccess(noteId, targetUserId);
        if (!result) throwHttpError("COMMON.NOT_FOUND");
      },
    );
  }

  async updateUserPermission(
    noteId: string,
    fromUserId: string,
    targetUserId: string,
    newLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteSharing.updateUserPermission",
      {
        service: "NoteSharing",
        method: "updateUserPermission",
        section: loggerAppSections.NOTES,
        details: { noteId, fromUserId, targetUserId, newLevel },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = targetUserId;
        span.attributes["permission_level"] = newLevel;

        const requesterLevel = await this.perm.getAccessLevel(noteId, fromUserId);
        if (requesterLevel === null) throwHttpError("COMMON.NOT_FOUND");
        if (!permissionLevelMeets(requesterLevel!, DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE)) throwHttpError("COMMON.NOT_FOUND");
        if (!permissionLevelMeets(requesterLevel!, newLevel)) throwHttpError("COMMON.NOT_FOUND");
        const result = await this.sharingService.updatePermission(noteId, targetUserId, newLevel);
        if (!result) throwHttpError("COMMON.NOT_FOUND");
      },
    );
  }

  async listSharedUsers(
    noteId: string,
    requesterId: string,
  ): Promise<INoteSharedUser[]> {
    return await tracedWithServiceErrorHandling(
      "NoteSharing.listSharedUsers",
      {
        service: "NoteSharing",
        method: "listSharedUsers",
        section: loggerAppSections.NOTES,
        details: { noteId, requesterId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = requesterId;

        const allowed = await this.perm.checkAccess(
          noteId,
          requesterId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );
        if (!allowed) throwHttpError("COMMON.NOT_FOUND");
        return await this.sharingService.listSharedUsers(noteId);
      },
    );
  }

  async listSharedUsersWithProfiles(
    noteId: string,
    requesterId: string,
  ): Promise<INoteSharedUserWithProfile[]> {
    return await tracedWithServiceErrorHandling(
      "NoteSharing.listSharedUsersWithProfiles",
      {
        service: "NoteSharing",
        method: "listSharedUsersWithProfiles",
        section: loggerAppSections.NOTES,
        details: { noteId, requesterId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = requesterId;

        const allowed = await this.perm.checkAccess(
          noteId,
          requesterId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );
        if (!allowed) throwHttpError("COMMON.NOT_FOUND");

        const allShared = await this.sharingService.listSharedUsers(noteId);
        const others = allShared.filter((u) => u.userId !== requesterId);
        if (others.length === 0) return [];

        const userIds = others.map((u) => u.userId);
        const profiles = await traced(
          "NoteSharing.listSharedUsersWithProfiles.profiles",
          "db.query",
          async () => {
            const tenantDb = await getTenantDB();
            return tenantDb
              .select({
                userId: tenantTables.userProfiles.userId,
                firstName: tenantTables.userProfiles.firstName,
                lastName: tenantTables.userProfiles.lastName,
                email: tenantTables.userProfiles.email,
              })
              .from(tenantTables.userProfiles)
              .where(inArray(tenantTables.userProfiles.userId, userIds));
          },
        );
        const profileMap = new Map(profiles.map((p) => [p.userId, p]));

        return others.map((u) => {
          const profile = profileMap.get(u.userId);
          return {
            userId: u.userId,
            email: profile?.email ?? null,
            name: `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim(),
            permissionLevel: u.permissionLevel,
            grantedAt: u.grantedAt,
            grantedBy: u.grantedBy,
          };
        });
      },
    );
  }

  async listSharedUsersForEmbed(
    noteId: string,
    requesterId: string,
  ): Promise<INoteEmbeddedSharedUser[]> {
    return await tracedWithServiceErrorHandling(
      "NoteSharing.listSharedUsersForEmbed",
      {
        service: "NoteSharing",
        method: "listSharedUsersForEmbed",
        section: loggerAppSections.NOTES,
        details: { noteId, requesterId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = requesterId;

        const allowed = await this.perm.checkAccess(
          noteId,
          requesterId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );
        if (!allowed) throwHttpError("COMMON.NOT_FOUND");

        const allShared = await this.sharingService.listSharedUsers(noteId);
        const others = allShared.filter((u) => u.userId !== requesterId);
        if (others.length === 0) return [];

        const userIds = others.map((u) => u.userId);
        const profiles = await traced(
          "NoteSharing.listSharedUsersForEmbed.profiles",
          "db.query",
          async () => {
            const tenantDb = await getTenantDB();
            return tenantDb
              .select({
                userId: tenantTables.userProfiles.userId,
                firstName: tenantTables.userProfiles.firstName,
                lastName: tenantTables.userProfiles.lastName,
                avatarColor: tenantTables.userProfiles.avatarColor,
              })
              .from(tenantTables.userProfiles)
              .where(inArray(tenantTables.userProfiles.userId, userIds));
          },
        );
        const profileMap = new Map(profiles.map((p) => [p.userId, p]));

        return others.map((u) => {
          const p = profileMap.get(u.userId);
          return {
            userId: u.userId,
            firstName: p?.firstName ?? "",
            lastName: p?.lastName ?? "",
            avatarColor: p?.avatarColor ?? null,
            permissionLevel: u.permissionLevel,
          };
        });
      },
    );
  }

  /**
   * List all internal user-to-user shares created by the authenticated user,
   * across all their notes. Joins notes (for title) and user_profiles (for
   * the shared-with user's name and email).
   *
   * Access control: filtering by grantedBy (the authenticated userId) scopes
   * results to shares the user created. Excludes self-rows (where userId = grantedBy).
   */
  async listAllInternalSharesForOwner(
    userId: string,
  ): Promise<INoteInternalShareListItem[]> {
    return await tracedWithServiceErrorHandling(
      "NoteSharing.listAllInternalSharesForOwner",
      {
        service: "NoteSharing",
        method: "listAllInternalSharesForOwner",
        section: loggerAppSections.NOTES,
        details: { userId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user.id"] = userId;

        const rows = await traced(
          "db.sharing.listAllInternalForOwner",
          "db.query",
          async () => {
            const db = await getTenantDB();
            return await db
              .select({
                noteId: tenantTables.notesDataKeys.noteId,
                noteTitle: tenantTables.notes.title,
                sharedWithUserId: tenantTables.notesDataKeys.userId,
                sharedWithEmail: tenantTables.userProfiles.email,
                sharedWithFirstName: tenantTables.userProfiles.firstName,
                sharedWithLastName: tenantTables.userProfiles.lastName,
                permissionLevel: tenantTables.notesDataKeys.permissionLevel,
                grantedAt: tenantTables.notesDataKeys.grantedAt,
              })
              .from(tenantTables.notesDataKeys)
              .innerJoin(
                tenantTables.notes,
                eq(tenantTables.notesDataKeys.noteId, tenantTables.notes.id),
              )
              .innerJoin(
                tenantTables.userProfiles,
                eq(tenantTables.notesDataKeys.userId, tenantTables.userProfiles.userId),
              )
              .where(
                and(
                  eq(tenantTables.notesDataKeys.grantedBy, userId),
                  eq(tenantTables.notesDataKeys.isPublicShare, false),
                  eq(tenantTables.notesDataKeys.isActive, true),
                  ne(tenantTables.notesDataKeys.userId, userId),
                ),
              );
          },
        );

        return rows.map((r) => ({
          noteId: r.noteId,
          noteTitle: r.noteTitle,
          sharedWithUserId: r.sharedWithUserId,
          sharedWithEmail: r.sharedWithEmail,
          sharedWithName: `${r.sharedWithFirstName ?? ""} ${r.sharedWithLastName ?? ""}`.trim(),
          permissionLevel: r.permissionLevel,
          grantedAt: typeof r.grantedAt === "number" ? r.grantedAt : new Date(r.grantedAt).getTime(),
        }));
      },
    );
  }
}
