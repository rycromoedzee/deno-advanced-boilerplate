/**
 * @file db/schema/tenant/documents.ts
 * @description Documents table schema for the tenant database
 */
import {
  blob,
  boolean,
  createdAtTimestamp,
  dbTable,
  index,
  integer,
  primaryKey,
  text,
  unique,
  updatedAtTimestamp,
} from "../../entities.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { relations } from "drizzle-orm";
import { storageMetadata } from "./storage.ts";
import { userProfiles } from "./iam.ts";

export const documentFolders = dbTable("document_folders", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  parentFolderId: text("parent_folder_id"),
  ownerId: text("owner_id").notNull().references(() => userProfiles.userId, { onDelete: "set null" }),
  color: text("color").default("#3b82f6"),
  icon: text("icon").default("folder"),
  isPublicShared: boolean("is_public_shared").notNull().default(false),
  publicShareToken: text("public_share_token").unique(),
  publicShareExpiresAt: integer("public_share_expires_at"),
  sharerEncryptedShareKey: blob("sharer_encrypted_share_key"),
  hasInternalSharing: boolean("has_internal_sharing").notNull().default(false),
  autoShareNewContent: boolean("auto_share_new_content").notNull().default(true),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: integer("archived_at"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_document_folders_parent_folder_id").on(table.parentFolderId),
  index("idx_document_folders_owner_archived").on(table.ownerId, table.isArchived),
  index("idx_document_folders_public_share_token").on(table.publicShareToken),
  index("idx_document_folders_env_parent_archived").on(table.parentFolderId, table.isArchived),
]);

export const documents = dbTable("documents", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  storageMetadataId: text("storage_metadata_id").notNull().references(() => storageMetadata.id, { onDelete: "restrict" }),
  folderId: text("folder_id").references(() => documentFolders.id, { onDelete: "set null" }),
  ownerId: text("owner_id").notNull(),
  contentType: text("content_type"),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: integer("archived_at"),
  downloadCount: integer("download_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  lastAccessedAt: integer("last_accessed_at"),
  metadata: text("metadata", { mode: "json" }).default("{}"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_documents_owner_id").on(table.ownerId),
  index("idx_documents_owner_archived").on(table.ownerId, table.isArchived),
  index("idx_documents_folder_id").on(table.folderId),
  index("idx_documents_folder_archived").on(table.folderId, table.isArchived),
  index("idx_documents_is_archived").on(table.isArchived),
]);

export const documentAccessLogs = dbTable("document_access_logs", {
  id: text("id").primaryKey().notNull(),
  documentId: text("document_id").references(() => documents.id, { onDelete: "cascade" }),
  folderId: text("folder_id").references(() => documentFolders.id, { onDelete: "cascade" }),
  dataKeyId: text("data_key_id"),
  userId: text("user_id"),
  accessType: text("access_type").notNull(),
  accessMethod: text("access_method").notNull(),
  changes: text("changes", { mode: "json" }),
  createdAt: createdAtTimestamp(),
}, (table) => [
  index("idx_document_access_logs_document_id").on(table.documentId),
  index("idx_document_access_logs_created_at").on(table.createdAt),
  index("idx_document_access_logs_user_id").on(table.userId),
]);

export const documentComments = dbTable("document_comments", {
  id: text("id").primaryKey().notNull(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  parentCommentId: text("parent_comment_id"),
  content: text("content").notNull(),
  authorId: text("author_id").notNull().references(() => userProfiles.userId, { onDelete: "set null" }),
  authorName: text("author_name"),
  isResolved: boolean("is_resolved").notNull().default(false),
  resolvedById: text("resolved_by_id"),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: integer("resolved_at"),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: integer("archived_at"),
  archivedById: text("archived_by_id"),
  archivedByName: text("archived_by_name"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_document_comments_document_id").on(table.documentId),
  index("idx_document_comments_parent_comment_id").on(table.parentCommentId),
]);

export const documentFavorites = dbTable("document_favorites", {
  userId: text("user_id").notNull(),
  documentId: text("document_id").references(() => documents.id, { onDelete: "cascade" }),
  folderId: text("folder_id").references(() => documentFolders.id, { onDelete: "cascade" }),
  createdAt: createdAtTimestamp(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.documentId, table.folderId] }),
]);

export const documentTags = dbTable("document_tags", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  color: text("color").default("#6b7280"),
  description: text("description"),
  userId: text("user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  createdById: text("created_by_id").notNull().references(() => userProfiles.userId, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_document_tags_user_id").on(table.userId),
  unique("uq_document_tags_user_name").on(table.userId, table.name),
]);

export const documentTagAssignments = dbTable("document_tag_assignments", {
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => documentTags.id, { onDelete: "cascade" }),
  assignedById: text("assigned_by_id").notNull(),
  assignedByName: text("assigned_by_name"),
  createdAt: createdAtTimestamp(),
}, (table) => [
  primaryKey({ columns: [table.documentId, table.tagId] }),
]);

export const documentFoldersSharedUsers = dbTable("folder_shared_users", {
  id: text("id").primaryKey().notNull(),
  folderId: text("folder_id").notNull().references(() => documentFolders.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  permissionLevel: text("permission_level").notNull().default(DB_ENUM_PERMISSION_ACCESS_LEVEL.READ),
  grantedById: text("granted_by_id").notNull(),
  grantedByName: text("granted_by_name"),
  grantedAt: integer("granted_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_folder_shared_users_unique").on(table.folderId, table.userId),
  index("idx_folder_shared_users_folder_user_active").on(table.folderId, table.userId, table.isActive),
  index("idx_folder_shared_users_user_id").on(table.userId),
  index("idx_folder_shared_users_user_active").on(table.userId, table.isActive),
]);

export const folderAccessLogs = dbTable("folder_access_logs", {
  id: text("id").primaryKey().notNull(),
  folderId: text("folder_id").notNull().references(() => documentFolders.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  accessType: text("access_type").notNull(),
  accessMethod: text("access_method").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  referer: text("referer"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: createdAtTimestamp(),
}, (table) => [
  index("idx_folder_access_logs_folder_id").on(table.folderId),
  index("idx_folder_access_logs_user_id").on(table.userId),
]);

export const documentMetadataSchemas = dbTable("document_metadata_schemas", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  key: text("key").notNull(),
  type: text("type").notNull(),
  isRequired: boolean("is_required").notNull().default(false),
  defaultValue: text("default_value"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_document_metadata_schemas_user_id").on(table.userId),
  index("idx_document_metadata_schemas_user_key").on(table.userId, table.key),
]);

// Relations
export const documentFoldersRelations = relations(documentFolders, ({ one, many }) => ({
  parentFolder: one(documentFolders, {
    fields: [documentFolders.parentFolderId],
    references: [documentFolders.id],
  }),
  subFolders: many(documentFolders),
  documents: many(documents),
  accessLogs: many(documentAccessLogs),
  folderAccessLogs: many(folderAccessLogs),
  favorites: many(documentFavorites),
  sharedUsers: many(documentFoldersSharedUsers),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  folder: one(documentFolders, {
    fields: [documents.folderId],
    references: [documentFolders.id],
  }),
  storageMetadata: one(storageMetadata, {
    fields: [documents.storageMetadataId],
    references: [storageMetadata.id],
  }),
  accessLogs: many(documentAccessLogs),
  comments: many(documentComments),
  favorites: many(documentFavorites),
  tagAssignments: many(documentTagAssignments),
}));

export const documentAccessLogsRelations = relations(documentAccessLogs, ({ one }) => ({
  document: one(documents, {
    fields: [documentAccessLogs.documentId],
    references: [documents.id],
  }),
  folder: one(documentFolders, {
    fields: [documentAccessLogs.folderId],
    references: [documentFolders.id],
  }),
}));

export const documentCommentsRelations = relations(documentComments, ({ one, many }) => ({
  document: one(documents, {
    fields: [documentComments.documentId],
    references: [documents.id],
  }),
  parentComment: one(documentComments, {
    fields: [documentComments.parentCommentId],
    references: [documentComments.id],
  }),
  replies: many(documentComments),
}));

export const documentFavoritesRelations = relations(documentFavorites, ({ one }) => ({
  document: one(documents, {
    fields: [documentFavorites.documentId],
    references: [documents.id],
  }),
  folder: one(documentFolders, {
    fields: [documentFavorites.folderId],
    references: [documentFolders.id],
  }),
}));

export const documentTagsRelations = relations(documentTags, ({ many }) => ({
  assignments: many(documentTagAssignments),
}));

export const documentTagAssignmentsRelations = relations(documentTagAssignments, ({ one }) => ({
  document: one(documents, {
    fields: [documentTagAssignments.documentId],
    references: [documents.id],
  }),
  tag: one(documentTags, {
    fields: [documentTagAssignments.tagId],
    references: [documentTags.id],
  }),
}));

export const documentFoldersSharedUsersRelations = relations(documentFoldersSharedUsers, ({ one }) => ({
  folder: one(documentFolders, {
    fields: [documentFoldersSharedUsers.folderId],
    references: [documentFolders.id],
  }),
}));

export const folderAccessLogsRelations = relations(folderAccessLogs, ({ one }) => ({
  folder: one(documentFolders, {
    fields: [folderAccessLogs.folderId],
    references: [documentFolders.id],
  }),
}));
