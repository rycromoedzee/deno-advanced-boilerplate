/**
 * @file db/schema/tenant/notes-attachments.ts
 * @description Notes Attachments table schema for the tenant database
 */
import { blobType, createdAtTimestamp, dbTable, index, integer, text } from "../../entities.ts";
import { notes } from "./notes-core.ts";
import { userProfiles } from "./iam.ts";

export const noteAttachments = dbTable("note_attachments", {
  id: text("id").primaryKey().notNull(),
  noteId: text("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  mimeType: text("mime_type").notNull(),
  originalName: text("original_name").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storageKey: text("storage_key").notNull(),
  ivBlob: blobType("iv_blob"),
  // Object-storage backup state (DD2). NULL = needs backup; set to a unix-
  // seconds timestamp only after a confirmed upload (services/object-backup/).
  backedUpAt: integer("backed_up_at"),
  createdAt: createdAtTimestamp(),
}, (t) => [
  index("idx_note_attachments_note").on(t.noteId),
  index("idx_note_attachments_owner").on(t.ownerId),
  index("idx_note_attachments_backed_up_at").on(t.backedUpAt),
]);
