/**
 * @file routes/documents-tags/documents-tags.route.ts
 * @description Documents Tags route definition
 */
import { createRoute, z } from "@deps";
import {
  SchemaDocumentTagResponse,
  SchemaTagCreateRequest,
  SchemaTagListQuery,
  SchemaTagListResponse,
  SchemaTagUpdateRequest,
} from "@models/documents/tag.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";

// Create tag route
export const createTagRoute = createRoute({
  method: "post",
  path: "/",
  operationId: "documentTagCreate",
  summary: "Create document tag",
  description: `Creates a new tag owned by the authenticated user in the current environment.

**Behavior:** Validates tag-name uniqueness for the user, auto-generates a color when omitted, seeds \`usageCount\` to 0, and invalidates the stats cache.
**Auth:** cookie session
**Permissions:** none beyond auth
**Notes:** tenant-scoped; tag names are unique per user.`,
  tags: [OpenAPITagsDocumentFeature.tags],
  request: {
    ...withJsonBody(SchemaTagCreateRequest),
  },
  responses: {
    201: {
      description: "Tag created successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentTagResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// List tags route
export const listTagsRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "documentTagsList",
  summary: "List document tags",
  description: `Returns the authenticated user's tags, paginated, with search and sort options.

**Behavior:** Filters by name (case-insensitive) and sorts by name, usage count, or creation date. Response includes pagination metadata.
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own tags are returned)
**Notes:** tenant-scoped; up to 500 items per page.`,
  tags: [OpenAPITagsDocumentFeature.tags],
  request: {
    query: SchemaTagListQuery,
  },
  responses: {
    200: {
      description: "Tags retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaTagListResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// Get tag by ID or name route
export const getTagRoute = createRoute({
  method: "get",
  path: "/{idOrName}",
  operationId: "documentTagGet",
  summary: "Get document tag",
  description: `Retrieves a single tag by ID or name.

**Behavior:** Looks up the tag scoped to the authenticated user, matching on ID first then falling back to name.
**Auth:** cookie session
**Permissions:** none beyond auth (404 if not found or not owned)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.tags],
  request: {
    params: z.object({
      idOrName: z.string().openapi({
        description: "Tag ID or name",
        example: "tag_abc123",
      }),
    }),
  },
  responses: {
    200: {
      description: "Tag retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentTagResponse,
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseUnauthorized,
  },
});

// Update tag route
export const updateTagRoute = createRoute({
  method: "patch",
  path: "/{idOrName}",
  operationId: "documentTagUpdate",
  summary: "Update document tag",
  description: `Updates a tag's name, color, or description.

**Behavior:** Resolves the tag by ID or name, applies the partial update, and rejects name conflicts with another existing tag.
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own tag; 404 otherwise)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.tags],
  request: {
    params: z.object({
      idOrName: z.string().openapi({
        description: "Tag ID or name",
        example: "tag_abc123",
      }),
    }),
    ...withJsonBody(SchemaTagUpdateRequest),
  },
  responses: {
    200: {
      description: "Tag updated successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentTagResponse,
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseForbidden,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// Delete tag route
export const deleteTagRoute = createRoute({
  method: "delete",
  path: "/{idOrName}",
  operationId: "documentTagDelete",
  summary: "Delete document tag",
  description: `Permanently deletes a tag and removes all of its document-tag assignments.

**Behavior:** Resolves the tag by ID or name, deletes every \`documentTagAssignments\` row referencing it, then deletes the tag itself, and invalidates the stats cache. The tag is removed even when currently in use.
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own tag; 404 otherwise)
**Notes:** tenant-scoped; this is a hard delete that cascades to tag assignments.`,
  tags: [OpenAPITagsDocumentFeature.tags],
  request: {
    params: z.object({
      idOrName: z.string().openapi({
        description: "Tag ID or name",
        example: "tag_abc123",
      }),
    }),
  },
  responses: {
    204: {
      description: "Tag deleted successfully",
    },
    ...httpResponseNotFound,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
  },
});
