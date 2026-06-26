/**
 * @file routes/documents-sharing/documents-sharing.route.ts
 * @description Document sharing routes with OpenAPI specifications
 */

import { createRoute, z } from "@deps";
import {
  SchemaDocumentAccessLogsResponse,
  SchemaDocumentDisablePublicShareRequest,
  SchemaDocumentPermissionsResponse,
  SchemaDocumentPermissionUpdateRequest,
  SchemaDocumentPermissionUpdateResponse,
  SchemaDocumentPublicShareRequest,
  SchemaDocumentPublicShareResponse,
  SchemaDocumentShareRequest,
  SchemaDocumentShareResponse,
} from "@models/documents/document-sharing.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";
import { SCHEMA_DOCUMENT_ID } from "@models/documents/index.ts";

/**
 * Share document with internal users route
 * POST /api/documents/{documentId}/share
 */
export const shareDocumentRoute = createRoute({
  method: "post",
  path: "/{documentId}/share",
  summary: "Share document with internal users",
  operationId: "documentShareCreate",
  description:
    "Shares a document with one or more internal users at a specified permission level.\n\n**Behavior:** Resolves the caller's encryption key and re-keys the document for each recipient, then emits an in-app `document_shared` notification (best-effort, non-blocking) to each successfully shared user. Returns the list of users actually shared with (failures are filtered out).\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the document\n**Notes:** tenant-scoped; notification emission failures are logged but do not fail the request.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
    }),
    ...withJsonBody(SchemaDocumentShareRequest),
  },
  responses: {
    200: {
      description: "Document shared successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentShareResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

/**
 * List document permissions route
 * GET /api/documents/{documentId}/permissions
 */
export const listDocumentPermissionsRoute = createRoute({
  method: "get",
  path: "/{documentId}/permissions",
  summary: "List document permissions",
  operationId: "documentShareList",
  description:
    "Retrieves all users with access to a document, plus the document's public share configurations.\n\n**Behavior:** Returns the owner, the internal shared users (with email/name and read/write permission), and any public shares (token, url, password flag, expiration, recipient email). Decrypts public-share metadata using the caller's encryption key.\n**Auth:** cookie session\n**Permissions:** caller must have read access to the document\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
    }),
    ...withJsonBody(z.object({
      documentId: z.string().openapi({
        description: "ID of the document",
        example: "lj31mk8hewwv5wwx",
      }),
    })),
  },
  responses: {
    200: {
      description: "Permissions retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentPermissionsResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

/**
 * Revoke document access route
 * DELETE /api/documents/{documentId}/permissions/{userId}
 */
export const revokeDocumentAccessRoute = createRoute({
  method: "delete",
  path: "/{documentId}/permissions/{userId}",
  summary: "Revoke user access to document",
  operationId: "documentShareRevoke",
  description:
    "Revokes a user's access to a document.\n\n**Behavior:** Removes the target user's permission grant on the document.\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the document\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
      userId: z.string().openapi({
        description: "ID of the user whose access should be revoked",
        example: "456e7890-e89b-12d3-a456-426614174000",
      }),
    }),
  },
  responses: {
    204: {
      description: "User access revoked successfully",
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

/**
 * Update document permission route
 * PATCH /api/documents/{documentId}/permissions/{userId}
 */
export const updateDocumentPermissionRoute = createRoute({
  method: "patch",
  path: "/{documentId}/permissions/{userId}",
  summary: "Update user permission level",
  operationId: "documentShareUpdate",
  description:
    "Updates a user's permission level for a document (read or write).\n\n**Behavior:** Validates the requested permission against the access-level enum and applies the change via the sharing service.\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the document\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
    }),
    ...withJsonBody(SchemaDocumentPermissionUpdateRequest),
  },
  responses: {
    200: {
      description: "Permission updated successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentPermissionUpdateResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

/**
 * Create public document share route
 * POST /api/documents/{documentId}/public-share
 */
export const createPublicDocumentShareRoute = createRoute({
  method: "post",
  path: "/{documentId}/public-share",
  summary: "Create public share link for document",
  operationId: "documentPublicShareCreate",
  description:
    "Creates a public share link for a document with optional password protection, expiration, and recipient email.\n\n**Behavior:** Validates the share options, then generates a public share token and URL via the generic public-share creator. Returns the token, share URL, password flag, and expiration.\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the document\n**Notes:** tenant-scoped; zero-knowledge — the share key is delivered out-of-band (URL fragment) and never reaches the server in the URL.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
    }),
    ...withJsonBody(SchemaDocumentPublicShareRequest),
  },
  responses: {
    200: {
      description: "Public share created successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentPublicShareResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

/**
 * Disable public document share route
 * DELETE /api/documents/{documentId}/public-share
 */
export const disablePublicDocumentShareRoute = createRoute({
  method: "delete",
  path: "/{documentId}/public-share",
  summary: "Disable public share",
  operationId: "documentPublicShareDisable",
  description:
    "Disables public sharing for a document.\n\n**Behavior:** If a `token` query parameter is provided, only that specific share is disabled; otherwise all public shares for the document are disabled.\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the document\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
    }),
    query: SchemaDocumentDisablePublicShareRequest,
  },
  responses: {
    204: {
      description: "Public share disabled successfully",
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

/**
 * Get document access logs route
 * GET /api/documents/{documentId}/access-logs
 */
export const getDocumentAccessLogsRoute = createRoute({
  method: "get",
  path: "/{documentId}/access-logs",
  summary: "Get document access logs",
  operationId: "documentAccessLogs",
  description:
    "Retrieves access logs for a document with optional filtering and pagination.\n\n**Behavior:** Verifies the caller has at least READ permission on the document, then returns filtered/paginated log entries. Supports filtering by user, access type, access method, success status, and date range (Unix timestamps). Defaults to page 1, 50 items per page (max 100).\n**Auth:** cookie session\n**Permissions:** caller must have at least READ access to the document\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    params: z.object({
      documentId: SCHEMA_DOCUMENT_ID,
    }),
    query: z.object({
      userId: z.string().optional().openapi({
        description: "Filter by user ID (omit to include all users)",
        example: "456e7890-e89b-12d3-a456-426614174000",
      }),
      accessType: z.string().optional().openapi({
        description: "Filter by access type (view, download, share, update_permission, etc.)",
        example: "view",
      }),
      accessMethod: z.string().optional().openapi({
        description: "Filter by access method (direct, public_share, internal_share)",
        example: "direct",
      }),
      success: z.string().optional().openapi({
        description: "Filter by success status (true or false)",
        example: "true",
      }),
      startDate: z.string().optional().openapi({
        description: "Filter by start date (Unix timestamp in seconds)",
        example: "1704067200",
      }),
      endDate: z.string().optional().openapi({
        description: "Filter by end date (Unix timestamp in seconds)",
        example: "1704153600",
      }),
      page: z.string().optional().openapi({
        description: "Page number (default: 1)",
        example: "1",
      }),
      limit: z.string().optional().openapi({
        description: "Items per page (default: 50, max: 100)",
        example: "50",
      }),
    }),
  },
  responses: {
    200: {
      description: "Access logs retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentAccessLogsResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});
