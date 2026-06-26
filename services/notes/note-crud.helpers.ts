/**
 * @file services/notes/note-crud.helpers.ts
 * @description Helpers shared across the split note services.
 */

import { eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { traced } from "@services/tracing/index.ts";

/**
 * Verifies that `userId` owns `noteId`. Returns 404 (not 403) for both
 * "missing" and "not owner" to prevent information disclosure.
 */
export async function requireNoteOwner(
  noteId: string,
  userId: string,
): Promise<void> {
  await traced("note.helper.requireNoteOwner", "db.query", async (span) => {
    span.attributes["note.id"] = noteId;
    span.attributes["user.id"] = userId;
    const db = await getTenantDB();
    const rows = await db
      .select({ ownerId: tenantTables.notes.ownerId })
      .from(tenantTables.notes)
      .where(eq(tenantTables.notes.id, noteId))
      .limit(1);
    if (!rows[0] || rows[0].ownerId !== userId) {
      throwHttpError("COMMON.NOT_FOUND");
    }
  });
}
