/**
 * @file db/schema/tenant/encryption.ts
 * @description Encryption table schema for the tenant database
 */
import { blobType, boolean, createdAtTimestamp, dbTable, index, integer, text, updatedAtTimestamp } from "../../entities.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL } from "../../enums/index.ts";
import { documents } from "./documents.ts";
import { userProfiles } from "./iam.ts";
import { noteAttachments } from "../tenant/notes-attachments.ts";
import { notes } from "../tenant/notes-core.ts";
import { relations } from "drizzle-orm";

export const documentsDataKeys = dbTable("documents_data_keys", {
  id: text("id").primaryKey().notNull(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => userProfiles.userId, { onDelete: "cascade" }),
  encryptedMasterKey: blobType("encrypted_master_key").notNull(),
  thumbnailEncryptedMasterKey: blobType("thumbnail_encrypted_master_key"),
  encryptionMode: text("encryption_mode").notNull().default(DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED),
  permissionLevel: text("permission_level").notNull().default(DB_ENUM_PERMISSION_ACCESS_LEVEL.READ),
  isActive: boolean("is_active").notNull().default(true),
  keyVersion: integer("key_version").notNull().default(1),
  isPublicShare: boolean("is_public_share").notNull().default(false),
  publicShareToken: text("public_share_token").unique(),
  publicShareExpiresAt: integer("public_share_expires_at"),
  sharerEncryptedShareKey: blobType("sharer_encrypted_share_key"),
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  recipientLanguage: text("recipient_language").default("en"),
  isPasswordProtected: boolean("is_password_protected").notNull().default(false),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: integer("last_accessed_at"),
  notifyOnAccess: boolean("notify_on_access").notNull().default(false),
  grantedAt: integer("granted_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  revokedAt: integer("revoked_at"),
  grantedBy: text("granted_by"),
  grantedByName: text("granted_by_name"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_documents_data_keys_document_id").on(table.documentId),
  index("idx_documents_data_keys_document_user").on(table.documentId, table.userId),
  index("idx_documents_data_keys_document_user_active").on(table.documentId, table.userId, table.isActive),
  index("idx_documents_data_keys_user_id").on(table.userId),
  index("idx_documents_data_keys_granted_by_active").on(table.grantedBy, table.isActive),
]);

export const notesDataKeys = dbTable("notes_data_keys", {
  id: text("id").primaryKey().notNull(),
  noteId: text("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => userProfiles.userId, { onDelete: "cascade" }),
  encryptedMasterKey: blobType("encrypted_master_key").notNull(),
  encryptionMode: text("encryption_mode").notNull().default(DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED),
  permissionLevel: text("permission_level").notNull().default(DB_ENUM_PERMISSION_ACCESS_LEVEL.READ),
  isActive: boolean("is_active").notNull().default(true),
  keyVersion: integer("key_version").notNull().default(1),
  isPublicShare: boolean("is_public_share").notNull().default(false),
  publicShareToken: text("public_share_token").unique(),
  publicShareExpiresAt: integer("public_share_expires_at"),
  sharerEncryptedShareKey: blobType("sharer_encrypted_share_key"),
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  recipientLanguage: text("recipient_language").default("en"),
  isPasswordProtected: boolean("is_password_protected").notNull().default(false),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: integer("last_accessed_at"),
  notifyOnAccess: boolean("notify_on_access").notNull().default(false),
  grantedAt: integer("granted_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  revokedAt: integer("revoked_at"),
  grantedBy: text("granted_by"),
  grantedByName: text("granted_by_name"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (t) => [
  index("idx_notes_data_keys_note_id").on(t.noteId),
  index("idx_notes_data_keys_note_user").on(t.noteId, t.userId),
  index("idx_notes_data_keys_note_user_active").on(t.noteId, t.userId, t.isActive),
  index("idx_notes_data_keys_user_id").on(t.userId),
  index("idx_notes_data_keys_user_active").on(t.userId, t.isActive),
  index("idx_notes_data_keys_granted_by_active").on(t.grantedBy, t.isActive),
]);

export const noteAttachmentsDataKeys = dbTable("note_attachments_data_keys", {
  id: text("id").primaryKey().notNull(),
  noteAttachmentId: text("note_attachment_id").notNull().references(() => noteAttachments.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => userProfiles.userId, { onDelete: "cascade" }),
  encryptedMasterKey: blobType("encrypted_master_key").notNull(),
  encryptionMode: text("encryption_mode").notNull().default(DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED),
  permissionLevel: text("permission_level").notNull().default(DB_ENUM_PERMISSION_ACCESS_LEVEL.READ),
  isActive: boolean("is_active").notNull().default(true),
  keyVersion: integer("key_version").notNull().default(1),
  isPublicShare: boolean("is_public_share").notNull().default(false),
  publicShareToken: text("public_share_token").unique(),
  publicShareExpiresAt: integer("public_share_expires_at"),
  sharerEncryptedShareKey: blobType("sharer_encrypted_share_key"),
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  recipientLanguage: text("recipient_language").default("en"),
  isPasswordProtected: boolean("is_password_protected").notNull().default(false),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: integer("last_accessed_at"),
  notifyOnAccess: boolean("notify_on_access").notNull().default(false),
  grantedAt: integer("granted_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  revokedAt: integer("revoked_at"),
  grantedBy: text("granted_by"),
  grantedByName: text("granted_by_name"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (t) => [
  index("idx_note_attachments_data_keys_attachment_id").on(t.noteAttachmentId),
  index("idx_note_attachments_data_keys_attachment_user").on(t.noteAttachmentId, t.userId),
  index("idx_note_attachments_data_keys_attachment_user_active").on(t.noteAttachmentId, t.userId, t.isActive),
  index("idx_note_attachments_data_keys_user_id").on(t.userId),
]);

export const noteAttachmentsRelations = relations(noteAttachments, ({ one, many }) => ({
  note: one(notes, { fields: [noteAttachments.noteId], references: [notes.id] }),
  owner: one(userProfiles, { fields: [noteAttachments.ownerId], references: [userProfiles.userId] }),
  dataKeys: many(noteAttachmentsDataKeys),
}));

export const noteAttachmentsDataKeysRelations = relations(noteAttachmentsDataKeys, ({ one }) => ({
  attachment: one(noteAttachments, {
    fields: [noteAttachmentsDataKeys.noteAttachmentId],
    references: [noteAttachments.id],
  }),
  user: one(userProfiles, { fields: [noteAttachmentsDataKeys.userId], references: [userProfiles.userId] }),
}));
