/**
 * @file models/documents/folder-sharing.model.ts
 * @description Folder Sharing model/types
 */
import { z } from "@deps";
import { SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP, SCHEMA_VALIDATION_TIMESTAMP } from "@models/shared.model.ts";
import { tables } from "@db/index.ts";

/**
 * @file models/documents/folder-sharing.model.ts
 * @description Folder sharing schemas and validation models
 * Contains Zod schemas for folder sharing operations
 */

/**
 * Folder share request schema - for sharing folders with internal users
 */
export const SchemaFolderShareRequest = z.object({
  userIds: z.array(z.string()).min(1).max(100).openapi({
    description: "Array of user IDs to share the folder with",
    example: ["123e4567-e89b-12d3-a456-426614174000"],
  }),
  permissionLevel: z.number().int().min(0).max(5).openapi({
    description: "Permission level (0=READ, 1=COMMENT, 2=WRITE, 3=DOWNLOAD, 4=SHARE, 5=ADMIN)",
    example: 0,
  }),
  notifyUsers: z.boolean().default(false).openapi({
    description: "Whether to notify users via email about the shared folder",
    example: false,
  }),
});

export type IFolderShareRequest = z.infer<typeof SchemaFolderShareRequest>;

/**
 * Folder share result item schema - result for a single user
 */
export const SchemaFolderShareResultItem = z.object({
  userId: z.string().openapi({ description: "User ID the share was attempted for", example: "clwz0q8h30000mpv2g7q9h3zp" }),
  permissionLevel: z.number().int().min(0).max(5).openapi({
    description: "Permission level granted (0=READ, 1=COMMENT, 2=WRITE, 3=DOWNLOAD, 4=SHARE, 5=ADMIN)",
    example: 2,
  }),
  success: z.boolean().openapi({ description: "Whether the share succeeded for this user", example: true }),
  error: z.string().optional().openapi({ description: "Error message if the share failed for this user", example: "User not found" }),
});

export type IFolderShareResultItem = z.infer<typeof SchemaFolderShareResultItem>;

/**
 * Folder share response schema - response from sharing operation
 */
export const SchemaFolderShareResponse = z.object({
  folderId: z.string().openapi({ description: "Folder ID that was shared", example: "clx1m3k0a0000l8v2g7q9h3zp" }),
  sharedWith: z.array(SchemaFolderShareResultItem).openapi({
    description: "Per-user results of the share operation",
  }),
  documentsShared: z.number().int().nonnegative().openapi({
    description: "Number of documents that were shared",
    example: 10,
  }),
  subfoldersShared: z.number().int().nonnegative().openapi({
    description: "Number of subfolders that were shared",
    example: 3,
  }),
});

export type IFolderShareResult = z.infer<typeof SchemaFolderShareResponse>;

/**
 * Folder shared user schema - represents a user with access to a folder
 * Note: userName is a computed field from a join, not stored in the table
 */
export const SchemaFolderSharedUser = z.object({
  id: z.string().openapi({ description: "Permission grant ID", example: "clx1m3k0b0001l8v2g7q9h3zp" }),
  folderId: z.string().openapi({ description: "Folder ID the grant applies to", example: "clx1m3k0a0000l8v2g7q9h3zp" }),
  userId: z.string().openapi({ description: "User ID the folder is shared with", example: "clwz0q8h30000mpv2g7q9h3zp" }),
  userName: z.string().nullable().optional().openapi({
    description: "Display name of the shared user (from users table join)",
    example: "John Doe",
  }),
  permissionLevel: z.number().int().min(0).max(5).openapi({
    description: "Permission level (0=READ, 1=COMMENT, 2=WRITE, 3=DOWNLOAD, 4=SHARE, 5=ADMIN)",
    example: 2,
  }),
  grantedById: z.string().openapi({ description: "User ID who granted the permission", example: "clwz0q8h30001mpv2g7q9h3zp" }),
  grantedByName: z.string().nullable().openapi({ description: "Display name of the granting user", example: "Jane Smith" }),
  grantedAt: SCHEMA_VALIDATION_TIMESTAMP,
  isActive: z.boolean().openapi({ description: "Whether the permission grant is currently active", example: true }),
  createdAt: SCHEMA_VALIDATION_TIMESTAMP,
  updatedAt: SCHEMA_VALIDATION_TIMESTAMP,
});

export type IFolderSharedUser = z.infer<typeof SchemaFolderSharedUser>;

/**
 * Public share configuration schema
 */
export const SchemaFolderPublicShareConfig = z.object({
  isEnabled: z.boolean().openapi({
    description: "Whether public sharing is enabled for this folder",
    example: false,
  }),
  token: z.string().nullable().openapi({
    description: "Public share token (null if not enabled)",
    example: null,
  }),
  expiresAt: SCHEMA_VALIDATION_TIMESTAMP.nullable().openapi({
    description: "Expiration timestamp (null if no expiration)",
    example: null,
  }),
});

export type IPublicShareConfig = z.infer<typeof SchemaFolderPublicShareConfig>;

/**
 * Folder permissions response schema - lists all permissions for a folder
 */
export const SchemaFolderPermissionsResponse = z.object({
  internalUsers: z.array(SchemaFolderSharedUser).openapi({
    description: "List of internal users with access to the folder",
  }),
  publicShare: SchemaFolderPublicShareConfig.openapi({
    description: "Public share configuration",
  }),
});

export type IFolderPermissionsResponse = z.infer<typeof SchemaFolderPermissionsResponse>;

/**
 * Folder permission update request schema
 */
export const SchemaFolderPermissionUpdateRequest = z.object({
  permissionLevel: z.number().int().min(0).max(5).openapi({
    description: "New permission level (0=READ, 1=COMMENT, 2=WRITE, 3=DOWNLOAD, 4=SHARE, 5=ADMIN)",
    example: 2,
  }),
});

export type IPermissionUpdate = z.infer<typeof SchemaFolderPermissionUpdateRequest>;

/**
 * Folder permission update response schema
 */
export const SchemaFolderPermissionUpdateResponse = z.object({
  userId: z.string().openapi({
    description: "User ID whose permission was updated",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
  permissionLevel: z.number().int().min(0).max(5).openapi({
    description: "Updated permission level",
    example: 2,
  }),
  updatedAt: SCHEMA_VALIDATION_TIMESTAMP,
});

export type IFolderPermissionUpdateResponse = z.infer<typeof SchemaFolderPermissionUpdateResponse>;

/**
 * Public folder share request schema
 */
export const SchemaFolderPublicShareRequest = z.object({
  password: z.string().min(8).nullable().openapi({
    description: "Optional password to protect the public share (minimum 8 characters)",
    example: "securePassword123",
  }),
  expiresAt: SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP,
});

export type IPublicFolderShareOptions = z.infer<typeof SchemaFolderPublicShareRequest>;

/**
 * Public folder share response schema
 */
export const SchemaFolderPublicShareResponse = z.object({
  shareUrl: z.string().openapi({
    description: "Complete share URL with token",
    example: "/public/folders/abc123def456...",
  }),
  token: z.string().openapi({
    description: "Public share token (32 characters)",
    example: "abc123def456ghi789jkl012mno345pq",
  }),
  expiresAt: SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP,
});

export type IPublicFolderShareResult = z.infer<typeof SchemaFolderPublicShareResponse>;

/**
 * Public folder access request schema
 */
export const SchemaFolderPublicAccessRequest = z.object({
  password: z.string().optional().openapi({
    description: "Password for password-protected shares",
    example: "securePassword123",
  }),
});

export type IPublicFolderAccess = z.infer<typeof SchemaFolderPublicAccessRequest>;

/**
 * Folder access log schema - standardized folder access log database model
 * Matches the database schema exactly
 */
export const SchemaFolderAccessLog = z.object({
  id: z.string(),
  folderId: z.string(),
  userId: z.string().nullable().openapi({
    description: "User ID (null for anonymous/public access)",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
  accessType: z.string().openapi({
    description: "Type of access (view, list, access_child)",
    example: "view",
  }),
  accessMethod: z.string().openapi({
    description: "Method of access (direct, public_share, internal_share)",
    example: "direct",
  }),
  ipAddress: z.string().nullable().openapi({
    description: "IP address of the accessor",
    example: "192.168.1.1",
  }),
  userAgent: z.string().nullable().openapi({
    description: "User agent string",
    example: "Mozilla/5.0...",
  }),
  referer: z.string().nullable().openapi({
    description: "HTTP referer",
    example: "https://example.com",
  }),
  success: z.boolean().openapi({
    description: "Whether the access attempt was successful",
    example: true,
  }),
  errorMessage: z.string().nullable().openapi({
    description: "Error message if access failed",
    example: null,
  }),
  createdAt: SCHEMA_VALIDATION_TIMESTAMP,
}) satisfies z.ZodType<typeof tables.folderAccessLogs.$inferSelect>;

export type IFolderAccessLog = z.infer<typeof SchemaFolderAccessLog>;

/**
 * Folder access logs response schema - paginated access logs
 */
export const SchemaFolderAccessLogsResponse = z.object({
  items: z.array(SchemaFolderAccessLog).openapi({
    description: "Array of access log entries",
  }),
  pagination: z.object({
    page: z.number().int().positive().openapi({
      description: "Current page number",
      example: 1,
    }),
    limit: z.number().int().positive().openapi({
      description: "Number of items per page",
      example: 50,
    }),
    total: z.number().int().nonnegative().openapi({
      description: "Total number of items",
      example: 150,
    }),
    totalPages: z.number().int().nonnegative().openapi({
      description: "Total number of pages",
      example: 3,
    }),
    hasNext: z.boolean().openapi({
      description: "Whether there is a next page",
      example: true,
    }),
    hasPrev: z.boolean().openapi({
      description: "Whether there is a previous page",
      example: false,
    }),
  }).openapi({
    description: "Pagination metadata",
  }),
});

export type IFolderAccessLogsResponse = z.infer<typeof SchemaFolderAccessLogsResponse>;

/**
 * Folder access log query schema - for filtering and pagination of access logs
 */
export const SchemaFolderAccessLogQuery = z.object({
  userId: z.string().optional().openapi({
    description: "Filter by user ID",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
  accessType: z.string().optional().openapi({
    description: "Filter by access type (view, list, access_child)",
    example: "view",
  }),
  accessMethod: z.string().optional().openapi({
    description: "Filter by access method (direct, public_share, internal_share)",
    example: "direct",
  }),
  success: z.coerce.boolean().optional().openapi({
    description: "Filter by success status",
    example: true,
  }),
  startDate: SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP,
  endDate: SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP,
  page: z.coerce.number().int().positive().default(1).openapi({
    description: "Page number for pagination",
    example: 1,
  }),
  limit: z.coerce.number().int().positive().max(100).default(50).openapi({
    description: "Number of items per page (max 100)",
    example: 50,
  }),
});

export type IAccessLogQuery = z.infer<typeof SchemaFolderAccessLogQuery>;

/**
 * Public folder documents response schema - documents in a publicly shared folder
 */
export const SchemaPublicFolderDocumentsResponse = z.object({
  folderId: z.string().openapi({
    description: "Folder ID",
    example: "clx1m3k0a0000l8v2g7q9h3zp",
  }),
  folderName: z.string().openapi({
    description: "Folder name",
    example: "Shared Documents",
  }),
  documents: z.array(
    z.object({
      id: z.string().openapi({ description: "Document ID", example: "clx1m3k0c0002l8v2g7q9h3zp" }),
      name: z.string().openapi({ description: "Document file name", example: "Q1-Report.pdf" }),
      contentType: z.string().nullable().openapi({ description: "Content type / category", example: "pdf" }),
      fileSize: z.number().int().nonnegative().openapi({ description: "Document size in bytes", example: 1048576 }),
      createdAt: SCHEMA_VALIDATION_TIMESTAMP,
      updatedAt: SCHEMA_VALIDATION_TIMESTAMP,
    }),
  ).openapi({
    description: "Direct child documents of the folder",
  }),
  folders: z.array(
    z.object({
      id: z.string().openapi({ description: "Subfolder ID", example: "clx1m3k0d0003l8v2g7q9h3zp" }),
      name: z.string().openapi({ description: "Subfolder name", example: "Drafts" }),
      createdAt: SCHEMA_VALIDATION_TIMESTAMP,
      updatedAt: SCHEMA_VALIDATION_TIMESTAMP,
    }),
  ).openapi({
    description: "Direct child subfolders",
  }),
});

export type IPublicFolderDocumentsResponse = z.infer<typeof SchemaPublicFolderDocumentsResponse>;
