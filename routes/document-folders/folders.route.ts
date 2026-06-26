/**
 * @file routes/document-folders/folders.route.ts
 * @description Folders route definition
 */
import { createRoute, z } from "@deps";
import {
  SchemaDocumentFolderResponse,
  SchemaFolderCreateRequest,
  SchemaFolderListQuery,
  SchemaFolderListResponse,
  SchemaFolderMoveRequest,
  SchemaFolderUpdateRequest,
} from "@models/documents/folder.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";
import { SCHEMA_DOCUMENT_FOLDER_ID } from "@models/documents/index.ts";

/**
 * @file routes/documents/folders.route.ts
 * @description Folder management routes with OpenAPI specifications
 * Requirements: 5.6, 5.7, 6.1, 6.6, 6.9
 */

// Create folder route
export const createFolderRoute = createRoute({
  method: "post",
  path: "/",
  summary: "Create folder",
  operationId: "documentFolderCreate",
  description:
    "Creates a new folder, optionally nested under a parent folder.\n\n**Behavior:** Validates name/description/tags/metadata against security-threat rules before creating; derives `environmentId` and `ownerId` server-side from the session.\n**Auth:** cookie session\n**Permissions:** none beyond auth\n**Notes:** tenant-scoped; user-supplied inputs are run through threat validation and rejected as bad request if malicious.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    body: {
      content: {
        "application/json": {
          schema: SchemaFolderCreateRequest,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Folder created successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentFolderResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
  },
});

// List folders route
export const listFoldersRoute = createRoute({
  method: "get",
  path: "/",
  summary: "List folders",
  operationId: "documentFoldersList",
  description:
    "Lists the direct children of a parent folder (or root) for the current user, with the breadcrumb path back to root.\n\n**Behavior:** Returns only folders accessible to the caller; supports archive-status and search filtering. Includes computed pagination metadata and breadcrumbs.\n**Auth:** cookie session\n**Permissions:** scoped to folders the caller owns or is shared on\n**Notes:** tenant-scoped; pass `parentFolderId=null` for root-level folders.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    query: SchemaFolderListQuery,
  },
  responses: {
    200: {
      description: "Folders retrieved successfully with breadcrumb path",
      content: {
        "application/json": {
          schema: SchemaFolderListResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
  },
});

// List shared folders route
export const listSharedFoldersRoute = createRoute({
  method: "get",
  path: "/shared-with-me",
  summary: "List folders shared with me",
  operationId: "documentFoldersListShared",
  description:
    "Lists folders that other users have shared with the current user (owned folders are excluded).\n\n**Behavior:** Returns the shared subset of children for the given parent, with archive/search filtering, pagination, and breadcrumbs back to root.\n**Auth:** cookie session\n**Permissions:** scoped to folders explicitly shared with the caller\n**Notes:** tenant-scoped; pass `parentFolderId=null` for root-level shared folders.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    query: SchemaFolderListQuery,
  },
  responses: {
    200: {
      description: "Shared folders retrieved successfully with breadcrumb path",
      content: {
        "application/json": {
          schema: SchemaFolderListResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
  },
});

// Get folder by ID route
export const getFolderRoute = createRoute({
  method: "get",
  path: "/{id}",
  summary: "Get folder by ID",
  operationId: "documentFolderGet",
  description:
    "Retrieves a single folder by its ID.\n\n**Behavior:** Returns 404 if the folder does not exist or is not accessible to the caller.\n**Auth:** cookie session\n**Permissions:** caller must own or be shared on the folder\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
  },
  responses: {
    200: {
      description: "Folder retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentFolderResponse,
        },
      },
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Update folder route
export const updateFolderRoute = createRoute({
  method: "patch",
  path: "/{id}",
  summary: "Update folder",
  operationId: "documentFolderUpdate",
  description:
    "Updates folder metadata (name, description, color, icon).\n\n**Behavior:** Validates user-supplied name/description/tags/metadata against security-threat rules before persisting.\n**Auth:** cookie session\n**Permissions:** caller must have write access to the folder\n**Notes:** tenant-scoped; malicious inputs are rejected as bad request.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
    ...withJsonBody(SchemaFolderUpdateRequest),
  },
  responses: {
    200: {
      description: "Folder updated successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentFolderResponse,
        },
      },
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Delete folder route
export const deleteFolderRoute = createRoute({
  method: "delete",
  path: "/{id}",
  summary: "Delete folder",
  operationId: "documentFolderDelete",
  description:
    "Permanently deletes a folder and all of its contents.\n\n**Behavior:** Invokes a hard delete (not a soft delete) of the folder and its contained documents/subfolders.\n**Auth:** cookie session\n**Permissions:** caller must own (or have admin access to) the folder\n**Notes:** tenant-scoped; this is destructive and not recoverable via restore.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
  },
  responses: {
    204: {
      description: "Folder deleted successfully",
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Move folder route
export const moveFolderRoute = createRoute({
  method: "patch",
  path: "/{id}/move",
  summary: "Move folder",
  operationId: "documentFolderMove",
  description:
    "Moves a folder to a different parent (or to root), processed asynchronously.\n\n**Behavior:** Because hierarchy moves can be slow, the move is queued and this endpoint returns `202 Accepted` with an operation id and estimated completion; progress is reported via SSE. Circular-reference prevention is enforced by the service.\n**Auth:** cookie session\n**Permissions:** caller must have write access to the folder and the target parent\n**Notes:** tenant-scoped; set `targetParentFolderId` to `null` to move to root.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
    ...withJsonBody(SchemaFolderMoveRequest),
  },
  responses: {
    204: {
      description: "Folder moved successfully",
    },
    ...httpResponseBadRequest,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Restore folder route
export const restoreFolderRoute = createRoute({
  method: "patch",
  path: "/{id}/restore",
  summary: "Restore folder",
  operationId: "documentFolderRestore",
  description:
    "Restores an archived folder to active state.\n\n**Behavior:** Clears the archived flag via the archive service's restore path.\n**Auth:** cookie session\n**Permissions:** caller must own or have write access to the folder\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
  },
  responses: {
    204: {
      description: "Folder restored successfully",
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Archive folder route
export const archiveFolderRoute = createRoute({
  method: "patch",
  path: "/{id}/archive",
  summary: "Archive folder",
  operationId: "documentFolderArchive",
  description:
    "Archives or unarchives a folder based on the `isArchived` flag.\n\n**Behavior:** Toggles the archived state of the folder (and propagates to its contents) via the archive service.\n**Auth:** cookie session\n**Permissions:** caller must own or have write access to the folder\n**Notes:** tenant-scoped; set `isArchived=false` to unarchive.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
    ...withJsonBody(z.object({
      isArchived: z.boolean().openapi({ example: true }),
    })),
  },
  responses: {
    204: {
      description: "Folder archive status updated",
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Duplicate folder route
export const duplicateFolderRoute = createRoute({
  method: "post",
  path: "/{id}/duplicate",
  summary: "Duplicate folder",
  operationId: "documentFolderDuplicate",
  description:
    "Creates a copy of an existing folder along with all of its contents.\n\n**Behavior:** Validates the requested name for security threats, then duplicates the folder (and contained documents/subfolders) under the supplied parent.\n**Auth:** cookie session\n**Permissions:** caller must own or have read access to the source folder\n**Notes:** tenant-scoped; `parentId` is optional (defaults to root).",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_FOLDER_ID,
    }),
    ...withJsonBody(z.object({
      name: z.string().min(1).max(255).openapi({
        example: "Copy of My Folder",
      }),
      parentId: SCHEMA_DOCUMENT_FOLDER_ID.nullable().optional(),
    })),
  },
  responses: {
    201: {
      description: "Folder duplicated successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentFolderResponse,
        },
      },
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});
