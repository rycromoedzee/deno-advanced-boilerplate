/**
 * @file db/schema/tenant/notes-tags.ts
 * @description Notes Tags table schema for the tenant database
 */
import { createdAtTimestamp, dbTable, index, integer, primaryKey, text, unique, updatedAtTimestamp } from "../../entities.ts";
import { relations } from "drizzle-orm";
import { notes } from "./notes-core.ts";
import { userProfiles } from "./iam.ts";

export const noteTags = dbTable("note_tags", {
  id: text("id").primaryKey().notNull(),
  ownerId: text("owner_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").default("#6b7280"),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (t) => [
  index("idx_note_tags_owner").on(t.ownerId),
  unique("uq_note_tags_owner_name").on(t.ownerId, t.name),
]);

export const tagsOnNotes = dbTable("tags_on_notes", {
  noteId: text("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => noteTags.id, { onDelete: "cascade" }),
  addedByUserId: text("added_by_user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  createdAt: createdAtTimestamp(),
}, (t) => [
  primaryKey({ columns: [t.noteId, t.tagId, t.addedByUserId] }),
  index("idx_tags_on_notes_note").on(t.noteId),
  index("idx_tags_on_notes_tag").on(t.tagId),
  index("idx_tags_on_notes_added_by").on(t.addedByUserId),
]);

export const noteTagsRelations = relations(noteTags, ({ many, one }) => ({
  owner: one(userProfiles, { fields: [noteTags.ownerId], references: [userProfiles.userId] }),
  assignments: many(tagsOnNotes),
}));

export const tagsOnNotesRelations = relations(tagsOnNotes, ({ one }) => ({
  note: one(notes, { fields: [tagsOnNotes.noteId], references: [notes.id] }),
  tag: one(noteTags, { fields: [tagsOnNotes.tagId], references: [noteTags.id] }),
  addedBy: one(userProfiles, { fields: [tagsOnNotes.addedByUserId], references: [userProfiles.userId] }),
}));
