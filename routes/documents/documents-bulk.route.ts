/**
 * @file routes/documents/documents-bulk.route.ts
 * @description Documents Bulk route definition
 */
import { createRoute, z } from "@deps";
import { httpResponseBadRequest, withJsonBody } from "@utils/openapi/open-api-shared.ts";
import { SchemaBulkOperationResponse } from "@models/shared.model.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";
import { SCHEMA_DOCUMENT_FOLDER_ID, SCHEMA_DOCUMENT_ID, SchemaBulkTagAssignmentRequest } from "@models/documents/index.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

// Bulk delete route
export const bulkDeleteRoute = createRoute({
  method: "post",
  path: "/bulk/delete",
  operationId: "documentBulkDelete",
  summary: "Bulk delete documents",
  description: `Permanently deletes multiple documents.

**Behavior:** Hard-deletes up to 100 documents in a single operation and returns a per-document success/failure result.
**Auth:** cookie session or API key.
**Permissions:** each document requires delete access; documents the caller cannot delete are reported as failures in the result.
**Notes:** tenant-scoped; 1-100 document IDs per request; bulk operations are rate-limited more aggressively than single operations.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    ...withJsonBody(z.object({
      documentIds: z.array(SCHEMA_DOCUMENT_ID).min(1, withKey("validation.document-ids-min", "At least one document ID is required")).max(
        100,
        withKey("validation.document-ids-max", "Maximum 100 document IDs allowed"),
      ).openapi({
        description: "Array of document IDs to delete (max 100)",
      }),
    })),
  },
  responses: {
    200: {
      description: "Bulk delete completed",
      content: {
        "application/json": {
          schema: SchemaBulkOperationResponse("documentId"),
        },
      },
    },
    ...httpResponseBadRequest,
  },
});

// Bulk archive route
export const bulkArchiveRoute = createRoute({
  method: "post",
  path: "/bulk/archive",
  operationId: "documentBulkArchive",
  summary: "Bulk archive documents",
  description: `Archives multiple documents.

**Behavior:** Archives up to 100 documents in a single operation and returns a per-document success/failure result.
**Auth:** cookie session or API key.
**Permissions:** each document requires write access; documents the caller cannot write are reported as failures in the result.
**Notes:** tenant-scoped; 1-100 document IDs per request; bulk operations are rate-limited more aggressively than single operations.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    ...withJsonBody(z.object({
      documentIds: z.array(SCHEMA_DOCUMENT_ID).min(1).max(100).openapi({
        description: "Array of document IDs to archive (max 100)",
      }),
    })),
  },
  responses: {
    200: {
      description: "Bulk archive completed",
      content: {
        "application/json": {
          schema: SchemaBulkOperationResponse("documentId"),
        },
      },
    },
    ...httpResponseBadRequest,
  },
});

// Bulk move route
export const bulkMoveRoute = createRoute({
  method: "post",
  path: "/bulk/move",
  operationId: "documentBulkMove",
  summary: "Bulk move documents",
  description: `Moves multiple documents to a target folder (or to root) with async support.

**Behavior:** Moves up to 100 documents to \`targetFolderId\`. Pass \`targetFolderId: null\` to move them to the root level. In async mode (default) the operation is queued and a 202 with an \`operationId\` is returned for SSE progress tracking; in sync mode it completes inline and returns 200.
**Auth:** cookie session or API key.
**Permissions:** each document requires write access; the target folder requires write access. Per-document failures are reported in the sync result.
**Notes:** tenant-scoped; 1-100 document IDs per request; bulk operations are rate-limited more aggressively than single operations.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            documentIds: z.array(SCHEMA_DOCUMENT_ID).min(1).max(100).openapi({
              description: "Array of document IDs to move (max 100)",
            }),
            targetFolderId: SCHEMA_DOCUMENT_FOLDER_ID.nullable().openapi({
              description: "Target folder ID (null for root)",
            }),
            asyncMode: z.boolean().default(true).optional().openapi({
              description: "Enable async processing with SSE notifications (default: true)",
              example: true,
            }),
          }),
          examples: {
            moveToFolder: {
              summary: "Move documents into a folder",
              value: {
                documentIds: ["ij37qzl5ouk6jejr", "k8m2nq9wbp4rtxas"],
                targetFolderId: "dYY4qHC4otwc",
                asyncMode: true,
              },
            },
            moveToRoot: {
              summary: "Move documents to root level",
              value: {
                documentIds: ["ij37qzl5ouk6jejr"],
                targetFolderId: null,
                asyncMode: true,
              },
            },
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: "Bulk move completed (sync) or queued (async)",
      content: {
        "application/json": {
          schema: SchemaBulkOperationResponse("documentId"),
        },
      },
    },
    202: {
      description: "Bulk move queued for async processing",
      content: {
        "application/json": {
          schema: z.object({
            operationId: z.string(),
            status: z.enum(["pending", "processing"]),
            totalDocuments: z.number(),
            estimatedCompletion: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    ...httpResponseBadRequest,
  },
});

// Bulk assign tags route
export const bulkAssignTagsRoute = createRoute({
  method: "post",
  path: "/bulk/assign-tags",
  operationId: "documentBulkAssignTags",
  summary: "Bulk assign tags to documents",
  description: `Assigns tags to multiple documents. Accepts either tag IDs or tag names (tags will be auto-created if they don't exist).

**Behavior:** Assigns the given tags to each document in the set. Provide exactly one of \`tagIds\` (existing tags) or \`tagNames\` (auto-created if missing) — not both. Tag-name inputs are resolved/created before assignment.
**Auth:** cookie session or API key.
**Permissions:** each document requires write access; per-document failures are reported in the result.
**Notes:** tenant-scoped; the request schema (\`SchemaBulkTagAssignmentRequest\`, owned by the tags domain) accepts two input shapes — \`tagIds\` or \`tagNames\` — and rejects requests that include both.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    ...withJsonBody(SchemaBulkTagAssignmentRequest),
  },
  responses: {
    200: {
      description: "Bulk tag assignment completed",
      content: {
        "application/json": {
          schema: SchemaBulkOperationResponse("documentId"),
        },
      },
    },
    ...httpResponseBadRequest,
  },
});
