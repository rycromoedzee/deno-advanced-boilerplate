/**
 * @file routes/documents-comments/documents-comments.route.ts
 * @description Documents Comments route definition
 */
import { createRoute, z } from "@deps";
import {
  SCHEMA_COMMENT_ID,
  SchemaCommentCreateRequest,
  SchemaCommentListQuery,
  SchemaDocumentCommentApiResponse,
} from "@models/documents/comment.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";

// Document ID parameter schema
const SCHEMA_DOCUMENT_ID = z.string().openapi({
  description: "Document ID",
  example: "doc_abc123",
  param: {
    name: "documentId",
    in: "path",
  },
});

// Create comment route
export const createCommentRoute = createRoute({
  method: "post",
  path: "/{documentId}/comments",
  operationId: "documentCommentCreate",
  summary: "Create document comment",
  description: `Creates a new comment (optionally a reply) on a document.

**Behavior:** Validates the document exists and the caller has access, then inserts the comment with the authenticated user as the author. A \`parentCommentId\` creates a threaded reply (the parent must exist on the same document).
**Auth:** cookie session
**Permissions:** caller must have access to the document (404 otherwise)
**Notes:** tenant-scoped; comment content is plain text with a length limit.`,
  tags: [OpenAPITagsDocumentFeature.comments],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
    }),
    ...withJsonBody(SchemaCommentCreateRequest),
  },
  responses: {
    201: {
      description: "Comment created successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentCommentApiResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

// List comments route
export const listCommentsRoute = createRoute({
  method: "get",
  path: "/{documentId}/comments",
  operationId: "documentCommentsList",
  summary: "List document comments",
  description: `Returns a paginated, threaded view of a document's comments.

**Behavior:** Fetches top-level comments with their nested replies and filters by resolution/archival status. Excludes archived comments unless \`includeArchived\` is set.
**Auth:** cookie session
**Permissions:** caller must have access to the document (404 otherwise)
**Notes:** tenant-scoped; pagination applies to top-level comments (max 100/page).`,
  tags: [OpenAPITagsDocumentFeature.comments],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
    }),
    query: SchemaCommentListQuery,
  },
  responses: {
    200: {
      description: "Comments retrieved successfully",
      content: {
        "application/json": {
          schema: z.array(SchemaDocumentCommentApiResponse),
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

// Get comment by ID route
export const getCommentRoute = createRoute({
  method: "get",
  path: "/{documentId}/comments/{commentId}",
  operationId: "documentCommentGet",
  summary: "Get document comment",
  description: `Retrieves a single comment (with author info) by ID.

**Behavior:** Looks up the comment scoped to the given document and returns it with its populated author/resolver fields.
**Auth:** cookie session
**Permissions:** caller must have access to the parent document (404 otherwise)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.comments],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
      commentId: SCHEMA_COMMENT_ID,
    }),
  },
  responses: {
    200: {
      description: "Comment retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentCommentApiResponse,
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// Delete comment route
export const deleteCommentRoute = createRoute({
  method: "delete",
  path: "/{documentId}/comments/{commentId}",
  operationId: "documentCommentDelete",
  summary: "Delete document comment",
  description: `Archives (soft-deletes) a comment.

**Behavior:** Marks the comment as archived rather than removing the row. The caller must have access to the parent document.
**Auth:** cookie session
**Permissions:** caller must have access to the document (404 otherwise)
**Notes:** tenant-scoped; soft delete — the row is retained.`,
  tags: [OpenAPITagsDocumentFeature.comments],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
      commentId: SCHEMA_COMMENT_ID,
    }),
  },
  responses: {
    204: {
      description: "Comment deleted successfully",
    },
    ...httpResponseNotFound,
    ...httpResponseForbidden,
    ...httpResponseUnauthorized,
  },
});

// Resolve comment route
export const resolveCommentRoute = createRoute({
  method: "post",
  path: "/{documentId}/comments/{commentId}/resolve",
  operationId: "documentCommentResolve",
  summary: "Resolve document comment",
  description: `Marks a comment as resolved.

**Behavior:** Sets \`isResolved\` to true and records the authenticated user as the resolver.
**Auth:** cookie session
**Permissions:** caller must have access to the parent document (404 otherwise)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.comments],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
      commentId: SCHEMA_COMMENT_ID,
    }),
  },
  responses: {
    200: {
      description: "Comment resolved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentCommentApiResponse,
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// Unresolve comment route
export const unresolveCommentRoute = createRoute({
  method: "post",
  path: "/{documentId}/comments/{commentId}/unresolve",
  operationId: "documentCommentUnresolve",
  summary: "Unresolve document comment",
  description: `Marks a resolved comment as unresolved again.

**Behavior:** Clears the resolved state (and resolver fields) on the comment.
**Auth:** cookie session
**Permissions:** caller must have access to the parent document (404 otherwise)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.comments],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
      commentId: SCHEMA_COMMENT_ID,
    }),
  },
  responses: {
    200: {
      description: "Comment unresolved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentCommentApiResponse,
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
