/**
 * @file models/documents/metadata-schema.model.ts
 * @description Metadata Schema model/types
 */
import { z } from "@deps";
import { SCHEMA_VALIDATION_TIMESTAMP } from "@models/shared.model.ts";
import { STRING_LENGTH_CONSTRAINTS } from "@constants/validation/string-lengths.ts";
import { tables } from "@db/index.ts";

/**
 * @file models/documents/metadata-schema.model.ts
 * @description Document metadata schema models and validation
 */

// Metadata schema ID validation
export const SCHEMA_METADATA_SCHEMA_ID = z.string().openapi({
  description: "Metadata schema identifier",
  example: "schema_abc123xyz",
});

/**
 * Metadata schema type enum
 */
export const MetadataSchemaType = z.enum(["text", "number", "boolean"]).openapi({
  description: "Type of metadata field",
  example: "text",
});

export type IMetadataSchemaType = z.infer<typeof MetadataSchemaType>;

/**
 * Document metadata schema - matches database schema
 */
export const SchemaDocumentMetadataSchema = z.object({
  id: z.string().openapi({
    description: "Metadata schema identifier",
    example: "schema_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  userId: z.string().openapi({
    description: "User ID who owns the schema",
    example: "user_01j2x3k4m5n6p7q8r9s0tuvw",
  }),
  name: z.string().openapi({
    description: "Human-readable field name",
    example: "Project Status",
  }),
  key: z.string().openapi({
    description: "Machine-readable field key (unique per user)",
    example: "project_status",
  }),
  type: MetadataSchemaType,
  isRequired: z.boolean().openapi({
    description: "Whether the field is required on documents",
    example: false,
  }),
  defaultValue: z.string().nullable().openapi({
    description: "Default value applied to documents (stored as string)",
    example: "pending",
  }),
  createdAt: SCHEMA_VALIDATION_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when the schema was created",
    example: 1719340800,
  }),
  updatedAt: SCHEMA_VALIDATION_TIMESTAMP.openapi({
    description: "Unix timestamp (seconds) when the schema was last updated",
    example: 1719340800,
  }),
}) satisfies z.ZodType<typeof tables.documentMetadataSchemas.$inferSelect>;

export type IDocumentMetadataSchema = z.infer<typeof SchemaDocumentMetadataSchema>;

/**
 * Metadata schema create request
 */
export const SchemaMetadataSchemaCreateRequest = z.object({
  name: z.string()
    .min(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MIN)
    .max(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MAX)
    .openapi({
      description: `Schema field name (${STRING_LENGTH_CONSTRAINTS.TAG_NAME_MIN}-${STRING_LENGTH_CONSTRAINTS.TAG_NAME_MAX} characters)`,
      example: "Project Status",
    }),
  key: z.string()
    .min(1)
    .max(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MAX)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
    .openapi({
      description: "Schema field key (alphanumeric and underscores, must start with letter or underscore)",
      example: "project_status",
    }),
  type: MetadataSchemaType,
  isRequired: z.boolean().default(false).openapi({
    description: "Whether this field is required when creating/updating documents",
    example: false,
  }),
  defaultValue: z.string()
    .max(STRING_LENGTH_CONSTRAINTS.DESCRIPTION_SHORT_MAX)
    .optional()
    .nullable()
    .openapi({
      description: "Default value for this field (stored as string, converted based on type)",
      example: "pending",
    }),
});

export type ICreateMetadataSchemaInput = z.infer<typeof SchemaMetadataSchemaCreateRequest>;

/**
 * Metadata schema update request
 */
export const SchemaMetadataSchemaUpdateRequest = z.object({
  name: z.string()
    .min(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MIN)
    .max(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MAX)
    .optional()
    .openapi({
      description: "Updated schema field name",
      example: "Updated Status",
    }),
  isRequired: z.boolean().optional().openapi({
    description: "Updated required flag",
    example: true,
  }),
  defaultValue: z.string()
    .max(STRING_LENGTH_CONSTRAINTS.DESCRIPTION_SHORT_MAX)
    .optional()
    .nullable()
    .openapi({
      description: "Updated default value",
      example: "active",
    }),
});

export type IUpdateMetadataSchemaInput = z.infer<typeof SchemaMetadataSchemaUpdateRequest>;

/**
 * Metadata schema response
 */
export const SchemaDocumentMetadataSchemaResponse = SchemaDocumentMetadataSchema.pick({
  id: true,
  name: true,
  key: true,
  type: true,
  isRequired: true,
  defaultValue: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Metadata schema list query
 */
export const SchemaMetadataSchemaListQuery = z.object({
  search: z.string()
    .max(STRING_LENGTH_CONSTRAINTS.SEARCH_QUERY_MAX)
    .optional()
    .openapi({
      description: "Search schemas by name or key (case-insensitive)",
      example: "status",
    }),
  type: MetadataSchemaType.optional().openapi({
    description: "Filter by type",
    example: "text",
  }),
  sortBy: z.enum(["name", "key", "createdAt"]).default("name").openapi({
    description: "Sort field",
    example: "name",
  }),
  sortOrder: z.enum(["asc", "desc"]).default("asc").openapi({
    description: "Sort order",
    example: "asc",
  }),
});

export type IMetadataSchemaListQuery = z.infer<typeof SchemaMetadataSchemaListQuery>;

/**
 * Metadata schema filters interface for internal use
 */
export interface IMetadataSchemaFilters {
  search?: string;
  type?: IMetadataSchemaType;
  sortBy?: "name" | "key" | "createdAt";
  sortOrder?: "asc" | "desc";
}

/**
 * Metadata validation result
 */
export interface IMetadataValidationResult {
  valid: boolean;
  errors: Array<{
    key: string;
    error: string;
  }>;
}
