/**
 * @file models/documents/comment.model.ts
 * @description Document comment model with validation schemas
 */

import { z } from "@deps";
import { SCHEMA_NULLABLE_TIMESTAMP, SCHEMA_VALIDATION_TIMESTAMP } from "../shared.model.ts";
import { STRING_LENGTH_CONSTRAINTS } from "@constants/validation/string-lengths.ts";
import { tables } from "@db/index.ts";

/**
 * Document comment schema - standardized document comment database model
 * Matches the database schema exactly
 */
export const SchemaDocumentComment = z.object({
  id: z.string().openapi({
    description: "Comment identifier",
    example: "comment_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  documentId: z.string().openapi({
    description: "ID of the document this comment belongs to",
    example: "doc_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  parentCommentId: z.string().nullable().openapi({
    description: "Parent comment ID for threaded replies (null for top-level comments)",
    example: null,
  }),
  content: z.string().openapi({
    description: "Plain-text comment body",
    example: "This section needs clarification before we publish.",
  }),
  authorId: z.string().openapi({
    description: "User ID of the comment author",
    example: "user_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  authorName: z.string().nullable().openapi({
    description: "Display name of the comment author",
    example: "Jane Smith",
  }),
  isResolved: z.boolean().openapi({
    description: "Whether the comment has been resolved",
    example: false,
  }),
  resolvedById: z.string().nullable().openapi({
    description: "User ID who resolved the comment (null if unresolved)",
    example: null,
  }),
  resolvedByName: z.string().nullable().openapi({
    description: "Display name of the user who resolved the comment",
    example: null,
  }),
  resolvedAt: SCHEMA_NULLABLE_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when the comment was resolved",
    example: null,
  }),
  isArchived: z.boolean().openapi({
    description: "Whether the comment has been soft-deleted (archived)",
    example: false,
  }),
  archivedAt: SCHEMA_NULLABLE_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when the comment was archived",
    example: null,
  }),
  archivedById: z.string().nullable().openapi({
    description: "User ID who archived the comment",
    example: null,
  }),
  archivedByName: z.string().nullable().openapi({
    description: "Display name of the user who archived the comment",
    example: null,
  }),
  createdAt: SCHEMA_VALIDATION_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when the comment was created",
    example: 1719340800,
  }),
  updatedAt: SCHEMA_VALIDATION_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when the comment was last updated",
    example: 1719340800,
  }),
}) satisfies z.ZodType<typeof tables.documentComments.$inferSelect>;

export type IDocumentComment = z.infer<typeof SchemaDocumentComment>;

/**
 * Author info schema
 */
export const SchemaCommentAuthor = z.object({
  id: z.string().openapi({
    description: "Author user ID",
    example: "user_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  name: z.string().openapi({
    description: "Author display name",
    example: "Jane Smith",
  }),
});

/**
 * Resolved by user schema
 */
export const SchemaCommentResolvedBy = z.object({
  id: z.string().openapi({
    description: "Resolver user ID",
    example: "user_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  name: z.string().openapi({
    description: "Resolver display name",
    example: "John Doe",
  }),
}).nullable();

/**
 * Comment filters schema
 */
export const SchemaCommentFilters = z.object({
  documentId: z.string().optional(),
  authorId: z.string().optional(),
  isResolved: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
  parentCommentId: z.string().nullable().optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

/**
 * Comment with author info (for API responses)
 */
export interface IDocumentCommentWithAuthor extends IDocumentComment {
  author: z.infer<typeof SchemaCommentAuthor>;
  resolvedBy?: z.infer<typeof SchemaCommentResolvedBy>;
  replies?: IDocumentCommentWithAuthor[];
}

/**
 * Create comment input (use z.infer for handlers)
 */
export type ICreateCommentInput = z.infer<typeof SchemaCommentCreateRequest>;

/**
 * Comment filters (use z.infer for handlers)
 */
export type ICommentFilters = z.infer<typeof SchemaCommentFilters>;

/**
 * Schema for comment creation request
 */
export const SchemaCommentCreateRequest = z.object({
  content: z.string()
    .min(STRING_LENGTH_CONSTRAINTS.COMMENT_CONTENT_MIN)
    .max(STRING_LENGTH_CONSTRAINTS.COMMENT_CONTENT_MAX)
    .openapi({
      description:
        `Comment content (plain text only, ${STRING_LENGTH_CONSTRAINTS.COMMENT_CONTENT_MIN}-${STRING_LENGTH_CONSTRAINTS.COMMENT_CONTENT_MAX} characters)`,
      example: "This section needs clarification",
    }),
  parentCommentId: z.string().nullable().optional().openapi({
    description: "Parent comment ID for threaded comments",
    example: "comment_abc123",
  }),
});

/**
 * Base comment response schema with author info (without recursive replies)
 * Derived from SchemaDocumentComment with added author and resolvedBy populated fields
 */
const SchemaDocumentCommentWithAuthorBase = SchemaDocumentComment.extend({
  author: SchemaCommentAuthor.openapi({
    description: "Author information",
  }),
  resolvedBy: SchemaCommentResolvedBy.optional().openapi({
    description: "User who resolved the comment",
  }),
});

/**
 * Schema for comment response (recursive structure for replies)
 * Used internally for type-safe recursive structures
 */
export const SchemaDocumentCommentResponse: z.ZodType<IDocumentCommentWithAuthor> = z.lazy(() =>
  SchemaDocumentCommentWithAuthorBase.extend({
    replies: z.array(SchemaDocumentCommentResponse).optional().openapi({
      description: "Nested replies to this comment",
    }),
  })
);

/**
 * Non-recursive comment response schema for OpenAPI routes
 * Use this in route definitions to avoid lazy type issues
 */
export const SchemaDocumentCommentApiResponse = SchemaDocumentCommentWithAuthorBase.extend({
  replies: z.array(z.any()).optional().openapi({
    description: "Nested replies to this comment (recursive structure)",
  }),
});

/**
 * Schema for comment list query parameters
 */
export const SchemaCommentListQuery = z.object({
  isResolved: z.coerce.boolean().optional().openapi({
    description: "Filter by resolution status",
    example: "false",
  }),
  includeArchived: z.coerce.boolean().optional().openapi({
    description: "Include archived comments",
    example: "false",
  }),
  page: z.coerce.number().int().positive().default(1).openapi({
    description: "Page number for pagination",
    example: 1,
  }),
  limit: z.coerce.number().int().positive().max(100).default(50).openapi({
    description: "Number of top-level comments per page (max 100)",
    example: 50,
  }),
});

/**
 * Comment ID parameter
 */
export const SCHEMA_COMMENT_ID = z.string().openapi({
  description: "Comment ID",
  example: "comment_abc123",
  param: {
    name: "commentId",
    in: "path",
  },
});
