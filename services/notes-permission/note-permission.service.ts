/**
 * @file services/notes-permission/note-permission.service.ts
 * @description Note-specific permission service — wraps the generic
 * PermissionService bound to notes_data_keys. No cache adapter: every
 * check goes straight to the DB. If duplicate hot-path checks are ever
 * profiled, build on @services/cache/GlobalCacheService (the pattern
 * documents use) — do not re-introduce a bespoke per-process Map.
 */

import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { PermissionService } from "@services/encryption/permission.service.ts";
import { tenantTables } from "@db/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";

const NOTE_TABLE_CONFIG = {
  tableName: tenantTables.notesDataKeys,
  resourceIdColumn: "noteId",
} as const;

export class NotePermissionService {
  private permissionService: PermissionService;

  constructor() {
    this.permissionService = new PermissionService(NOTE_TABLE_CONFIG);
  }

  async checkAccess(
    noteId: string,
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "NotePermission.checkAccess",
      {
        service: "NotePermission",
        method: "checkAccess",
        section: loggerAppSections.NOTES,
        details: { noteId, userId, requiredPermission },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;
        return await this.permissionService.checkAccess(
          noteId,
          userId,
          requiredPermission,
        );
      },
    );
  }

  async getAccessLevel(
    noteId: string,
    userId: string,
  ): Promise<DB_ENUM_PERMISSION_ACCESS_LEVEL | null> {
    return await tracedWithServiceErrorHandling(
      "NotePermission.getAccessLevel",
      {
        service: "NotePermission",
        method: "getAccessLevel",
        section: loggerAppSections.NOTES,
        details: { noteId, userId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;
        return await this.permissionService.getAccessLevel(noteId, userId);
      },
    );
  }

  async hasPermission(
    noteId: string,
    userId: string,
    permission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "NotePermission.hasPermission",
      {
        service: "NotePermission",
        method: "hasPermission",
        section: loggerAppSections.NOTES,
        details: { noteId, userId, permission },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;
        return await this.checkAccess(noteId, userId, permission);
      },
    );
  }

  async hasAnyAccess(noteId: string, userId: string): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "NotePermission.hasAnyAccess",
      {
        service: "NotePermission",
        method: "hasAnyAccess",
        section: loggerAppSections.NOTES,
        details: { noteId, userId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;
        return await this.permissionService.hasAnyAccess(noteId, userId);
      },
    );
  }

  async batchCheckAccess(
    noteIds: string[],
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<Map<string, boolean>> {
    return await tracedWithServiceErrorHandling(
      "NotePermission.batchCheckAccess",
      {
        service: "NotePermission",
        method: "batchCheckAccess",
        section: loggerAppSections.NOTES,
        details: { noteIds, userId, requiredPermission },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.ids"] = noteIds;
        span.attributes["user.id"] = userId;
        return await this.permissionService.batchCheckAccess(
          noteIds,
          userId,
          requiredPermission,
        );
      },
    );
  }

  async batchGetAccessLevels(
    noteIds: string[],
    userId: string,
  ): Promise<Map<string, DB_ENUM_PERMISSION_ACCESS_LEVEL | null>> {
    return await tracedWithServiceErrorHandling(
      "NotePermission.batchGetAccessLevels",
      {
        service: "NotePermission",
        method: "batchGetAccessLevels",
        section: loggerAppSections.NOTES,
        details: { noteIds, userId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.ids"] = noteIds;
        span.attributes["user.id"] = userId;
        return await this.permissionService.batchGetAccessLevels(noteIds, userId);
      },
    );
  }
}
