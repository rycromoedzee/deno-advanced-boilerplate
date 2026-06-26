/**
 * @file db/schema/tenant/notes-core.ts
 * @description Notes Core table schema for the tenant database
 */
import { blob, boolean, createdAtTimestamp, dbTable, index, integer, text, updatedAtTimestamp } from "../../entities.ts";
import { relations } from "drizzle-orm";
import { userProfiles } from "./iam.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "../../enums/index.ts";

export const noteCollections = dbTable("note_collections", {
  id: text("id").primaryKey().notNull(),
  ownerId: text("owner_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  color: text("color"),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: integer("archived_at"),
  metadata: text("metadata", { mode: "json" }),
  autoShareNewContent: boolean("auto_share_new_content").notNull().default(false),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (t) => [
  index("idx_note_collections_owner").on(t.ownerId),
  index("idx_note_collections_owner_archived").on(t.ownerId, t.isArchived),
]);

export const notes = dbTable("notes", {
  id: text("id").primaryKey().notNull(),
  ownerId: text("owner_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  collectionId: text("collection_id").references(() => noteCollections.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: integer("archived_at"),
  isPinned: boolean("is_pinned").notNull().default(false),
  lastVersionId: text("last_version_id"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (t) => [
  index("idx_notes_owner").on(t.ownerId),
  index("idx_notes_owner_archived").on(t.ownerId, t.isArchived),
  index("idx_notes_collection").on(t.collectionId),
  index("idx_notes_owner_pinned").on(t.ownerId, t.isPinned),
]);

export const noteVersions = dbTable("note_versions", {
  id: text("id").primaryKey().notNull(),
  noteId: text("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => userProfiles.userId, { onDelete: "set null" }),
  bodyCiphertext: blob("body_ciphertext").notNull(),
  bodyIv: blob("body_iv").notNull(),
  createdAt: createdAtTimestamp(),
}, (t) => [
  index("idx_note_versions_note").on(t.noteId),
  index("idx_note_versions_note_created").on(t.noteId, t.createdAt),
  index("idx_note_versions_note_author_created").on(t.noteId, t.authorId, t.createdAt),
]);

export const noteCollectionsRelations = relations(noteCollections, ({ many, one }) => ({
  notes: many(notes),
  owner: one(userProfiles, { fields: [noteCollections.ownerId], references: [userProfiles.userId] }),
  sharedUsers: many(noteCollectionsSharedUsers),
}));

export const noteCollectionsSharedUsers = dbTable("note_collection_shared_users", {
  id: text("id").primaryKey().notNull(),
  collectionId: text("collection_id").notNull().references(() => noteCollections.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  permissionLevel: text("permission_level").notNull().default(DB_ENUM_PERMISSION_ACCESS_LEVEL.READ),
  grantedById: text("granted_by_id").notNull(),
  grantedByName: text("granted_by_name"),
  grantedAt: integer("granted_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (t) => [
  index("idx_note_coll_shared_users_unique").on(t.collectionId, t.userId),
  index("idx_note_coll_shared_users_coll_user_active").on(t.collectionId, t.userId, t.isActive),
  index("idx_note_coll_shared_users_user_id").on(t.userId),
  index("idx_note_coll_shared_users_user_active").on(t.userId, t.isActive),
]);

export const noteCollectionsSharedUsersRelations = relations(noteCollectionsSharedUsers, ({ one }) => ({
  collection: one(noteCollections, {
    fields: [noteCollectionsSharedUsers.collectionId],
    references: [noteCollections.id],
  }),
  user: one(userProfiles, {
    fields: [noteCollectionsSharedUsers.userId],
    references: [userProfiles.userId],
  }),
}));

export const notesRelations = relations(notes, ({ one, many }) => ({
  owner: one(userProfiles, { fields: [notes.ownerId], references: [userProfiles.userId] }),
  collection: one(noteCollections, { fields: [notes.collectionId], references: [noteCollections.id] }),
  versions: many(noteVersions),
}));

export const noteVersionsRelations = relations(noteVersions, ({ one }) => ({
  note: one(notes, { fields: [noteVersions.noteId], references: [notes.id] }),
  author: one(userProfiles, { fields: [noteVersions.authorId], references: [userProfiles.userId] }),
}));
