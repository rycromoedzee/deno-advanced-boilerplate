/**
 * @file services/notes-versions/version-create.service.ts
 * @description Version Create service (notes versions)
 */
import { desc, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { generateIdForNoteVersion } from "@utils/database/id-generation/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";
import { useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { getNotePermissionService } from "@services/notes-permission/singletons.ts";
import type { INotePutBodyRequest, INoteVersionResponse } from "@models/notes/note-version.model.ts";
import { TEXT_ENCODER, toVersionMeta, unwrapNoteMasterKey } from "./version-crud.helpers.ts";

const DEBOUNCE_SECONDS = 5 * 60;

export class VersionCreateService {
  async putBody(
    noteId: string,
    input: INotePutBodyRequest,
    userId: string,
    environmentId: string,
    userMasterKey: Uint8Array,
  ): Promise<INoteVersionResponse> {
    return await tracedWithServiceErrorHandling(
      "NoteVersion.putBody",
      {
        service: "NoteVersion",
        method: "putBody",
        section: loggerAppSections.NOTES,
        details: { noteId, userId, environmentId },
      },
      "NOTE.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = noteId;
        span.attributes["user.id"] = userId;
        const allowed = await getNotePermissionService().checkAccess(
          noteId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
        );
        if (!allowed) throwHttpError("NOTE.ACCESS_DENIED");

        const noteMasterKey = await unwrapNoteMasterKey(noteId, userId, userMasterKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await useSymmetricEncrypt({
          key: noteMasterKey,
          data: TEXT_ENCODER.encode(input.body),
          nonce: iv,
          includeNonce: false,
        });
        // Zero the unwrapped per-note master key — encryption is done; no further
        // use in this request. Shortens the heap-recoverable window.
        noteMasterKey.fill(0);

        const db = await getTenantDB();
        const now = getTimeNowForStorage();

        const last = await traced("db.noteVersion.last", "db.query", async () =>
          await db
            .select()
            .from(tenantTables.noteVersions)
            .where(eq(tenantTables.noteVersions.noteId, noteId))
            .orderBy(desc(tenantTables.noteVersions.createdAt))
            .limit(1));
        const lastRow = last[0];
        const canCoalesce = lastRow &&
          lastRow.authorId === userId &&
          now - lastRow.createdAt < DEBOUNCE_SECONDS;

        let versionId: string;
        if (canCoalesce) {
          versionId = lastRow!.id;
          await traced("db.noteVersion.update", "db.query", async () => {
            await db
              .update(tenantTables.noteVersions)
              .set({ bodyCiphertext: ciphertext, bodyIv: iv })
              .where(eq(tenantTables.noteVersions.id, versionId));
          });
        } else {
          versionId = await traced("db.noteVersion.insert", "db.query", async () => {
            return await databaseCreateWithRetry(async (newId) => {
              await db.insert(tenantTables.noteVersions).values({
                id: newId,
                noteId,
                authorId: userId,
                bodyCiphertext: ciphertext,
                bodyIv: iv,
                createdAt: now,
              });
              return newId;
            }, generateIdForNoteVersion);
          });
        }

        await traced("db.note.lastVersionUpdate", "db.query", async () => {
          await db
            .update(tenantTables.notes)
            .set({ lastVersionId: versionId, updatedAt: now })
            .where(eq(tenantTables.notes.id, noteId));
        });

        const fetched = await traced("db.noteVersion.readBack", "db.query", async () => {
          const rows = await db
            .select()
            .from(tenantTables.noteVersions)
            .where(eq(tenantTables.noteVersions.id, versionId))
            .limit(1);
          return rows[0]!;
        });
        return toVersionMeta(fetched);
      },
    );
  }
}
