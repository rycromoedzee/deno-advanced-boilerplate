/**
 * @file services/notes-versions/version-read.service.ts
 * @description Version Read service (notes versions)
 */
import { and, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { useSymmetricDecrypt } from "@services/encryption/encryption.helper.ts";
import { getNotePermissionService } from "@services/notes-permission/singletons.ts";
import type { INoteVersionDetail } from "@models/notes/note-version.model.ts";
import { TEXT_DECODER, toVersionMeta, unwrapNoteMasterKey } from "./version-crud.helpers.ts";

export class VersionReadService {
  async getDetail(
    noteId: string,
    versionId: string,
    userId: string,
    environmentId: string,
    userMasterKey: Uint8Array,
  ): Promise<INoteVersionDetail | null> {
    return await tracedWithServiceErrorHandling(
      "NoteVersion.getDetail",
      {
        service: "NoteVersion",
        method: "getDetail",
        section: loggerAppSections.NOTES,
        details: { noteId, versionId, userId, environmentId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["version.id"] = versionId;
        span.attributes["user.id"] = userId;
        const allowed = await getNotePermissionService().checkAccess(
          noteId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );
        if (!allowed) throwHttpError("NOTE.ACCESS_DENIED");

        const row = await traced("db.noteVersion.getDetail", "db.query", async () => {
          const db = await getTenantDB();
          const rows = await db
            .select()
            .from(tenantTables.noteVersions)
            .where(
              and(
                eq(tenantTables.noteVersions.noteId, noteId),
                eq(tenantTables.noteVersions.id, versionId),
              ),
            )
            .limit(1);
          return rows[0] ?? null;
        });
        if (!row) return null;

        const noteMasterKey = await unwrapNoteMasterKey(noteId, userId, userMasterKey);
        const plaintextBytes = await useSymmetricDecrypt({
          key: noteMasterKey,
          data: row.bodyCiphertext as Uint8Array,
          nonce: row.bodyIv as Uint8Array,
          hasNonce: false,
        });
        const body = TEXT_DECODER.decode(plaintextBytes);
        // Zero the unwrapped per-note master key and the plaintext byte buffer.
        // The decoded `body` string lives in the JS heap and cannot be zeroed,
        // but the byte-level material can be — shortens recovery window.
        noteMasterKey.fill(0);
        plaintextBytes.fill(0);

        return {
          ...toVersionMeta(row),
          body,
        };
      },
    );
  }
}
