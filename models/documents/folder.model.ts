/**
 * @file models/documents/folder.model.ts
 * @description Folder model/types
 */
import { z } from "@deps";
import {
  SCHEMA_NULLABLE_TIMESTAMP,
  SCHEMA_VALIDATION_HEX_COLOR,
  SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP,
  SCHEMA_VALIDATION_TIMESTAMP,
  SchemaPaginationQuery,
} from "@models/shared.model.ts";
import { tables } from "@db/index.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

/**
 * @file models/documents/folder.model.ts
 * @description Folder-related schemas and validation models
 * Contains Zod schemas for folder CRUD operations and hierarchy management
 */

/**
 * Document folder schema - standardized document folder response
 */
export const SchemaDocumentFolder = z.object({
  id: z.string().openapi({ description: "Folder ID (CUID2)", example: "clx1m3k0a0000l8v2g7q9h3zp" }),
  name: z.string().openapi({ description: "Folder display name", example: "Projects" }),
  description: z.string().nullable().openapi({ description: "Optional folder description", example: "Q1 project deliverables" }),
  parentFolderId: z.string().nullable().openapi({
    description: "Parent folder ID, or null for a root-level folder",
    example: "clx1m3k0a0000l8v2g7q9h3zp",
  }),
  environmentId: z.string().openapi({ description: "Owning tenant (environment) ID", example: "clwz0q8h30000mpv2g7q9h3zp" }),
  ownerId: z.string().openapi({ description: "User ID of the folder owner", example: "clwz0q8h30000mpv2g7q9h3zp" }),
  color: z.string().openapi({ description: "Folder color (hex code)", example: "#3b82f6" }),
  icon: z.string().nullable().openapi({ description: "Optional folder icon identifier", example: "folder" }),
  isPublicShared: z.boolean().openapi({ description: "Whether the folder has an active public share", example: false }),
  publicShareToken: z.string().nullable().openapi({
    description: "Public share token, or null if not publicly shared",
    example: "abc123def456ghi789jkl012mno345pq",
  }),
  publicShareExpiresAt: SCHEMA_NULLABLE_TIMESTAMP,
  sharerEncryptedShareKey: z.instanceof(Uint8Array).nullable(),
  hasInternalSharing: z.boolean().openapi({ description: "Whether the folder is shared with any internal users", example: true }),
  autoShareNewContent: z.boolean().openapi({
    description: "Whether new content added to the folder is auto-shared with existing collaborators",
    example: false,
  }),
  isArchived: z.boolean().openapi({ description: "Whether the folder is archived", example: false }),
  archivedAt: SCHEMA_NULLABLE_TIMESTAMP,
  createdAt: SCHEMA_VALIDATION_TIMESTAMP,
  updatedAt: SCHEMA_VALIDATION_TIMESTAMP,
}) satisfies z.ZodType<typeof tables.documentFolders.$inferSelect>;

export type IDocumentFolder = z.infer<typeof SchemaDocumentFolder>;

/**
 * Create folder request schema
 */
export const SchemaFolderCreateRequest = z.object({
  name: z.string()
    .trim()
    .min(1, withKey("folders.name-required", "Folder name is required"))
    .max(255, withKey("folders.name-max-length", "Folder name must be 255 characters or less"))
    .openapi({ description: "Folder display name (1-255 characters)", example: "Projects" }),
  description: z.string()
    .trim()
    .max(1000, withKey("folders.description-max-length", "Description must be 1000 characters or less"))
    .optional()
    .nullable()
    .openapi({ description: "Optional folder description (max 1000 characters)", example: "Q1 project deliverables" }),
  parentFolderId: z.string().trim().optional().nullable().openapi({
    description: "Parent folder ID to nest under (omit or null for root)",
    example: "clx1m3k0a0000l8v2g7q9h3zp",
  }),
  color: SCHEMA_VALIDATION_HEX_COLOR.default("#3b82f6"),
  icon: z.string()
    .trim()
    .max(50, withKey("folders.icon-max-length", "Icon must be 50 characters or less"))
    .nullable()
    .openapi({ description: "Optional folder icon identifier (max 50 characters)", example: "folder" }),
});

export type ICreateFolderInput = z.infer<typeof SchemaFolderCreateRequest>;

/**
 * Update folder request schema
 */
export const SchemaFolderUpdateRequest = z.object({
  name: z.string()
    .trim()
    .min(1, withKey("folders.name-required", "Folder name is required"))
    .max(255, withKey("folders.name-max-length", "Folder name must be 255 characters or less"))
    .optional()
    .openapi({ description: "Folder display name (1-255 characters)", example: "Projects (2024)" }),
  description: z.string()
    .trim()
    .max(1000, withKey("folders.description-max-length", "Description must be 1000 characters or less"))
    .optional()
    .nullable()
    .openapi({ description: "Optional folder description (max 1000 characters)", example: "Updated Q1 deliverables" }),
  color: SCHEMA_VALIDATION_HEX_COLOR.optional(),
  icon: z.string()
    .trim()
    .max(50, withKey("folders.icon-max-length", "Icon must be 50 characters or less"))
    .optional()
    .openapi({ description: "Optional folder icon identifier (max 50 characters)", example: "folder-open" }),
});

export type IUpdateFolderInput = z.infer<typeof SchemaFolderUpdateRequest>;

/**
 * Document folder response schema - standardized document folder response
 * Derived from SchemaDocumentFolder, excluding internal/sharing fields
 */
export const SchemaDocumentFolderResponse = SchemaDocumentFolder.pick({
  id: true,
  name: true,
  description: true,
  parentFolderId: true,
  ownerId: true,
  color: true,
  icon: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});

export type IDocumentFolderResponse = z.infer<typeof SchemaDocumentFolderResponse>;

/**
 * Document folder with permissions response schema
 * Extends the base folder response to include user permission information
 */
export const SchemaDocumentFolderWithPermissionsResponse = SchemaDocumentFolderResponse.extend({
  userPermissionLevel: z.number().int().min(0).max(5).openapi({
    description: "User's effective permission level on this folder (0=READ, 1=COMMENT, 2=WRITE, 3=DOWNLOAD, 4=SHARE, 5=ADMIN)",
    example: 0,
  }),
  userPermissionString: z.string().openapi({
    description: "String representation of permission level for easier frontend usage",
    example: "read",
  }),
});

export type IDocumentFolderWithPermissions = z.infer<typeof SchemaDocumentFolderWithPermissionsResponse>;

/**
 * Non-recursive folder hierarchy schema for OpenAPI routes
 * Use this in route definitions to avoid lazy type issues
 */
export const SchemaFolderHierarchyApiResponse = SchemaDocumentFolderResponse.extend({
  children: z.array(z.any()).openapi({
    description: "Nested child folders (recursive structure)",
  }),
  documentCount: z.number().int().nonnegative().openapi({
    description: "Total number of documents in this folder and subfolders",
    example: 15,
  }),
  depth: z.number().int().nonnegative().openapi({
    description: "Depth level in folder hierarchy (0 for root)",
    example: 2,
  }),
});

export type IFolderHierarchy = z.infer<typeof SchemaDocumentFolderResponse> & {
  children: IFolderHierarchy[];
  documentCount: number;
  depth: number;
};

/**
 * Folder path item schema - for breadcrumb navigation
 */
export const SchemaFolderPathItem = z.object({
  id: z.string().openapi({ description: "Folder ID in the breadcrumb path", example: "clx1m3k0a0000l8v2g7q9h3zp" }),
  name: z.string().openapi({ description: "Folder name in the breadcrumb path", example: "Projects" }),
  parentFolderId: z.string().nullable().openapi({
    description: "Parent folder ID, or null for the root entry",
    example: null,
  }),
});

export type IFolderPathItem = z.infer<typeof SchemaFolderPathItem>;

/**
 * Folder path schema - array of path items
 */
export const SchemaFolderPath = z.array(SchemaFolderPathItem);

export type IFolderPath = z.infer<typeof SchemaFolderPath>;

/**
 * Folder list response schema - paginated list with breadcrumb path
 */
export const SchemaFolderListResponse = z.object({
  items: z.array(SchemaDocumentFolderResponse),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
  breadcrumbs: SchemaFolderPath.openapi({
    description: "Breadcrumb path from root to current folder (empty array if at root)",
    example: [
      {
        id: "folder_root_123",
        name: "Projects",
        parentFolderId: null,
      },
      {
        id: "folder_child_456",
        name: "2024",
        parentFolderId: "folder_root_123",
      },
    ],
  }),
});

export type IFolderListResponse = z.infer<typeof SchemaFolderListResponse>;

/**
 * Move folder request schema
 */
export const SchemaFolderMoveRequest = z.object({
  targetParentFolderId: z.string().nullable().openapi({
    description: "Destination parent folder ID, or null to move to root",
    example: "clx1m3k0a0000l8v2g7q9h3zp",
  }),
  asyncMode: z.boolean().default(true).optional().openapi({
    description: "Enable async processing with SSE notifications (default: true)",
    example: true,
  }),
});

export type IMoveFolderInput = z.infer<typeof SchemaFolderMoveRequest>;

/**
 * Folder contents response schema - folders and documents in a folder
 */
export const SchemaFolderContentsResponse = z.object({
  folders: z.array(SchemaDocumentFolderResponse),
  documents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      contentType: z.string().nullable(),
      fileSize: z.number().int().nonnegative(),
      createdAt: SCHEMA_VALIDATION_TIMESTAMP,
      updatedAt: SCHEMA_VALIDATION_TIMESTAMP,
    }),
  ),
});

export type IFolderContents = z.infer<typeof SchemaFolderContentsResponse>;

/**
 * Non-recursive folder with contents schema for OpenAPI routes
 * Use this in route definitions to avoid lazy type issues
 */
export const SchemaFolderWithContentsApiResponse = SchemaDocumentFolderResponse.extend({
  children: z.array(z.any()).openapi({
    description: "Nested child folders with their contents (recursive structure)",
  }),
  documents: z.array(z.any()).openapi({
    description: "Documents in this folder (accessible to user)",
  }),
  depth: z.number().int().nonnegative().openapi({
    description: "Depth level in folder hierarchy (0 for root)",
    example: 2,
  }),
});

/**
 * Document tree item type - unified structure for both documents and folders
 * Uses children to distinguish: null = document, array = folder
 * Recursive structure where children follow the same pattern
 */
export type IDocumentTreeItem = {
  id: string;
  name: string;
  isDocument: boolean;
  isFolder: boolean;
  isShared: boolean;
  icon: string;
  color: string;
  contentType: string | null;
  children: IDocumentTreeItem[] | null;
};

/**
 * Document tree item schema - unified structure for both documents and folders
 * Non-recursive schema for OpenAPI compatibility (children array uses z.any() for recursion)
 */
export const SchemaDocumentTreeItem = z.object({
  id: z.string(),
  name: z.string(),
  isDocument: z.boolean(),
  isFolder: z.boolean(),
  isShared: z.boolean(),
  icon: z.string(),
  color: z.string(),
  contentType: z.string().nullable(),
  children: z.array(z.any()).nullable().openapi({
    description: "Nested children (recursive structure - documents or folders). null for documents, array for folders.",
  }),
});

/**
 * Document tree response schema - array of unified tree items
 */
export const SchemaDocumentTreeResponse = z.array(SchemaDocumentTreeItem).openapi({
  description: "Tree response - array of unified tree items (documents and folders) with recursive structure",
});

// Forward reference to avoid circular import
// IDocumentResponse is defined in models/documents/document.model.ts
export type IFolderWithContents = z.infer<typeof SchemaDocumentFolderResponse> & {
  children: IFolderWithContents[];
  documents: Array<Record<string, unknown>>; // IDocumentResponse[] - using Record to avoid circular import
  depth: number;
};

/**
 * Folder statistics response schema - document count and total size
 */
export const SchemaFolderStatisticsResponse = z.object({
  folderId: z.string().openapi({ description: "Folder ID", example: "clx1m3k0a0000l8v2g7q9h3zp" }),
  documentCount: z.number().int().nonnegative().openapi({ description: "Total number of documents in the folder", example: 42 }),
  totalSize: z.number().int().nonnegative().openapi({ description: "Total size of documents in bytes", example: 5242880 }),
  folderCount: z.number().int().nonnegative().openapi({ description: "Total number of subfolders", example: 7 }),
  lastModified: SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP,
});

export type IFolderStatistics = z.infer<typeof SchemaFolderStatisticsResponse>;

/**
 * Folder list query schema - for filtering and pagination
 */
export const SchemaFolderListQuery = SchemaPaginationQuery.extend({
  parentFolderId: z.string().optional().nullable().transform((val) =>
    val === undefined || val === null || val === "" || val === "null" ? null : val
  ).openapi({
    description: "Filter by parent folder ID (use 'null' for root-level folders)",
    example: null,
  }),
  archived: z.enum(["true", "false", "both"]).default("false").openapi({
    description: "Filter by archive status: 'true' for archived only, 'false' for non-archived only, 'both' for all",
    example: "false",
  }),
  search: z.string()
    .max(255, withKey("folders.search-max-length", "Search query must be 255 characters or less"))
    .optional(),
});

export type IFolderListQuery = z.infer<typeof SchemaFolderListQuery>;

/**
 * Folder validation schema - for validating folder operations
 */
export const SchemaFolderValidation = z.object({
  maxDepth: z.number().int().positive().default(10),
  maxNameLength: z.number().int().positive().default(255),
});

export type IFolderValidation = z.infer<typeof SchemaFolderValidation>;

/**
 * Common error object for bulk operations
 */
export const SchemaFolderBulkOperationError = z.object({
  folderId: z.string().openapi({ description: "Folder ID that failed the operation", example: "clx1m3k0a0000l8v2g7q9h3zp" }),
  error: z.string().openapi({ description: "Error message describing the failure", example: "Folder not found" }),
});

export type IBulkOperationError = z.infer<typeof SchemaFolderBulkOperationError>;

/**
 * Bulk delete operation response schema
 * Matches document bulk operation format with nested structure
 */
export const SchemaFolderBulkDeleteResponse = z.object({
  success: z.boolean().openapi({ example: true }),
  message: z.string().openapi({ example: "Deleted 5 folders" }),
  data: z.object({
    processedCount: z.number().int().nonnegative().openapi({ example: 5 }),
    failedCount: z.number().int().nonnegative().openapi({ example: 0 }),
    errors: z.array(SchemaFolderBulkOperationError).openapi({ example: [] }),
  }),
});

export type IBulkDeleteOperationResult = z.infer<typeof SchemaFolderBulkDeleteResponse>;

/**
 * Bulk archive operation response schema
 * Matches document bulk operation format with nested structure
 */
export const SchemaFolderBulkArchiveResponse = z.object({
  success: z.boolean().openapi({ example: true }),
  message: z.string().openapi({ example: "Archived 5 folders" }),
  data: z.object({
    processedCount: z.number().int().nonnegative().openapi({ example: 5 }),
    failedCount: z.number().int().nonnegative().openapi({ example: 0 }),
    errors: z.array(SchemaFolderBulkOperationError).openapi({ example: [] }),
  }),
});

export type IBulkArchiveOperationResult = z.infer<typeof SchemaFolderBulkArchiveResponse>;

/**
 * Bulk move operation response schema (sync mode)
 * Matches document bulk operation format with nested structure
 */
export const SchemaFolderBulkMoveResponse = z.object({
  success: z.boolean().openapi({ example: true }),
  message: z.string().openapi({ example: "Moved 5 folders" }),
  data: z.object({
    processedCount: z.number().int().nonnegative().openapi({ example: 5 }),
    failedCount: z.number().int().nonnegative().openapi({ example: 0 }),
    errors: z.array(SchemaFolderBulkOperationError).openapi({ example: [] }),
  }),
});

export type IBulkMoveOperationResult = z.infer<typeof SchemaFolderBulkMoveResponse>;

/**
 * Bulk move operation async response schema (202 Accepted)
 * Used when folders are queued for async processing
 */
export const SchemaFolderBulkMoveAsyncResponse = z.object({
  operationId: z.string().openapi({ example: "op_123456" }),
  status: z.enum(["pending", "processing"]).openapi({ example: "pending" }),
  totalFolders: z.number().int().positive().openapi({ example: 10 }),
  estimatedCompletion: z.string().openapi({ example: "2024-01-01T12:00:00Z" }),
  message: z.string().openapi({ example: "Folder move operation queued for processing" }),
});

export type IBulkMoveAsyncOperationResult = z.infer<typeof SchemaFolderBulkMoveAsyncResponse>;

/**
 * Generic bulk operation result schema (backward compatibility)
 * @deprecated Use specific operation result schemas instead
 */
export const BulkOperationResultSchema = SchemaFolderBulkDeleteResponse;

export type IBulkOperationResult = z.infer<typeof BulkOperationResultSchema>;
