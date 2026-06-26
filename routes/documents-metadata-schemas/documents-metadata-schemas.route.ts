/**
 * @file routes/documents-metadata-schemas/documents-metadata-schemas.route.ts
 * @description Documents Metadata Schemas route definition
 */
import { createRoute, z } from "@deps";
import {
  SchemaDocumentMetadataSchemaResponse,
  SchemaMetadataSchemaCreateRequest,
  SchemaMetadataSchemaListQuery,
  SchemaMetadataSchemaUpdateRequest,
} from "@models/documents/metadata-schema.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";

// Create metadata schema route
export const createMetadataSchemaRoute = createRoute({
  method: "post",
  path: "/",
  operationId: "documentMetadataSchemaCreate",
  summary: "Create metadata schema",
  description: `Creates a new document metadata schema (custom field) for the current user.

**Behavior:** Validates key uniqueness for the user, inserts the schema, then migrates existing documents to apply the new field (e.g. back-filling the default value).
**Auth:** cookie session
**Permissions:** none beyond auth
**Notes:** tenant-scoped; the key must be unique per user and match \`^[a-zA-Z_][a-zA-Z0-9_]*$\`.`,
  tags: [OpenAPITagsDocumentFeature.metadataSchemas],
  request: {
    ...withJsonBody(SchemaMetadataSchemaCreateRequest),
  },
  responses: {
    201: {
      description: "Metadata schema created successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentMetadataSchemaResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// List metadata schemas route
export const listMetadataSchemasRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "documentMetadataSchemasList",
  summary: "List metadata schemas",
  description: `Returns the authenticated user's document metadata schemas, with search and sort options.

**Behavior:** Optionally filters by type and searches across name/key; results are sorted by name, key, or creation date.
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own schemas)
**Notes:** tenant-scoped; not paginated.`,
  tags: [OpenAPITagsDocumentFeature.metadataSchemas],
  request: {
    query: SchemaMetadataSchemaListQuery,
  },
  responses: {
    200: {
      description: "Metadata schemas retrieved successfully",
      content: {
        "application/json": {
          schema: z.array(SchemaDocumentMetadataSchemaResponse),
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// Get metadata schema by ID or key route
export const getMetadataSchemaRoute = createRoute({
  method: "get",
  path: "/{idOrKey}",
  operationId: "documentMetadataSchemaGet",
  summary: "Get metadata schema",
  description: `Retrieves a single metadata schema by ID or key.

**Behavior:** Looks up the schema scoped to the authenticated user, matching on ID first then key.
**Auth:** cookie session
**Permissions:** none beyond auth (404 if not found or not owned)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.metadataSchemas],
  request: {
    params: z.object({
      idOrKey: z.string().openapi({
        description: "Metadata schema ID or key",
        example: "schema_abc123",
      }),
    }),
  },
  responses: {
    200: {
      description: "Metadata schema retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentMetadataSchemaResponse,
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseUnauthorized,
  },
});

// Update metadata schema route
export const updateMetadataSchemaRoute = createRoute({
  method: "patch",
  path: "/{idOrKey}",
  operationId: "documentMetadataSchemaUpdate",
  summary: "Update metadata schema",
  description: `Updates a metadata schema's name, required flag, or default value.

**Behavior:** Resolves the schema by ID or key, applies the partial update, then migrates existing documents to reflect the change (e.g. a new default value or required constraint).
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own schema; 404 otherwise)
**Notes:** tenant-scoped; the key and type are not editable.`,
  tags: [OpenAPITagsDocumentFeature.metadataSchemas],
  request: {
    params: z.object({
      idOrKey: z.string().openapi({
        description: "Metadata schema ID or key",
        example: "schema_abc123",
      }),
    }),
    ...withJsonBody(SchemaMetadataSchemaUpdateRequest),
  },
  responses: {
    200: {
      description: "Metadata schema updated successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentMetadataSchemaResponse,
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseForbidden,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// Delete metadata schema route
export const deleteMetadataSchemaRoute = createRoute({
  method: "delete",
  path: "/{idOrKey}",
  operationId: "documentMetadataSchemaDelete",
  summary: "Delete metadata schema",
  description: `Deletes a metadata schema (custom field) by ID or key.

**Behavior:** Resolves the schema by ID or key, then removes it for the authenticated user.
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own schema; 404 otherwise)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.metadataSchemas],
  request: {
    params: z.object({
      idOrKey: z.string().openapi({
        description: "Metadata schema ID or key",
        example: "schema_abc123",
      }),
    }),
  },
  responses: {
    204: {
      description: "Metadata schema deleted successfully",
    },
    ...httpResponseNotFound,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
  },
});
