/**
 * @file routes/document-folders/folders-bulk.route.ts
 * @description Bulk folder operation routes with OpenAPI specifications
 */

import { createRoute, z } from "@deps";
import { httpResponseBadRequest, httpResponseForbidden, httpResponseUnauthorized, withJsonBody } from "@utils/openapi/open-api-shared.ts";
import {
  SchemaFolderBulkArchiveResponse,
  SchemaFolderBulkDeleteResponse,
  SchemaFolderBulkMoveAsyncResponse,
  SchemaFolderBulkMoveResponse,
} from "@models/documents/folder.model.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";
import { SCHEMA_DOCUMENT_FOLDER_ID } from "@models/documents/index.ts";

// Bulk delete folders route
export const bulkDeleteFoldersRoute = createRoute({
  method: "post",
  path: "/bulk/delete",
  summary: "Bulk delete folders",
  operationId: "documentFoldersBulkDelete",
  description:
    "Permanently deletes up to 100 folders (and their contents) in a single operation.\n\n**Behavior:** Invokes a hard delete for each folder id; returns per-folder success/failure counts and error details.\n**Auth:** cookie session\n**Permissions:** caller must own (or have admin access to) each folder\n**Notes:** tenant-scoped; this is destructive and not recoverable. Maximum 100 folder ids per request.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    ...withJsonBody(z.object({
      folderIds: z.array(z.string()).min(1).max(100).openapi({
        description: "Array of folder IDs to delete (max 100)",
        example: ["123e4567-e89b-12d3-a456-426614174000"],
      }),
    })),
  },
  responses: {
    200: {
      description: "Folders deleted successfully",
      content: {
        "application/json": {
          schema: SchemaFolderBulkDeleteResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
  },
});

// Bulk archive folders route
export const bulkArchiveFoldersRoute = createRoute({
  method: "post",
  path: "/bulk/archive",
  summary: "Bulk archive folders",
  operationId: "documentFoldersBulkArchive",
  description:
    "Archives or unarchives up to 100 folders in a single operation, per the `isArchived` flag.\n\n**Behavior:** When `isArchived=true` archives the folders (and contents); when `false` unarchives them. Returns processed/failed counts and error details.\n**Auth:** cookie session\n**Permissions:** caller must own or have write access to each folder\n**Notes:** tenant-scoped; maximum 100 folder ids per request.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    ...withJsonBody(
      z.object({
        folderIds: z.array(SCHEMA_DOCUMENT_FOLDER_ID).min(1).max(100).openapi({
          description: "Array of folder IDs to archive (max 100)",
        }),
        isArchived: z.boolean().openapi({
          description: "Whether to archive (true) or unarchive (false)",
          example: true,
        }),
      }),
    ),
  },
  responses: {
    200: {
      description: "Folders archive status updated",
      content: {
        "application/json": {
          schema: SchemaFolderBulkArchiveResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
  },
});

// Bulk move folders route
export const bulkMoveFoldersRoute = createRoute({
  method: "post",
  path: "/bulk/move",
  summary: "Bulk move folders",
  operationId: "documentFoldersBulkMove",
  description:
    "Moves up to 100 folders to a new parent folder (or to root), processed asynchronously.\n\n**Behavior:** Because hierarchy moves can be slow, the operation is queued and this endpoint returns `202 Accepted` with an operation id, status, and estimated completion; progress is reported via SSE.\n**Auth:** cookie session\n**Permissions:** caller must have write access to each folder and the target parent\n**Notes:** tenant-scoped; maximum 100 folder ids per request; set `parentId=null` to move to root.",
  tags: [OpenAPITagsDocumentFeature.folders],
  request: {
    ...withJsonBody(
      z.object({
        folderIds: z.array(SCHEMA_DOCUMENT_FOLDER_ID).min(1).max(100).openapi({
          description: "Array of folder IDs to move (max 100)",
        }),
        parentId: SCHEMA_DOCUMENT_FOLDER_ID.nullable().openapi({
          description: "Target parent folder ID (null for root)",
        }),
        asyncMode: z.boolean().default(true).optional().openapi({
          description: "Enable async processing with SSE notifications (default: true)",
          example: true,
        }),
      }),
    ),
  },
  responses: {
    200: {
      description: "Folders moved successfully (sync mode)",
      content: {
        "application/json": {
          schema: SchemaFolderBulkMoveResponse,
        },
      },
    },
    202: {
      description: "Bulk folder move queued for async processing",
      content: {
        "application/json": {
          schema: SchemaFolderBulkMoveAsyncResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
  },
});
