/**
 * @file models/shared.model.ts
 * @description Shared model types used across domains
 */
import { z } from "@deps";
import { PAGINATION_DEFAULTS, SORT_ORDER } from "@constants/pagination.ts";
import { REGEX_PATTERNS } from "@constants/validation/regex-patterns.ts";

/**
 * Bulk operation error schema
 * @param idField - The field name for the identifier (e.g., 'documentId', 'userId', 'folderId')
 */

const SchemaBulkOperationError = <T extends string>(idField: T) =>
  z.object({
    [idField]: z.string(),
    error: z.string(),
  });

export const SchemaBulkOperationResponse = <T extends string>(idField: T) =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.object({
      failedCount: z.number(),
      errors: z.array(SchemaBulkOperationError(idField)),
    }),
  });

/**
 * Timestamp validation schema (Unix timestamp in seconds)
 */
export const SCHEMA_VALIDATION_TIMESTAMP = z.number().int().nonnegative()
  .transform((timestamp) => {
    // Threshold to detect millisecond timestamps (year 2100 in seconds)
    const MS_THRESHOLD = 4102444800;

    if (timestamp > MS_THRESHOLD) {
      return Math.floor(timestamp / 1000);
    }
    return timestamp;
  })
  .openapi({
    description: "Unix timestamp in seconds",
    example: 1704067200,
  });

/**
 * Timestamp schemas
 */
export const SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP = SCHEMA_VALIDATION_TIMESTAMP.nullable().optional().openapi({
  description: "Optional unix timestamp in seconds",
  example: 1704067200,
});

export const SCHEMA_NULLABLE_TIMESTAMP = SCHEMA_VALIDATION_TIMESTAMP.nullable().openapi({
  description: "Unix timestamp in seconds or null",
  example: 1704067200,
});

export const SCHEMA_TIMESTAMP = SCHEMA_VALIDATION_TIMESTAMP.openapi({
  description: "Unix timestamp in seconds",
  example: "1704067200",
});

/**
 * Hex color validation schema
 */
export const SCHEMA_VALIDATION_HEX_COLOR = z.string().regex(REGEX_PATTERNS.HEX_COLOR).openapi({
  description: "Hex color code",
  example: "#3b82f6",
});

/**
 * Tag array validation schema
 */
export const SCHEMA_VALIDATION_TAGS = z.array(z.string()).default([]).openapi({
  description: "Array of tags",
  example: ["tag1", "tag2"],
});

/**
 * Pagination query parameters schema
 */
export const SchemaPaginationQuery = z.object({
  page: z.coerce.number().int().positive().default(PAGINATION_DEFAULTS.DEFAULT_PAGE),
  limit: z.coerce.number().int().positive().max(PAGINATION_DEFAULTS.MAX_LIMIT).default(PAGINATION_DEFAULTS.DEFAULT_LIMIT),
  sortBy: z.string().optional(),
  sortOrder: z.enum([SORT_ORDER.ASC, SORT_ORDER.DESC]).default(PAGINATION_DEFAULTS.DEFAULT_SORT_ORDER),
});

export type IPaginationQuery = z.infer<typeof SchemaPaginationQuery>;

/**
 * Pagination metadata schema
 */
export const SchemaPaginationMetadata = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export type IPaginationMetadata = z.infer<typeof SchemaPaginationMetadata>;

/**
 * Generic paginated response schema factory
 */
export const SchemaPaginatedResponse = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    pagination: SchemaPaginationMetadata,
  });
