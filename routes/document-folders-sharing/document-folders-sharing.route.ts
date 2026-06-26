/**
 * @file routes/document-folders-sharing/document-folders-sharing.route.ts
 * @description Document Folders Sharing route definition
 */
import { createRoute, z } from "@deps";
import {
  SchemaFolderAccessLogsResponse,
  SchemaFolderPermissionsResponse,
  SchemaFolderPermissionUpdateRequest,
  SchemaFolderPublicShareRequest,
  SchemaFolderPublicShareResponse,
  SchemaFolderSharedUser,
  SchemaFolderShareRequest,
  SchemaFolderShareResponse,
} from "@models/documents/folder-sharing.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { SCHEMA_DOCUMENT_FOLDER_ID } from "@models/documents/index.ts";
import { SCHEMA_USER_ID } from "@models/users/index.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";

/**
 * Minimal folder schema for public folder access
 * Returns only essential folder information
 */
const MinimalPublicFolderSchema = z.object({
  name: z.string(),
  color: z.string(),
  icon: z.string(),
});

/**
 * Minimal document schema for public folder document listing
 * Returns only essential document information
 */
const MinimalPublicDocumentSchema = z.object({
  name: z.string(),
  contentType: z.string().nullable(),
  fileSize: z.number().int().nonnegative(),
});

/**
 * Combined response schema for public folder document listing
 */
export const SchemaPublicFolderDocumentsResponse = z.object({
  folder: MinimalPublicFolderSchema,
  documents: z.array(MinimalPublicDocumentSchema),
});

export const shareFolderRoute = createRoute({
  method: "post",
  path: "/{folderId}/share",
  summary: "Share folder with internal users",
  operationId: "documentFolderShareCreate",
  description:
    "Shares a folder with one or more internal users at a specified permission level. Automatically applies sharing to all existing documents and subfolders.\n\n**Behavior:** Resolves the caller's encryption key (user master key for user-controlled encryption; app keys cannot decrypt user-encrypted data) and propagates access recursively. Returns counts of documents/subfolders shared plus per-user results.\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the folder\n**Notes:** tenant-scoped; zero-knowledge key handling — the user master key is only used for user-controlled encryption modes.",
  tags: [OpenAPITagsDocumentFeature.folderSharing],
  request: {
    params: z.object({
      folderId: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
    ...withJsonBody(SchemaFolderShareRequest),
  },
  responses: {
    200: {
      description: "Folder shared successfully",
      content: {
        "application/json": {
          schema: SchemaFolderShareResponse,
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
 * List folder permissions route
 * GET /api/v1/folders/{folderId}/permissions
 */
export const listFolderPermissionsRoute = createRoute({
  method: "get",
  path: "/{folderId}/permissions",
  summary: "List folder permissions",
  operationId: "documentFolderShareList",
  description:
    "Retrieves all internal users with access to a folder plus the folder's public share configuration.\n\n**Behavior:** Returns the list of shared users (with permission levels) and the public-share state (enabled flag, token, expiration).\n**Auth:** cookie session\n**Permissions:** caller must have read access to the folder\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.folderSharing],
  request: {
    params: z.object({
      folderId: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
  },
  responses: {
    200: {
      description: "Permissions retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaFolderPermissionsResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

/**
 * Revoke user access route
 * DELETE /api/v1/folders/{folderId}/permissions/{userId}
 */
export const revokeUserAccessRoute = createRoute({
  method: "delete",
  path: "/{folderId}/permissions/{userId}",
  summary: "Revoke user access to folder",
  operationId: "documentFolderShareRevoke",
  description:
    "Revokes a user's access to a folder.\n\n**Behavior:** Removes the target user's permission grant on the folder.\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the folder\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.folderSharing],
  request: {
    params: z.object({
      folderId: SCHEMA_DOCUMENT_FOLDER_ID,
      userId: SCHEMA_USER_ID,
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
 * Update user permission level route
 * PATCH /api/v1/folders/{folderId}/permissions/{userId}
 */
export const updateUserPermissionRoute = createRoute({
  method: "patch",
  path: "/{folderId}/permissions/{userId}",
  summary: "Update user permission level",
  operationId: "documentFolderShareUpdate",
  description:
    "Updates a user's permission level for a folder.\n\n**Behavior:** Implemented as a revoke-then-reshare sequence (not a single atomic update): the target's existing access is revoked, then they are re-shared at the new level using the caller's encryption key. A crash between steps would leave the target without access.\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the folder\n**Notes:** tenant-scoped; zero-knowledge key handling applies on the re-share step.",
  tags: [OpenAPITagsDocumentFeature.folderSharing],
  request: {
    params: z.object({
      folderId: SCHEMA_DOCUMENT_FOLDER_ID,
      userId: SCHEMA_USER_ID,
    }),
    ...withJsonBody(SchemaFolderPermissionUpdateRequest),
  },
  responses: {
    200: {
      description: "Permission updated successfully",
      content: {
        "application/json": {
          schema: SchemaFolderSharedUser,
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
 * Create public share route
 * POST /api/v1/folders/{folderId}/public-share
 */
export const createPublicShareRoute = createRoute({
  method: "post",
  path: "/{folderId}/public-share",
  summary: "Create public share link",
  operationId: "documentFolderPublicShareCreate",
  description:
    "Creates a public share link for a folder with optional password protection and expiration.\n\n**Behavior:** Generates a share URL and token; public shares grant read-only access to direct child documents only (no recursive access to subfolders). The caller's encryption key is used to set up the public data key.\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the folder\n**Notes:** tenant-scoped; zero-knowledge — the public share key is wrapped so the server cannot decrypt without the share key from the URL fragment.",
  tags: [OpenAPITagsDocumentFeature.folderSharing],
  request: {
    params: z.object({
      folderId: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
    ...withJsonBody(SchemaFolderPublicShareRequest),
  },
  responses: {
    201: {
      description: "Public share created successfully",
      content: {
        "application/json": {
          schema: SchemaFolderPublicShareResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

/**
 * Disable public share route
 * DELETE /api/v1/folders/{folderId}/public-share
 */
export const disablePublicShareRoute = createRoute({
  method: "delete",
  path: "/{folderId}/public-share",
  summary: "Disable public share",
  operationId: "documentFolderPublicShareDisable",
  description:
    "Disables public sharing for a folder, clearing the share token and all public share configuration.\n\n**Behavior:** Revokes the folder's public share so existing links no longer resolve.\n**Auth:** cookie session\n**Permissions:** caller must have share/admin access to the folder\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.folderSharing],
  request: {
    params: z.object({
      folderId: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
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
 * Get folder access logs route
 * GET /api/v1/folders/{folderId}/access-logs
 */
export const getFolderAccessLogsRoute = createRoute({
  method: "get",
  path: "/{folderId}/access-logs",
  summary: "Get folder access logs",
  operationId: "documentFolderAccessLogs",
  description:
    "Retrieves access logs for a folder with optional filtering and pagination.\n\n**Behavior:** Supports filtering by user, access type, access method, success status, and date range (Unix timestamps). Defaults to page 1, 50 items per page (max 100).\n**Auth:** cookie session\n**Permissions:** authenticated access; the service scopes results to the requested folder\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.folderSharing],
  request: {
    params: z.object({
      folderId: z.string().openapi({
        description: "ID of the folder",
        example: "123e4567-e89b-12d3-a456-426614174000",
      }),
    }),
    query: z.object({
      userId: z.string().optional().openapi({
        description: "Filter by user ID (omit to include all users)",
        example: "456e7890-e89b-12d3-a456-426614174000",
      }),
      accessType: z.string().optional().openapi({
        description: "Filter by access type (view, list, access_child)",
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
          schema: SchemaFolderAccessLogsResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});
