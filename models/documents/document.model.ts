/**
 * @file models/documents/document.model.ts
 * @description Document model/types
 */
import { z } from "@deps";
import { SCHEMA_VALIDATION_CONTENT_TYPE, SCHEMA_VALIDATION_METADATA, SCHEMA_VALIDATION_MIME_TYPE } from "@models/documents/common.model.ts";
import {
  SCHEMA_NULLABLE_TIMESTAMP,
  SCHEMA_VALIDATION_TIMESTAMP,
  SchemaPaginatedResponse,
  SchemaPaginationQuery,
} from "@models/shared.model.ts";
import { SchemaDocumentTagResponse } from "@models/documents/tag.model.ts";
import { SchemaDocumentCommentApiResponse } from "@models/documents/comment.model.ts";
import { SchemaDocumentAccessLogItem, SchemaDocumentSharedUser, SchemaPublicShareItem } from "@models/documents/document-sharing.model.ts";
import { tables } from "@db/index.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

/**
 * @file models/documents/document.model.ts
 * @description Document-related schemas and validation models
 * Contains Zod schemas for document CRUD operations
 */

/**
 * Document schema - standardized document database model
 * Matches the database schema exactly
 */
export const SchemaDocument = z.object({
  id: z.string().openapi({
    description: "Document identifier",
    example: "ij37qzl5ouk6jejr",
  }),
  name: z.string().openapi({
    description: "Display name of the document",
    example: "Q3 Financial Report.pdf",
  }),
  description: z.string().nullable().openapi({
    description: "Optional human-readable description",
    example: "Finalized Q3 consolidated financials",
  }),
  storageMetadataId: z.string().openapi({
    description: "Identifier of the associated storage metadata record",
    example: "sm_a1b2c3d4e5f6g7h8",
  }),
  folderId: z.string().nullable().openapi({
    description: "Parent folder ID, or null when the document is in the root",
    example: "dYY4qHC4otwc",
  }),
  ownerId: z.string().openapi({
    description: "CUID2 of the user who owns the document",
    example: "user_01h4m5g7k8n9p0q1r2s3t4",
  }),
  environmentId: z.string().openapi({
    description: "Tenant (environment) ID the document belongs to",
    example: "env_01h8xqzmw3vf2k6j9p7n4b5c",
  }),
  contentType: z.string().nullable().openapi({
    description: "Content category (pdf, image, video, ...) or null if unset",
    example: "pdf",
  }),
  isFavorite: z.boolean().openapi({
    description: "Whether the document is favorited by the owner",
    example: false,
  }),
  isArchived: z.boolean().openapi({
    description: "Whether the document is archived",
    example: false,
  }),
  archivedAt: SCHEMA_NULLABLE_TIMESTAMP,
  downloadCount: z.number().int().nonnegative().openapi({
    description: "Number of times the document has been downloaded",
    example: 12,
  }),
  viewCount: z.number().int().nonnegative().openapi({
    description: "Number of times the document detail view has been loaded",
    example: 47,
  }),
  lastAccessedAt: SCHEMA_NULLABLE_TIMESTAMP,
  metadata: SCHEMA_VALIDATION_METADATA,
  createdAt: SCHEMA_VALIDATION_TIMESTAMP,
  updatedAt: SCHEMA_VALIDATION_TIMESTAMP,
}) satisfies z.ZodType<typeof tables.documents.$inferSelect>;

export type IDocument = z.infer<typeof SchemaDocument>;

/**
 * Create document request schema
 */
export const SchemaDocumentCreateRequest = z.object({
  name: z.string()
    .min(1, withKey("documents.name-required", "Document name is required"))
    .max(255, withKey("documents.name-max-length", "Document name must be 255 characters or less"))
    .openapi({
      description: "Document name (1-255 characters)",
      example: "Q3 Financial Report.pdf",
    }),
  description: z.string()
    .max(1000, withKey("documents.description-max-length", "Description must be 1000 characters or less"))
    .optional()
    .nullable()
    .openapi({
      description: "Optional description (max 1000 characters)",
      example: "Finalized Q3 consolidated financials",
    }),
  folderId: z.string().optional().nullable().openapi({
    description: "Optional parent folder ID; omit or null for root",
    example: "dYY4qHC4otwc",
  }),
  contentType: SCHEMA_VALIDATION_CONTENT_TYPE,
  tags: z.array(
    z.union([
      z.string(), // "urgent"
      z.object({ id: z.string() }), // { id: "tag_123" }
      z.object({ name: z.string() }), // { name: "review" }
    ]),
  ).default([]).openapi({
    description: "Array of tags (strings, IDs, or names)",
    example: ["urgent", { id: "tag_123" }, { name: "review" }],
  }),
  metadata: SCHEMA_VALIDATION_METADATA,
});

export type ICreateDocumentInput = z.infer<typeof SchemaDocumentCreateRequest>;

/**
 * Update document request schema
 */
export const SchemaDocumentUpdateRequest = z.object({
  name: z.string()
    .min(1, withKey("documents.name-required", "Document name is required"))
    .max(255, withKey("documents.name-max-length", "Document name must be 255 characters or less"))
    .optional()
    .openapi({
      description: "Updated document name",
      example: "Q3 Financial Report (revised).pdf",
    }),
  description: z.string()
    .max(1000, withKey("documents.description-max-length", "Description must be 1000 characters or less"))
    .optional()
    .nullable()
    .openapi({
      description: "Updated description",
      example: "Revised Q3 consolidated financials",
    }),
  folderId: z.string().optional().nullable().openapi({
    description: "Updated parent folder ID; null to move to root",
    example: "dYY4qHC4otwc",
  }),
  tags: z.array(
    z.union([
      z.string(),
      z.object({ id: z.string() }),
      z.object({ name: z.string() }),
    ]),
  ).optional().openapi({
    description: "Updated array of tags (replaces existing tags)",
    example: ["urgent", { id: "tag_123" }],
  }),
  metadata: SCHEMA_VALIDATION_METADATA.optional(),
});

export type IUpdateDocumentInput = z.infer<typeof SchemaDocumentUpdateRequest>;

/**
 * Document response schema - standardized document API response
 * Derived from SchemaDocument, excluding internal fields and adding populated tags
 * This is the simplified version used for list endpoints and general document operations
 */
export const SchemaDocumentResponse = SchemaDocument.pick({
  id: true,
  name: true,
  description: true,
  folderId: true,
  ownerId: true,
  contentType: true,
  isArchived: true,
  archivedAt: true,
  isFavorite: true,
  downloadCount: true,
  viewCount: true,
  lastAccessedAt: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  tags: z.array(SchemaDocumentTagResponse).default([]).openapi({
    description: "Populated tag objects with full metadata",
  }),
  folderName: z.string().nullable().openapi({
    description: "Name of the folder containing the document",
    example: "Finance",
  }),
  ownerName: z.string().openapi({
    description: "Full name of the document owner (firstName lastName)",
    example: "Jane Doe",
  }),
  thumbnailUrl: z.string().nullable().openapi({
    description: "URL to the document thumbnail preview (null if no thumbnail available)",
    example: "/api/documents/doc_123/preview",
  }),
  originalFileSize: z.number().int().nonnegative().nullable().openapi({
    description: "Original file size in bytes (before encryption)",
    example: 1024000,
  }),
});

export type IDocumentResponse = z.infer<typeof SchemaDocumentResponse>;

/**
 * Document detailed response schema - extends SchemaDocumentResponse with comments, access logs, and shared users
 * Used for detailed document retrieval endpoints (e.g., GET /api/documents/{id})
 */
export const SchemaDocumentDetailedResponse = SchemaDocumentResponse.extend({
  comments: z.array(SchemaDocumentCommentApiResponse).openapi({
    description: "Threaded comments for the document",
  }),
  accessLogs: z.array(SchemaDocumentAccessLogItem).openapi({
    description: "All access logs for the document",
  }),
  sharedUsers: z.array(SchemaDocumentSharedUser).openapi({
    description: "Users with whom the document is shared",
  }),
  publicShares: z.array(SchemaPublicShareItem).openapi({
    description: "Public shares for the document",
  }),
});

export type IDocumentDetailedResponse = z.infer<typeof SchemaDocumentDetailedResponse>;

/**
 * Paginated document list response schema
 */
export const SchemaDocumentListResponse = SchemaPaginatedResponse(SchemaDocumentResponse);

export type IDocumentListResponse = z.infer<typeof SchemaDocumentListResponse>;

/**
 * Document list query schema - for filtering and pagination
 */
export const SchemaDocumentListQuery = SchemaPaginationQuery.extend({
  folderId: z.string().optional().nullable().transform((val) => {
    // When not provided (undefined), return undefined to apply no filter
    if (val === undefined) return undefined;
    // When explicitly set to null, empty string, or string 'null', return null to filter for documents without a folder
    if (val === null || val === "" || val === "null") return null;
    // Otherwise return the actual folder ID
    return val;
  }).openapi({
    description:
      "Filter by folder ID. Omit to show all documents. Use 'null' or empty string for documents without a folder. Provide a folder ID to filter by specific folder.",
    example: null,
  }),
  tags: z.string().optional(), // Comma-separated tag list
  contentType: SCHEMA_VALIDATION_CONTENT_TYPE,
  search: z.string()
    .max(255, withKey("documents.search-max-length", "Search query must be 255 characters or less"))
    .optional(),
  archived: z.enum(["true", "false", "both"]).default("false").openapi({
    description: "Filter by archive status: 'true' for archived only, 'false' for non-archived only, 'both' for all",
    example: "false",
  }),
  isFavorited: z.string().default("false").transform((val) => val === "true"),
});

export type IDocumentListQuery = z.infer<typeof SchemaDocumentListQuery>;

/**
 * File upload metadata request schema
 */
export const SchemaDocumentFileUploadRequest = z.object({
  name: z.string()
    .min(1, withKey("documents.name-required", "Document name is required"))
    .max(255, withKey("documents.name-max-length", "Document name must be 255 characters or less")),
  description: z.string()
    .max(1000, withKey("documents.description-max-length", "Description must be 1000 characters or less"))
    .optional()
    .nullable(),
  folderId: z.string().optional().nullable(),
  mimeType: SCHEMA_VALIDATION_MIME_TYPE,
  fileSize: z.number()
    .int()
    .positive(withKey("documents.file-size-positive", "File size must be positive")),
  tags: z.array(
    z.union([
      z.string(),
      z.object({ id: z.string() }),
      z.object({ name: z.string() }),
    ]),
  ).default([]).openapi({
    description: "Array of tags for the uploaded file",
  }),
  metadata: SCHEMA_VALIDATION_METADATA,
});

export type IFileUploadMetadata = z.infer<typeof SchemaDocumentFileUploadRequest>;

/**
 * Move document request schema
 */
export const SchemaDocumentMoveRequest = z.object({
  targetFolderId: z.string().nullable().openapi({
    description: "Destination folder ID; null to move the document to root",
    example: "dYY4qHC4otwc",
  }),
  asyncMode: z.boolean().default(true).optional().openapi({
    description: "Enable async processing with SSE notifications (default: true)",
    example: true,
  }),
});

export type IMoveDocumentInput = z.infer<typeof SchemaDocumentMoveRequest>;

/**
 * Duplicate document request schema
 */
export const SchemaDocumentDuplicateRequest = z.object({
  name: z.string()
    .min(1, withKey("documents.name-required", "Document name is required"))
    .max(255, withKey("documents.name-max-length", "Document name must be 255 characters or less"))
    .optional()
    .openapi({
      description: "Name for the duplicate (defaults to the source name)",
      example: "Q3 Financial Report (copy).pdf",
    }),
  folderId: z.string().optional().nullable().openapi({
    description: "Destination folder ID for the duplicate; omit or null for root",
    example: "dYY4qHC4otwc",
  }),
});

export type IDuplicateDocumentInput = z.infer<typeof SchemaDocumentDuplicateRequest>;

/**
 * Archive document request schema
 */
export const SchemaDocumentArchiveRequest = z.object({
  isArchived: z.boolean().openapi({
    description: "true to archive the document, false to restore it",
    example: true,
  }),
});

export type IArchiveDocumentInput = z.infer<typeof SchemaDocumentArchiveRequest>;

/**
 * Bulk document operation request schema
 */
export const SchemaDocumentBulkOperationRequest = z.object({
  documentIds: z.array(z.string())
    .min(1, withKey("documents.bulk-min-documents", "At least 1 document required"))
    .max(100, withKey("documents.bulk-max-documents", "Maximum 100 documents allowed per operation"))
    .openapi({
      description: "Document IDs targeted by the bulk operation (1-100)",
      example: ["ij37qzl5ouk6jejr", "k8m2nq9wbp4rtxas"],
    }),
  operation: z.enum(["delete", "archive", "restore", "move"]).openapi({
    description: "Bulk operation to perform",
    example: "archive",
  }),
  targetFolderId: z.string().optional().nullable().openapi({
    description: "Destination folder ID (only for the 'move' operation); null for root",
    example: "dYY4qHC4otwc",
  }), // For move operation
});

export type IBulkDocumentOperation = z.infer<typeof SchemaDocumentBulkOperationRequest>;

/**
 * Document with storage metadata response schema
 * Extends SchemaDocumentResponse with populated storage metadata
 */
export const SchemaDocumentWithStorageResponse = SchemaDocumentResponse.extend({
  storageMetadata: z.object({
    id: z.string().openapi({
      description: "Storage metadata identifier",
      example: "sm_a1b2c3d4e5f6g7h8",
    }),
    originalName: z.string().openapi({
      description: "Original uploaded filename",
      example: "report.pdf",
    }),
    mimeType: z.string().openapi({
      description: "Detected MIME type of the stored file",
      example: "application/pdf",
    }),
    originalFileSize: z.number().int().nonnegative().openapi({
      description: "Original (pre-encryption) file size in bytes",
      example: 1024000,
    }),
    encryptedFileSize: z.number().int().nonnegative().openapi({
      description: "Encrypted file size in bytes",
      example: 1024512,
    }),
    folderPath: z.string().openapi({
      description: "Storage path of the parent folder",
      example: "env_01h8xqzmw3vf2k6j9p7n4b5c/documents/sm_a1b2c3d4e5f6g7h8",
    }),
    createdAt: SCHEMA_VALIDATION_TIMESTAMP,
    updatedAt: SCHEMA_VALIDATION_TIMESTAMP,
  }),
});

export type IDocumentWithStorage = z.infer<typeof SchemaDocumentWithStorageResponse>;
