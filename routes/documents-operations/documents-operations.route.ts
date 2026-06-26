/**
 * @file routes/documents-operations/documents-operations.route.ts
 * @description Routes for move operation status tracking and SSE streaming
 */

import { createRoute, z } from "@deps";
import { httpResponseBadRequest, httpResponseNotFound, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";

/**
 * Get move operation status
 */
export const getMoveOperationStatusRoute = createRoute({
  method: "get",
  path: "/operations/{operationId}/status",
  operationId: "documentOperationStatusGet",
  summary: "Get move operation status",
  description: `Retrieves the current status of an async document/folder move operation.

**Behavior:** Returns the operation's type, status, progress percentage, phase, and timestamp/error fields. Returns 404 if the operation does not exist and 403 if it belongs to another user.
**Auth:** cookie session
**Permissions:** caller must own the operation (matched on userId and environmentId)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      operationId: z.string().openapi({
        description: "Move operation ID",
        example: "op_1234567890",
      }),
    }),
  },
  responses: {
    200: {
      description: "Operation status retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            operationId: z.string(),
            operationType: z.enum(["single_document", "bulk_documents", "single_folder", "bulk_folders"]),
            status: z.enum(["pending", "processing", "completed", "failed", "cancelled", "rolling_back"]),
            progress: z.number(),
            currentPhase: z.string().optional(),
            createdAt: z.number(),
            updatedAt: z.number(),
            startedAt: z.number().optional(),
            completedAt: z.number().optional(),
            error: z.string().optional(),
          }),
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseUnauthorized,
  },
});

/**
 * Stream move operation updates via SSE
 */
export const streamMoveOperationRoute = createRoute({
  method: "get",
  path: "/operations/{operationId}/stream",
  operationId: "documentOperationStream",
  summary: "Stream move operation updates (SSE)",
  description: `Server-Sent Events stream for live updates on a document/folder move operation.

**Behavior:** Opens a long-lived \`text/event-stream\` that pushes progress/status updates as the operation advances. Verifies the operation exists and is owned by the caller before opening the stream.
**Auth:** cookie session
**Permissions:** caller must own the operation (matched on userId and environmentId)
**Notes:** tenant-scoped; response uses \`text/event-stream\` with \`X-Accel-Buffering: no\`.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      operationId: z.string().openapi({
        description: "Move operation ID",
        example: "op_1234567890",
      }),
    }),
  },
  responses: {
    200: {
      description: "SSE stream established",
      content: {
        "text/event-stream": {
          schema: z.string().openapi({
            description: "Server-Sent Events stream with move operation updates",
          }),
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseUnauthorized,
  },
});

/**
 * Cancel a pending move operation
 */
export const cancelMoveOperationRoute = createRoute({
  method: "delete",
  path: "/operations/{operationId}",
  operationId: "documentOperationCancel",
  summary: "Cancel move operation",
  description: `Cancels a pending or in-progress document/folder move operation.

**Behavior:** Marks the operation as cancelled ("Cancelled by user"). Only \`pending\` or \`processing\` operations may be cancelled (400 otherwise). Returns 404 if absent and 403 if owned by another user.
**Auth:** cookie session
**Permissions:** caller must own the operation (matched on userId and environmentId)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      operationId: z.string().openapi({
        description: "Move operation ID",
        example: "op_1234567890",
      }),
    }),
  },
  responses: {
    204: {
      description: "Operation cancelled successfully",
    },
    ...httpResponseNotFound,
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
  },
});

/**
 * Get detailed move operation information
 */
export const getMoveOperationDetailsRoute = createRoute({
  method: "get",
  path: "/operations/{operationId}/details",
  operationId: "documentOperationDetailsGet",
  summary: "Get move operation details",
  description: `Retrieves detailed information about a move operation, including item counts and type-specific target/source fields.

**Behavior:** Returns the full operation record with progress and target fields. Returns 404 if absent and 403 if owned by another user.
**Auth:** cookie session
**Permissions:** caller must own the operation (matched on userId and environmentId)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      operationId: z.string().openapi({
        description: "Move operation ID",
        example: "op_1234567890",
      }),
    }),
  },
  responses: {
    200: {
      description: "Operation details retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            operationId: z.string(),
            operationType: z.enum(["single_document", "bulk_documents", "single_folder", "bulk_folders"]),
            status: z.enum(["pending", "processing", "completed", "failed", "cancelled", "rolling_back"]),
            progress: z.number(),
            userId: z.string(),
            environmentId: z.string(),
            createdAt: z.number(),
            updatedAt: z.number(),
            startedAt: z.number().optional(),
            completedAt: z.number().optional(),
            error: z.string().optional(),
            // Type-specific fields
            documentId: z.string().optional(),
            documentIds: z.array(z.string()).optional(),
            folderId: z.string().optional(),
            folderIds: z.array(z.string()).optional(),
            targetFolderId: z.string().nullable().optional(),
            targetParentFolderId: z.string().nullable().optional(),
            totalItems: z.number().optional(),
            processedItems: z.number().optional(),
            failedItems: z.number().optional(),
          }),
        },
      },
    },
    ...httpResponseNotFound,
    ...httpResponseUnauthorized,
  },
});
