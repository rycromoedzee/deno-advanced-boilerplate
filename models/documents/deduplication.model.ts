import { z } from "@deps";
import { SCHEMA_VALIDATION_TIMESTAMP } from "@models/shared.model.ts";

/**
 * @file models/documents/deduplication.model.ts
 * @description Schemas for document de-duplication feature
 */

/**
 * A single document within a duplicate group
 */
export const SchemaDuplicateDocument = z.object({
  documentId: z.string().openapi({
    description: "The document ID",
    example: "doc_abc123",
  }),
  name: z.string().openapi({
    description: "User-friendly document name",
    example: "vacation-photo.jpg",
  }),
  description: z.string().nullable().openapi({
    description: "Document description",
    example: "Photo from summer vacation",
  }),
  mimeType: z.string().openapi({
    description: "MIME type of the file",
    example: "image/jpeg",
  }),
  originalName: z.string().openapi({
    description: "Original file name at upload time",
    example: "IMG_1234.jpg",
  }),
  originalFileSize: z.number().int().nonnegative().openapi({
    description: "Original file size in bytes",
    example: 2048576,
  }),
  folderId: z.string().nullable().openapi({
    description: "ID of the folder containing this document",
    example: "folder_abc",
  }),
  folderName: z.string().nullable().openapi({
    description: "Name of the folder containing this document",
    example: "Summer 2024",
  }),
  isArchived: z.boolean().openapi({
    description: "Whether the document is archived",
    example: false,
  }),
  duplicateAllowed: z.boolean().openapi({
    description: "Whether this duplicate has been explicitly allowed by the user",
    example: false,
  }),
  createdAt: SCHEMA_VALIDATION_TIMESTAMP.openapi({
    description: "When the document was created",
  }),
  previewUrl: z.string().nullable().openapi({
    description: "URL for preview (only for images with thumbnails)",
    example: "/api/documents/doc_abc123/preview",
  }),
});

export type IDuplicateDocument = z.infer<typeof SchemaDuplicateDocument>;

/**
 * A group of documents that share the same content hash
 */
export const SchemaDuplicateGroup = z.object({
  contentHash: z.string().openapi({
    description: "SHA-256 hash of the file content",
    example: "a1b2c3d4e5f6...",
  }),
  originalFileSize: z.number().int().nonnegative().openapi({
    description: "File size in bytes (all files in group have same size)",
    example: 2048576,
  }),
  documents: z.array(SchemaDuplicateDocument).openapi({
    description: "List of documents with identical content",
  }),
});

export type IDuplicateGroup = z.infer<typeof SchemaDuplicateGroup>;

/**
 * Response for finding duplicates
 */
export const SchemaFindDuplicatesResponse = z.object({
  totalDuplicateGroups: z.number().int().nonnegative().openapi({
    description: "Total number of duplicate groups found",
    example: 5,
  }),
  totalDuplicateFiles: z.number().int().nonnegative().openapi({
    description: "Total number of duplicate files (excluding original in each group)",
    example: 12,
  }),
  potentialSavingsBytes: z.number().int().nonnegative().openapi({
    description: "Potential storage savings in bytes if duplicates are removed",
    example: 15728640,
  }),
  groups: z.array(SchemaDuplicateGroup).openapi({
    description: "List of duplicate groups",
  }),
});

export type IFindDuplicatesResponse = z.infer<typeof SchemaFindDuplicatesResponse>;

/**
 * Query parameters for finding duplicates
 */
export const SchemaFindDuplicatesQuery = z.object({
  includeArchived: z.string().default("false").transform((val) => val === "true").openapi({
    description: "Include archived documents in results",
    example: "false",
  }),
  excludeAllowed: z.string().default("true").transform((val) => val === "true").openapi({
    description: "Exclude documents marked as 'duplicate allowed'",
    example: "true",
  }),
});

export type IFindDuplicatesQuery = z.infer<typeof SchemaFindDuplicatesQuery>;

/**
 * Request for keeping a duplicate (marking as allowed)
 */
export const SchemaKeepDuplicateRequest = z.object({
  documentIds: z.array(z.string()).min(1).max(100).openapi({
    description: "List of document IDs to mark as allowed duplicates",
    example: ["doc_abc123", "doc_def456"],
  }),
});

export type IKeepDuplicateRequest = z.infer<typeof SchemaKeepDuplicateRequest>;

/**
 * Response for bulk keep operation
 */
export const SchemaKeepDuplicateResponse = z.object({
  success: z.number().int().nonnegative().openapi({
    description: "Number of documents successfully marked as allowed",
    example: 2,
  }),
  failed: z.number().int().nonnegative().openapi({
    description: "Number of documents that failed to be marked",
    example: 0,
  }),
});

export type IKeepDuplicateResponse = z.infer<typeof SchemaKeepDuplicateResponse>;
