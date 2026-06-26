/**
 * @file db/schema/tenant/storage.ts
 * @description Storage table schema for the tenant database
 */
import { boolean, createdAtTimestamp, dbTable, index, integer, text, updatedAtTimestamp } from "../../entities.ts";

export const storageMetadata = dbTable("storage_metadata", {
  id: text("id").primaryKey().notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  originalFileSize: integer("original_file_size").notNull().default(0),
  encryptedFileSize: integer("encrypted_file_size").notNull().default(0),
  folderPath: text("folder_path").notNull(),
  userId: text("user_id").notNull(),
  encryptionChunkSize: integer("encryption_chunk_size").notNull().default(524288),
  contentHash: text("content_hash"),
  duplicateAllowed: boolean("duplicate_allowed").notNull().default(false),
  thumbnailPath: text("thumbnail_path"),
  thumbnailSize: integer("thumbnail_size"),
  thumbnailWidth: integer("thumbnail_width"),
  thumbnailHeight: integer("thumbnail_height"),
  // Object-storage backup state (DD2). Nullable: NULL = needs backup; set to a
  // unix-seconds timestamp ONLY after a confirmed upload (services/object-backup/).
  // A separate thumbnailBackedUpAt lets a failed thumbnail copy retry
  // independently without re-copying the already-backed-up main object.
  backedUpAt: integer("backed_up_at"),
  thumbnailBackedUpAt: integer("thumbnail_backed_up_at"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_storage_metadata_content_hash").on(table.contentHash),
  index("idx_storage_metadata_user_content_hash").on(table.userId, table.contentHash),
  index("idx_storage_metadata_backed_up_at").on(table.backedUpAt),
]);
