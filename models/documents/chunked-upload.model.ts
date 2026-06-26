/**
 * @file models/documents/chunked-upload.model.ts
 * @description Zod schemas for chunked upload API endpoints
 */

import { z } from "@deps";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { SCHEMA_USER_ID } from "@models/users/index.ts";
import { STRING_LENGTH_CONSTRAINTS } from "@constants/validation/string-lengths.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

/**
 * Schema for initiating a chunked upload
 */
export const SchemaInitiateUploadRequest = z.object({
  fileName: z.string()
    .trim()
    .min(1, withKey("chunked-upload.filename-required", "Filename is required"))
    .max(255, withKey("chunked-upload.filename-max-length", "Filename must be 255 characters or less"))
    .openapi({
      description: "Original filename",
      example: "large-video.mp4",
    }),
  fileSize: z.number()
    .int()
    .positive(withKey("chunked-upload.filesize-positive", "File size must be positive"))
    .max(5 * 1024 * 1024 * 1024, withKey("chunked-upload.filesize-max", "File size must be less than 5GB"))
    .openapi({
      description: "Total file size in bytes",
      example: 1073741824, // 1GB
    }),
  mimeType: z.string()
    .trim()
    .min(1, withKey("chunked-upload.mimetype-required", "MIME type is required"))
    .optional()
    .openapi({
      description: "MIME type of the file (auto-detected from filename if not provided)",
      example: "video/mp4",
    }),
  chunkSize: z.number()
    .int()
    .positive(withKey("chunked-upload.chunksize-positive", "Chunk size must be positive"))
    .optional()
    .openapi({
      description: "Optional chunk size in bytes (defaults to 10MB, min 1MB, max 50MB)",
      example: 10485760, // 10MB
    }),
  name: z.string()
    .trim()
    .min(1, withKey("chunked-upload.name-min-length", "Document name must be at least 1 character"))
    .max(200, withKey("chunked-upload.name-max-length", "Document name must be 200 characters or less"))
    .optional()
    .openapi({
      description: "Optional document name (defaults to filename)",
      example: "My Video",
    }),
  description: z.string()
    .trim()
    .max(1000, withKey("chunked-upload.description-max-length", "Description must be 1000 characters or less"))
    .nullable()
    .optional()
    .openapi({
      description: "Optional description",
      example: "Important video file",
    }),
  folderId: z.string().trim().nullable().optional().openapi({
    description: "Optional parent folder ID",
    example: "folder_123",
  }),
  tags: z.array(z.string().trim())
    .max(20, withKey("chunked-upload.tags-max", "Maximum 20 tags allowed"))
    .optional()
    .openapi({
      description: "Optional array of tags",
      example: ["video", "important"],
    }),
  metadata: z.record(z.string().trim(), z.unknown()).optional().openapi({
    description: "Optional custom metadata object",
    example: { source: "mobile" },
  }),
});

export type IInitiateUploadRequest = z.infer<typeof SchemaInitiateUploadRequest>;

/**
 * Schema for initiate upload response
 */
export const SchemaInitiateUploadResponse = z.object({
  sessionId: z.string().openapi({
    description: "Unique session ID for this upload",
    example: "session_abc123",
  }),
  chunkSize: z.number().int().openapi({
    description: "Chunk size to use for uploads in bytes",
    example: 10485760,
  }),
  totalChunks: z.number().int().openapi({
    description: "Total number of chunks expected",
    example: 100,
  }),
  expiresAt: z.number().int().openapi({
    description: "Unix timestamp when session expires",
    example: 1699999999000,
  }),
});

export type IInitiateUploadResponse = z.infer<typeof SchemaInitiateUploadResponse>;

/**
 * Schema for upload chunk response
 */
export const SchemaUploadChunkResponse = z.object({
  sessionId: z.string().openapi({
    description: "Session ID",
    example: "session_abc123",
  }),
  chunkIndex: z.number().int().openapi({
    description: "Index of the chunk that was uploaded",
    example: 5,
  }),
  chunksUploaded: z.number().int().openapi({
    description: "Total number of chunks uploaded so far",
    example: 6,
  }),
  totalChunks: z.number().int().openapi({
    description: "Total number of chunks expected",
    example: 100,
  }),
  progress: z.number().int().min(0).max(100).openapi({
    description: "Upload progress percentage (0-100)",
    example: 6,
  }),
  isLastChunk: z.boolean().openapi({
    description: "Whether this was the last chunk",
    example: false,
  }),
});

export type IUploadChunkResponse = z.infer<typeof SchemaUploadChunkResponse>;

/**
 * Schema for upload status response
 */
export const SchemaUploadStatusResponse = z.object({
  sessionId: z.string().openapi({
    description: "Session ID",
    example: "session_abc123",
  }),
  status: z.enum(["initiated", "uploading", "assembling", "completed", "failed", "aborted"]).openapi({
    description: "Current upload status",
    example: "uploading",
  }),
  chunksUploaded: z.number().int().openapi({
    description: "Number of chunks uploaded",
    example: 50,
  }),
  totalChunks: z.number().int().openapi({
    description: "Total chunks expected",
    example: 100,
  }),
  progress: z.number().int().min(0).max(100).openapi({
    description: "Upload progress percentage",
    example: 50,
  }),
  missingChunks: z.array(z.number().int()).openapi({
    description: "Array of missing chunk indices (for resume)",
    example: [51, 52, 53],
  }),
  expiresAt: z.number().int().openapi({
    description: "Session expiration timestamp",
    example: 1699999999000,
  }),
  errorMessage: z.string().optional().openapi({
    description: "Error message if status is 'failed'",
    example: "Upload timeout",
  }),
  documentId: z.string().optional().openapi({
    description: "Created document ID — populated when status is 'completed'",
    example: "uq0sfuVAD0O_xfDS",
  }),
});

export type IUploadStatusResponse = z.infer<typeof SchemaUploadStatusResponse>;

/**
 * Schema for session ID path parameter
 */
export const SchemaSessionIdParam = z.object({
  sessionId: z.string()
    .trim()
    .min(1, withKey("chunked-upload.session-id-required", "Session ID is required"))
    .openapi({
      description: "Upload session ID",
      example: "session_abc123",
    }),
});

/**
 * Schema for chunk index query parameter
 */
export const SchemaChunkIndexQuery = z.object({
  chunkIndex: z.coerce
    .number()
    .int(withKey("chunked-upload.chunk-index-integer", "Chunk index must be an integer"))
    .min(0, withKey("chunked-upload.chunk-index-min", "Chunk index must be non-negative"))
    .openapi({
      description: "0-based chunk index",
      example: 5,
    }),
});

/**
 * Schema for shared user in document uploads
 */
export const SchemaSharedUser = z.object({
  userId: SCHEMA_USER_ID.openapi({
    description: "User ID to share the document with",
    example: "user_abc123",
  }),
  permissionLevel: z.enum(Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL) as [string, ...string[]]).openapi({
    description: "Permission level for the shared user",
    example: "read",
  }),
  isNotify: z.boolean().default(true).openapi({
    description: "Whether to notify the user about the share",
    example: true,
  }),
});

export type ISharedUser = z.infer<typeof SchemaSharedUser>;

/**
 * Schema for completing a chunked upload with metadata
 */
export const SchemaCompleteChunkedUploadRequest = z.object({
  name: z.string()
    .trim()
    .min(1, withKey("chunked-upload.name-min-length", "Document name must be at least 1 character"))
    .max(200, withKey("chunked-upload.name-max-length", "Document name must be 200 characters or less"))
    .optional()
    .openapi({
      description: "Document name (defaults to filename from initiate)",
      example: "My Large Video",
    }),
  description: z.string()
    .trim()
    .max(1000, withKey("chunked-upload.description-max-length", "Description must be 1000 characters or less"))
    .nullable()
    .optional()
    .openapi({
      description: "Document description",
      example: "Important video file",
    }),
  folderId: z.string().trim().nullable().optional().openapi({
    description: "Parent folder ID",
    example: "folder_123",
  }),
  tags: z.array(z.string().trim())
    .max(20, withKey("chunked-upload.tags-max", "Maximum 20 tags allowed"))
    .optional()
    .openapi({
      description: "Array of tags",
      example: ["video", "important"],
    }),
  metadata: z.record(z.string().trim(), z.unknown()).optional().openapi({
    description: "Custom metadata object",
    example: { source: "mobile" },
  }),
  sharedUsers: z.array(SchemaSharedUser)
    .max(50, withKey("chunked-upload.shared-users-max", "Maximum 50 shared users allowed"))
    .optional()
    .openapi({
      description: "Users to share the document with upon completion",
      example: [
        { userId: "user_abc123", permissionLevel: "read", isNotify: true },
        { userId: "user_def456", permissionLevel: "write", isNotify: false },
      ],
    }),
  initialComment: z.string()
    .trim()
    .min(
      STRING_LENGTH_CONSTRAINTS.COMMENT_CONTENT_MIN,
      withKey("chunked-upload.comment-min-length", `Comment must be at least ${STRING_LENGTH_CONSTRAINTS.COMMENT_CONTENT_MIN} characters`),
    )
    .max(
      STRING_LENGTH_CONSTRAINTS.COMMENT_CONTENT_MAX,
      withKey("chunked-upload.comment-max-length", `Comment must be ${STRING_LENGTH_CONSTRAINTS.COMMENT_CONTENT_MAX} characters or less`),
    )
    .optional()
    .openapi({
      description: "Optional initial comment to create with the document",
      example: "This is the final version",
    }),
});

export type ICompleteChunkedUploadRequest = z.infer<typeof SchemaCompleteChunkedUploadRequest>;
