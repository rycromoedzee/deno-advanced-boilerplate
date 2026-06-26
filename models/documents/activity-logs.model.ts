/**
 * @file models/documents/activity-logs.model.ts
 * @description Activity Logs model/types
 */
import { z } from "@deps";
import { SCHEMA_NULLABLE_TIMESTAMP, SCHEMA_VALIDATION_TIMESTAMP } from "@models/shared.model.ts";
import { SCHEMA_USER_ID } from "@models/users/index.ts";

/**
 * Activity Log Query Parameters Schema
 * Supports comprehensive filtering, sorting, and pagination
 */
export const SchemaActivityLogQuery = z.object({
  // Pagination
  page: z.coerce.number().int().positive().default(1).openapi({
    description: "Page number for pagination",
    example: 1,
  }),
  limit: z.coerce.number().int().positive().max(100).default(50).openapi({
    description: "Number of items per page (max: 100)",
    example: 50,
  }),

  // Sorting
  sortBy: z.enum(["accessedAt", "documentName", "accessType"]).default("accessedAt").openapi({
    description: "Sort field: accessedAt, documentName, accessType",
    example: "accessedAt",
  }),
  sortOrder: z.enum(["asc", "desc"]).default("desc").openapi({
    description: "Sort order: asc or desc",
    example: "desc",
  }),

  // Filters - Entity IDs
  documentId: z.string().optional().openapi({
    description: "Filter by specific document ID",
    example: "doc_xyz789",
  }),
  folderId: z.string().optional().openapi({
    description: "Filter by specific folder ID",
    example: "folder_456",
  }),
  ownerId: SCHEMA_USER_ID.optional().openapi({
    description: "Filter by document owner user ID",
  }),
  accessedBy: SCHEMA_USER_ID.optional().openapi({
    description: "Filter by user ID who performed the action",
  }),

  // Filters - Document properties
  contentType: z.string().optional().openapi({
    description: "Filter by document content type: pdf, image, video, document, etc.",
    example: "pdf",
  }),
  documentName: z.string().optional().openapi({
    description: "Filter by document content type: pdf, image, video, document, etc.",
    example: "pdf",
  }),
  tags: z.string().optional().openapi({
    description: "Comma-separated tag IDs or names to filter by",
    example: "important,urgent",
  }),

  // Filters - Access properties
  accessType: z.string().optional().openapi({
    description: "Filter by access type: view, download, share, update_permission, upload, delete, archive, restore",
    example: "download",
  }),
  accessMethod: z.string().optional().openapi({
    description: "Filter by access method: direct, public_share, internal_share",
    example: "direct",
  }),

  // Filters - Date ranges
  startDate: z.coerce.number().int().positive().optional().openapi({
    description: "Filter logs from this date (Unix timestamp in seconds)",
    example: 1704067200,
  }),
  endDate: z.coerce.number().int().positive().optional().openapi({
    description: "Filter logs until this date (Unix timestamp in seconds)",
    example: 1704153600,
  }),
  uploadedAfter: z.coerce.number().int().positive().optional().openapi({
    description: "Filter documents uploaded after this date (Unix timestamp in seconds)",
    example: 1704067200,
  }),
  uploadedBefore: z.coerce.number().int().positive().optional().openapi({
    description: "Filter documents uploaded before this date (Unix timestamp in seconds)",
    example: 1704153600,
  }),
  updatedAfter: z.coerce.number().int().positive().optional().openapi({
    description: "Filter documents updated after this date (Unix timestamp in seconds)",
    example: 1704067200,
  }),
  updatedBefore: z.coerce.number().int().positive().optional().openapi({
    description: "Filter documents updated before this date (Unix timestamp in seconds)",
    example: 1704153600,
  }),
});

export type IActivityLogQuery = z.infer<typeof SchemaActivityLogQuery>;

/**
 * Tag Schema for Activity Logs
 */
export const SchemaActivityLogTag = z.object({
  id: z.string().openapi({
    description: "Tag ID",
    example: "tag_001",
  }),
  name: z.string().openapi({
    description: "Tag name",
    example: "Important",
  }),
  color: z.string().openapi({
    description: "Tag color (hex format)",
    example: "#FF0000",
  }),
});

export type IActivityLogTag = z.infer<typeof SchemaActivityLogTag>;

/**
 * Activity Log Item Schema
 * Represents a single activity log entry with all metadata
 */
export const SchemaActivityLogItem = z.object({
  id: z.string().openapi({
    description: "Unique identifier for the log entry",
    example: "log_abc123",
  }),

  // Document/Folder identification
  documentId: z.string().nullable().openapi({
    description: "ID of the document this log relates to (null for folder-only logs)",
    example: "doc_xyz789",
  }),
  documentName: z.string().nullable().openapi({
    description: "Name of the document",
    example: "Q4 Financial Report.pdf",
  }),
  documentType: z.string().nullable().openapi({
    description: "Simplified document type (e.g., pdf, image, video)",
    example: "pdf",
  }),
  documentContentType: z.string().nullable().openapi({
    description: "Full MIME type (e.g., application/pdf)",
    example: "application/pdf",
  }),

  // Owner information
  ownerId: z.string().openapi({
    description: "User ID of the document/folder owner",
    example: "user_123",
  }),
  ownerName: z.string().openapi({
    description: "Full name of the document/folder owner",
    example: "John Doe",
  }),

  // Folder information
  folderId: z.string().nullable().openapi({
    description: "ID of the folder containing the document (null if in root)",
    example: "folder_456",
  }),
  folderName: z.string().nullable().openapi({
    description: "Name of the folder (null if in root)",
    example: "Financial Reports",
  }),

  // Tags
  tags: z.array(SchemaActivityLogTag).openapi({
    description: "Array of tag objects associated with the document",
  }),

  // Access information
  accessType: z.string().openapi({
    description: "Type of access: view, download, share, update_permission, upload, delete, archive, restore, comment, favorite",
    example: "download",
  }),
  accessMethod: z.string().openapi({
    description: "Method of access: direct, public_share, internal_share, api",
    example: "direct",
  }),

  // User who performed the action
  accessedBy: z.string().nullable().openapi({
    description: "User ID who performed the action (null for anonymous/public access)",
    example: "user_789",
  }),
  accessedByName: z.string().nullable().openapi({
    description: "Full name of user who performed the action (null for anonymous)",
    example: "Jane Smith",
  }),

  // Timestamp
  accessedAt: SCHEMA_VALIDATION_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when the action occurred",
    example: 1704067200,
  }),

  // Optional metadata (may not be available for all log types)
  accessDetails: z.string().nullable().optional().openapi({
    description: "Additional details about the access (optional)",
    example: "Downloaded via web interface",
  }),
  ipAddress: z.string().nullable().optional().openapi({
    description: "IP address of the accessor (available for folder logs)",
    example: "192.168.1.100",
  }),
  userAgent: z.string().nullable().optional().openapi({
    description: "User agent string (available for folder logs)",
    example: "Mozilla/5.0...",
  }),
  success: z.boolean().nullable().optional().openapi({
    description: "Whether the access attempt was successful (available for folder logs)",
    example: true,
  }),
  errorMessage: z.string().nullable().optional().openapi({
    description: "Error message if access failed (null if successful)",
    example: null,
  }),

  // Document timestamps
  documentCreatedAt: SCHEMA_NULLABLE_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when document was created",
    example: 1703980800,
  }),
  documentUpdatedAt: SCHEMA_NULLABLE_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when document was last updated",
    example: 1704000000,
  }),
});

export type IActivityLogItem = z.infer<typeof SchemaActivityLogItem>;

/**
 * Pagination Metadata Schema
 */
export const SchemaActivityLogPagination = z.object({
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
    example: 1523,
  }),
  totalPages: z.number().int().nonnegative().openapi({
    description: "Total number of pages",
    example: 31,
  }),
  hasNext: z.boolean().openapi({
    description: "Whether there is a next page",
    example: true,
  }),
  hasPrev: z.boolean().openapi({
    description: "Whether there is a previous page",
    example: false,
  }),
});

export type IActivityLogPagination = z.infer<typeof SchemaActivityLogPagination>;

/**
 * Activity Logs Response Schema
 * Paginated response with activity log items
 */
export const SchemaActivityLogsResponse = z.object({
  items: z.array(SchemaActivityLogItem).openapi({
    description: "Array of activity log entries",
  }),
  pagination: SchemaActivityLogPagination.openapi({
    description: "Pagination metadata",
  }),
});

export type IActivityLogsResponse = z.infer<typeof SchemaActivityLogsResponse>;
