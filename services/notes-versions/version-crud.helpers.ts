/**
 * @file services/notes-versions/version-crud.helpers.ts
 * @description Helpers shared across the split note-version services.
 */

import { and, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { traced } from "@services/tracing/index.ts";
import { useSymmetricDecrypt } from "@services/encryption/encryption.helper.ts";
import type { INoteVersionResponse } from "@models/notes/note-version.model.ts";

export const TEXT_ENCODER = new TextEncoder();
export const TEXT_DECODER = new TextDecoder();

export function toVersionMeta(
  r: typeof tenantTables.noteVersions.$inferSelect,
): INoteVersionResponse {
  return {
    id: r.id,
    noteId: r.noteId,
    authorId: r.authorId,
    createdAt: r.createdAt,
  };
}

export async function unwrapNoteMasterKey(
  noteId: string,
  userId: string,
  userMasterKey: Uint8Array,
): Promise<Uint8Array> {
  return await traced("note.unwrapMasterKey", "service", async (span) => {
    span.attributes["note.id"] = noteId;
    const db = await getTenantDB();
    const rows = await db
      .select({ encryptedMasterKey: tenantTables.notesDataKeys.encryptedMasterKey })
      .from(tenantTables.notesDataKeys)
      .where(
        and(
          eq(tenantTables.notesDataKeys.noteId, noteId),
          eq(tenantTables.notesDataKeys.userId, userId),
          eq(tenantTables.notesDataKeys.isActive, true),
        ),
      )
      .limit(1);
    if (!rows[0]) throwHttpError("NOTE.NOT_FOUND");
    const wrapped = rows[0].encryptedMasterKey as Uint8Array;
    if (!wrapped || wrapped.length === 0) {
      throwHttpError("NOTE.NOT_FOUND");
    }
    return await useSymmetricDecrypt({ key: userMasterKey, data: wrapped });
  });
}
