/**
 * @file models/documents/tag.model.ts
 * @description Tag model/types
 */
import { z } from "@deps";
import { SCHEMA_VALIDATION_HEX_COLOR, SCHEMA_VALIDATION_TIMESTAMP, SchemaPaginationMetadata } from "@models/shared.model.ts";
import { STRING_LENGTH_CONSTRAINTS } from "@constants/validation/string-lengths.ts";
import { NUMERIC_LIMITS } from "@constants/validation/numeric-limits.ts";
import { tables } from "@db/index.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

/**
 * @file models/documents/tag.model.ts
 * @description Document tag schemas and validation models
 */

// Tag ID validation
export const SCHEMA_TAG_ID = z.string().openapi({
  description: "Tag identifier",
  example: "tag_abc123xyz",
});

/**
 * Tag input types - supports flexible tag specification
 * Can be a string (name), object with ID, or object with name
 */
export type TagInput = string | { id: string } | { name: string };

/**
 * Document tag schema - standardized document tag database model
 * Matches the database schema exactly
 */
export const SchemaDocumentTag = z.object({
  id: z.string().openapi({
    description: "Tag identifier",
    example: "tag_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  name: z.string().openapi({
    description: "Unique tag name (per user)",
    example: "Urgent",
  }),
  color: z.string().openapi({
    description: "Hex color code",
    example: "#ff6b6b",
  }),
  description: z.string().nullable().openapi({
    description: "Optional tag description",
    example: "Items requiring immediate attention",
  }),
  userId: z.string().openapi({
    description: "User ID who owns the tag",
    example: "user_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  createdById: z.string().openapi({
    description: "User ID who created the tag",
    example: "user_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  createdByName: z.string().nullable().openapi({
    description: "Display name of the creating user",
    example: "Jane Smith",
  }),
  usageCount: z.number().int().nonnegative().openapi({
    description: "Number of documents currently assigned this tag",
    example: 7,
  }),
  createdAt: SCHEMA_VALIDATION_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when the tag was created",
    example: 1719340800,
  }),
  updatedAt: SCHEMA_VALIDATION_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when the tag was last updated",
    example: 1719340800,
  }),
}) satisfies z.ZodType<typeof tables.documentTags.$inferSelect>;

export type IDocumentTag = z.infer<typeof SchemaDocumentTag>;

/**
 * Tag create request schema
 */
export const SchemaTagCreateRequest = z.object({
  name: z.string()
    .min(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MIN)
    .max(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MAX)
    .openapi({
      description:
        `Tag name (${STRING_LENGTH_CONSTRAINTS.TAG_NAME_MIN}-${STRING_LENGTH_CONSTRAINTS.TAG_NAME_MAX} characters, unique per environment)`,
      example: "Urgent",
    }),
  color: SCHEMA_VALIDATION_HEX_COLOR.optional().openapi({
    description: "Hex color code (auto-generated if not provided)",
    example: "#ff6b6b",
  }),
  description: z.string()
    .max(STRING_LENGTH_CONSTRAINTS.DESCRIPTION_SHORT_MAX)
    .optional()
    .nullable()
    .openapi({
      description: `Tag description (max ${STRING_LENGTH_CONSTRAINTS.DESCRIPTION_SHORT_MAX} characters)`,
      example: "Items requiring immediate attention",
    }),
});

export type ICreateTagInput = z.infer<typeof SchemaTagCreateRequest>;

/**
 * Tag update request schema
 */
export const SchemaTagUpdateRequest = z.object({
  name: z.string()
    .min(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MIN)
    .max(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MAX)
    .optional()
    .openapi({
      description: "Updated tag name",
      example: "High Priority",
    }),
  color: SCHEMA_VALIDATION_HEX_COLOR.optional().openapi({
    description: "Updated hex color code",
    example: "#ff3333",
  }),
  description: z.string()
    .max(STRING_LENGTH_CONSTRAINTS.DESCRIPTION_SHORT_MAX)
    .optional()
    .nullable()
    .openapi({
      description: "Updated tag description",
      example: "Updated description",
    }),
});

export type IUpdateTagInput = z.infer<typeof SchemaTagUpdateRequest>;

/**
 * Tag response schema - standardized tag API response
 * Derived from SchemaDocumentTag, excluding internal fields
 */
export const SchemaDocumentTagResponse = SchemaDocumentTag.pick({
  id: true,
  name: true,
  color: true,
  description: true,
  usageCount: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Paginated tag list response schema
 */
export const SchemaTagListResponse = z.object({
  items: z.array(SchemaDocumentTagResponse),
  pagination: SchemaPaginationMetadata,
});

export type ITagListResponse = z.infer<typeof SchemaTagListResponse>;

/**
 * Tag list query schema
 */
export const SchemaTagListQuery = z.object({
  search: z.string()
    .max(STRING_LENGTH_CONSTRAINTS.SEARCH_QUERY_MAX)
    .optional()
    .openapi({
      description: "Search tags by name (case-insensitive)",
      example: "urgent",
    }),
  sortBy: z.enum(["name", "usageCount", "createdAt"]).default("name").openapi({
    description: "Sort field",
    example: "name",
  }),
  sortOrder: z.enum(["asc", "desc"]).default("asc").openapi({
    description: "Sort order",
    example: "asc",
  }),
  page: z.coerce.number().int().positive().default(1).openapi({
    description: "Page number for pagination",
    example: 1,
  }),
  limit: z.coerce.number().int().positive().max(500).default(100).openapi({
    description: "Number of items per page (max 500)",
    example: 100,
  }),
});

export type ITagListQuery = z.infer<typeof SchemaTagListQuery>;

/**
 * Bulk tag assignment request schema
 * Accepts either tagIds or tagNames (but not both)
 */
export const SchemaBulkTagAssignmentRequest = z.object({
  documentIds: z.array(z.string()).min(1).max(NUMERIC_LIMITS.MAX_USERS_PER_SHARE).openapi({
    description: `Array of document IDs (1-${NUMERIC_LIMITS.MAX_USERS_PER_SHARE})`,
    example: ["doc_abc", "doc_xyz"],
  }),
  tagIds: z.array(SCHEMA_TAG_ID).min(1).max(NUMERIC_LIMITS.MAX_TAGS_PER_DOCUMENT).optional().openapi({
    description: `Array of tag IDs to assign (1-${NUMERIC_LIMITS.MAX_TAGS_PER_DOCUMENT})`,
    example: ["tag_abc", "tag_xyz"],
  }),
  tagNames: z.array(z.string()).min(1).max(NUMERIC_LIMITS.MAX_TAGS_PER_DOCUMENT).optional().openapi({
    description: `Array of tag names to assign (1-${NUMERIC_LIMITS.MAX_TAGS_PER_DOCUMENT}). Tags will be auto-created if they don't exist.`,
    example: ["Urgent", "Important"],
  }),
}).refine(
  (data) => (data.tagIds && !data.tagNames) || (!data.tagIds && data.tagNames),
  {
    message: withKey("tags.either-ids-or-names", "Must provide either 'tagIds' or 'tagNames', but not both"),
  },
);

export type IBulkTagAssignmentInput = z.infer<typeof SchemaBulkTagAssignmentRequest>;

/**
 * @deprecated Use SchemaBulkTagAssignmentRequest instead
 */
export const SchemaBulkAssignTagsRequest = SchemaBulkTagAssignmentRequest;

/**
 * @deprecated Use IBulkTagAssignmentInput instead
 */
export type IBulkAssignTagsInput = IBulkTagAssignmentInput;

/**
 * Tag filters interface for internal use
 */
export interface ITagFilters {
  search?: string;
  sortBy?: "name" | "usageCount" | "createdAt";
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}
