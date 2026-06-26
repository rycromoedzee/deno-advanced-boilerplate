/**
 * @file services/notes-attachments/note-attachment-permission.service.ts
 * @description Permission service bound to note_attachments_data_keys.
 * Mirrors NotePermissionService but on the attachments data-key table.
 */

import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { PermissionService } from "@services/encryption/permission.service.ts";
import { tenantTables } from "@db/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";

const ATTACHMENT_TABLE_CONFIG = {
  tableName: tenantTables.noteAttachmentsDataKeys,
  resourceIdColumn: "noteAttachmentId",
} as const;

export class NoteAttachmentPermissionService {
  private permissionService: PermissionService;

  constructor() {
    this.permissionService = new PermissionService(ATTACHMENT_TABLE_CONFIG);
  }

  async checkAccess(
    attachmentId: string,
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachmentPermission.checkAccess",
      {
        service: "NoteAttachmentPermission",
        method: "checkAccess",
        section: loggerAppSections.NOTES,
        details: { attachmentId, userId, requiredPermission },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["attachment.id"] = attachmentId;
        span.attributes["user.id"] = userId;
        return await this.permissionService.checkAccess(
          attachmentId,
          userId,
          requiredPermission,
        );
      },
    );
  }

  async hasAnyAccess(attachmentId: string, userId: string): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "NoteAttachmentPermission.hasAnyAccess",
      {
        service: "NoteAttachmentPermission",
        method: "hasAnyAccess",
        section: loggerAppSections.NOTES,
        details: { attachmentId, userId },
      },
      "NOTE_ATTACHMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["attachment.id"] = attachmentId;
        span.attributes["user.id"] = userId;
        return await this.permissionService.hasAnyAccess(attachmentId, userId);
      },
    );
  }
}
