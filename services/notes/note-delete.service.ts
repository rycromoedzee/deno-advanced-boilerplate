/**
 * @file services/notes/note-delete.service.ts
 * @description Note Delete service (notes)
 */
import { eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getNoteAttachmentService } from "@services/notes-attachments/singletons.ts";
import { requireNoteOwner } from "./note-crud.helpers.ts";

export class NoteDeleteService {
  async delete(id: string, userId: string, environmentId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NoteDelete.delete",
      {
        service: "NoteDelete",
        method: "delete",
        section: loggerAppSections.NOTES,
        details: { id, userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["note.id"] = id;
        await requireNoteOwner(id, userId);

        // Clean up attachment storage objects before the note row goes away.
        // FK cascade handles the attachment + data-key rows, but the bytes in
        // object storage are not covered by the cascade and would otherwise
        // be orphaned. deleteAllForNote is best-effort on storage failures.
        await getNoteAttachmentService().deleteAllForNote(id);

        await traced("db.note.delete", "db.query", async () => {
          const db = await getTenantDB();
          await db.delete(tenantTables.notes).where(eq(tenantTables.notes.id, id));
        });
      },
    );
  }
}
