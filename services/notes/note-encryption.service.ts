/**
 * @file services/notes/note-encryption.service.ts
 * @description Notes wrapper around the generic EncryptionSharingService,
 * bound to the notes_data_keys table. Used in Plan B for sharing flows;
 * Plan A wires the singleton in place so dependents can stabilize early.
 */

import { tenantTables } from "@db/index.ts";
import { EncryptionSharingService } from "@services/encryption/encryption-sharing.service.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import type { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";

export class NoteEncryptionService {
  private inner: EncryptionSharingService;

  constructor() {
    this.inner = new EncryptionSharingService({
      tableName: tenantTables.notesDataKeys,
      resourceIdColumn: "noteId",
    });
  }

  async getEncryptionMode(noteId: string): Promise<string> {
    return await tracedWithServiceErrorHandling(
      "NoteEncryption.getEncryptionMode",
      {
        service: "NoteEncryption",
        method: "getEncryptionMode",
        section: loggerAppSections.NOTES,
        details: { noteId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        return await this.inner.getEncryptionMode(noteId);
      },
    );
  }

  async shareAppEncrypted(
    noteId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteEncryption.shareAppEncrypted",
      {
        service: "NoteEncryption",
        method: "shareAppEncrypted",
        section: loggerAppSections.NOTES,
        details: { noteId, fromUserId, toUserId, permissionLevel },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = toUserId;
        await this.inner.shareAppEncrypted(noteId, fromUserId, toUserId, permissionLevel);
      },
    );
  }

  async shareUserEncrypted(
    noteId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
    ownerUserMasterKey: Uint8Array,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteEncryption.shareUserEncrypted",
      {
        service: "NoteEncryption",
        method: "shareUserEncrypted",
        section: loggerAppSections.NOTES,
        details: { noteId, fromUserId, toUserId, permissionLevel },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = toUserId;
        await this.inner.shareUserEncrypted(
          noteId,
          fromUserId,
          toUserId,
          permissionLevel,
          ownerUserMasterKey,
        );
      },
    );
  }

  async batchShare(
    noteIds: string[],
    fromUserId: string,
    toUserId: string,
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<unknown[]> {
    return await tracedWithServiceErrorHandling(
      "NoteEncryption.batchShare",
      {
        service: "NoteEncryption",
        method: "batchShare",
        section: loggerAppSections.NOTES,
        details: { noteIds, fromUserId, toUserId, permissionLevel },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.ids"] = noteIds;
        span.attributes["user.id"] = fromUserId;
        span.attributes["target_user.id"] = toUserId;
        return await this.inner.batchShare(
          noteIds,
          fromUserId,
          toUserId,
          permissionLevel,
          ownerUserMasterKey,
        );
      },
    );
  }
}
