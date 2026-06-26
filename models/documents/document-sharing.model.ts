/**
 * @file models/documents/document-sharing.model.ts
 * @description Document Sharing model/types
 */
import { z } from "@deps";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import {
  SCHEMA_NULLABLE_TIMESTAMP,
  SCHEMA_TIMESTAMP,
  SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP,
  SCHEMA_VALIDATION_TIMESTAMP,
} from "@models/shared.model.ts";
import { SCHEMA_USER_ID } from "@models/users/index.ts";
import { SCHEMA_DOCUMENT_ID } from "./common.model.ts";
import { tables } from "@db/index.ts";

/**
 * Document share request schema - for sharing with internal users
 */
export const SchemaDocumentShareRequest = z.object({
  documentId: z.string().openapi({
    description: "ID of the document to share",
    example: "lj31mk8hewwv5wwx",
  }),
  userIds: z.array(SCHEMA_USER_ID),
  permission: z.enum(Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL) as [string, ...string[]]).openapi({
    description: "Permission level for shared users",
    example: "read",
  }),
});

/**
 * Shared user item schema - for displaying shared users in document details
 */
export const SchemaDocumentSharedUser = z.object({
  userId: SCHEMA_USER_ID,
  email: z.string().email().nullable(),
  name: z.string(),
  permission: z.enum(Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL) as [string, ...string[]]),
  sharedAt: SCHEMA_VALIDATION_TIMESTAMP,
}).openapi({
  description: "User with access to the document",
});

export type IDocumentSharedUser = z.infer<typeof SchemaDocumentSharedUser>;

/**
 * Public share item schema
 */
export const SchemaPublicShareItem = z.object({
  token: z.string().openapi({ description: "Public share token", example: "abc123def456ghi789jkl012mno345pq" }),
  url: z.string().openapi({
    description: "Public share URL",
    example: "https://app.example.com/public/documents/abc123def456ghi789jkl012mno345pq",
  }),
  hasPassword: z.boolean().openapi({ description: "Whether the share is password protected", example: false }),
  expiresAt: SCHEMA_NULLABLE_TIMESTAMP,
  recipientEmail: z.string().nullable().optional().openapi({
    description: "Optional recipient email recorded for tracking",
    example: "user@example.com",
  }),
  createdAt: SCHEMA_TIMESTAMP,
});

export type IPublicShareItem = z.infer<typeof SchemaPublicShareItem>;

/**
 * Document permissions response schema
 */
export const SchemaDocumentPermissionsResponse = z.object({
  owner: z.object({
    userId: SCHEMA_USER_ID,
    email: z.string().email().nullable(),
    name: z.string(),
  }).openapi({
    description: "Document owner information",
  }),
  sharedUsers: z.array(SchemaDocumentSharedUser).openapi({
    description: "Users with access to the document",
  }),
  publicShares: z.array(SchemaPublicShareItem).openapi({
    description: "Public share configurations",
  }),
});

/**
 * Public document share request schema
 */
export const SchemaDocumentPublicShareRequest = z.object({
  password: z.string().min(8).max(128).optional().openapi({
    description: "Optional password protection",
    example: "securePassword123",
  }),
  expiresAt: SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP,
  recipientEmail: z.string().email().optional().openapi({
    description: "Optional recipient email for tracking",
    example: "user@example.com",
  }),
});
/**
 * Disable public document share request schema
 */
export const SchemaDocumentDisablePublicShareRequest = z.object({
  token: z.string().optional().openapi({
    description: "Specific share token to disable. If omitted, all public shares for the document will be disabled.",
    example: "abc123def456ghi789jkl012mno345pq",
  }),
});

/**
 * Public document share response schema
 */
export const SchemaDocumentPublicShareResponse = z.object({
  token: z.string().openapi({
    description: "Public share token",
    example: "abc123def456ghi789jkl012mno345pq",
  }),
  shareUrl: z.string().url().openapi({
    description: "Full URL for accessing the shared document",
    example: "https://app.example.com/public/documents/abc123def456ghi789jkl012mno345pq",
  }),
  hasPassword: z.boolean().openapi({
    description: "Whether the share is password protected",
    example: false,
  }),
  expiresAt: SCHEMA_NULLABLE_TIMESTAMP,
  createdAt: SCHEMA_TIMESTAMP,
});

/**
 * Document share response schema
 */
export const SchemaDocumentShareResponse = z.object({
  sharedWith: z.array(z.object({
    userId: SCHEMA_USER_ID,
    permission: z.enum(Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL) as [string, ...string[]]),
  })).openapi({
    description: "Successfully shared users",
  }),
});

/**
 * Document permission update request schema
 */
export const SchemaDocumentPermissionUpdateRequest = z.object({
  documentId: z.string().openapi({
    description: "ID of the document",
    example: "b57lvwsh9ghyp8v6",
  }),
  userId: SCHEMA_USER_ID.openapi({
    description: "ID of the user whose permission is being updated",
  }),
  permission: z.enum(["read", "write"]).openapi({
    description: "New permission level",
    example: "write",
  }),
});

/**
 * Document permission update response schema
 */
export const SchemaDocumentPermissionUpdateResponse = z.object({
  userId: SCHEMA_USER_ID.openapi({ description: "User ID whose permission was updated", example: "clwz0q8h30000mpv2g7q9h3zp" }),
  permission: z.enum(["read", "write"]).openapi({ description: "Updated permission level", example: "write" }),
  updatedAt: SCHEMA_TIMESTAMP,
});

/**
 * Document revoke access request schema
 */
export const SchemaDocumentRevokeAccessRequest = z.object({
  documentId: z.string().openapi({
    description: "ID of the document",
    example: "b57lvwsh9ghyp8v6",
  }),
  userId: SCHEMA_USER_ID.openapi({
    description: "ID of the user whose permission is being updated",
  }),
});

/**
 * Document access log schema - standardized document access log database model
 * Matches the database schema exactly
 */
export const SchemaDocumentAccessLog = z.object({
  id: z.string().openapi({ description: "Access log entry ID", example: "clx1m3k0e0004l8v2g7q9h3zp" }),
  documentId: z.string().nullable().openapi({
    description: "Document ID accessed (null for folder-only logs)",
    example: "clx1m3k0c0002l8v2g7q9h3zp",
  }),
  folderId: z.string().nullable().openapi({ description: "Folder ID accessed, if applicable", example: null }),
  dataKeyId: z.string().nullable().openapi({ description: "Data key ID used for the access", example: "clx1m3k0f0005l8v2g7q9h3zp" }),
  userId: z.string().nullable().openapi({
    description: "User ID of the accessor (null for anonymous/public access)",
    example: "clwz0q8h30000mpv2g7q9h3zp",
  }),
  accessType: z.string().openapi({ description: "Type of access (view, download, share, update_permission, etc.)", example: "view" }),
  accessMethod: z.string().openapi({ description: "Method of access (direct, public_share, internal_share)", example: "direct" }),
  changes: z.array(z.object({
    field: z.string().openapi({ description: "Field that changed", example: "permission" }),
    previousValue: z.unknown().openapi({ description: "Previous value of the field", example: "read" }),
    newValue: z.unknown().openapi({ description: "New value of the field", example: "write" }),
  })).nullable(),
  createdAt: SCHEMA_VALIDATION_TIMESTAMP,
}) satisfies z.ZodType<typeof tables.documentAccessLogs.$inferSelect>;

export type IDocumentAccessLog = z.infer<typeof SchemaDocumentAccessLog>;

/**
 * Document access log schema for document-specific logs
 * Derived from SchemaDocumentAccessLog, only includes document-specific fields
 */
export const SchemaDocumentAccessLogItem = SchemaDocumentAccessLog.pick({
  id: true,
  userId: true,
  accessType: true,
  accessMethod: true,
  createdAt: true,
}).extend({
  documentId: SCHEMA_DOCUMENT_ID, // Non-nullable for document-specific logs
});

export type IDocumentAccessLogItem = z.infer<typeof SchemaDocumentAccessLogItem>;

/**
 * Document access logs response schema - paginated access logs
 */
export const SchemaDocumentAccessLogsResponse = z.object({
  items: z.array(SchemaDocumentAccessLogItem).openapi({
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

export type IDocumentAccessLogsResponse = z.infer<typeof SchemaDocumentAccessLogsResponse>;

// Export types
export type IDocumentShareRequest = z.infer<typeof SchemaDocumentShareRequest>;
export type IPublicDocumentShareOptions = z.infer<typeof SchemaDocumentPublicShareRequest>;
export type IDocumentPermissionUpdate = z.infer<typeof SchemaDocumentPermissionUpdateRequest>;
