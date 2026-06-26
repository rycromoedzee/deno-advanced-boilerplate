/**
 * @file routes/documents-duplicates/documents-duplicates.route.ts
 * @description Documents Duplicates route definition
 */
import { createRoute } from "@deps";
import {
  SchemaFindDuplicatesQuery,
  SchemaFindDuplicatesResponse,
  SchemaKeepDuplicateRequest,
  SchemaKeepDuplicateResponse,
} from "@models/documents/deduplication.model.ts";
import {
  httpResponseBadRequest,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";

/**
 * @file routes/documents-duplicates/documents-duplicates.route.ts
 * @description Route definitions for document duplicate management settings
 */

/**
 * Find duplicates - lists all duplicate documents for the user
 */
export const findDuplicatesRoute = createRoute({
  method: "get",
  path: "/settings/duplicates",
  operationId: "documentDuplicatesScan",
  summary: "Find duplicate documents",
  description:
    `Scans user's documents and returns groups of files with identical content (based on SHA-256 hash). Use this to identify and clean up duplicate files.

**Behavior:** Groups the caller's documents by content hash and reports per-group document lists, total duplicate counts, and potential storage savings.
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own documents are scanned)
**Notes:** tenant-scoped; archived documents are excluded unless \`includeArchived\` is set, and "allowed" duplicates are excluded unless \`excludeAllowed\` is false.`,
  tags: [OpenAPITagsDocumentFeature.settings],
  request: {
    query: SchemaFindDuplicatesQuery,
  },
  responses: {
    200: {
      description: "Duplicate groups retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaFindDuplicatesResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

/**
 * Keep duplicates - mark documents as intentionally kept duplicates
 */
export const keepDuplicatesRoute = createRoute({
  method: "post",
  path: "/settings/duplicates/keep",
  operationId: "documentDuplicateKeep",
  summary: "Keep duplicate documents",
  description: `Marks the specified documents as intentionally kept duplicates. These documents will not appear in future duplicate scans.

**Behavior:** Bulk-sets the \`duplicateAllowed\` flag on each document ID; returns counts of successes and failures.
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own documents)
**Notes:** tenant-scoped; at least one document ID is required.`,
  tags: [OpenAPITagsDocumentFeature.settings],
  request: {
    ...withJsonBody(SchemaKeepDuplicateRequest),
  },
  responses: {
    200: {
      description: "Documents marked as allowed duplicates",
      content: {
        "application/json": {
          schema: SchemaKeepDuplicateResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

/**
 * Unkeep duplicates - remove the "allowed" flag from duplicates
 */
export const unkeepDuplicatesRoute = createRoute({
  method: "post",
  path: "/settings/duplicates/unkeep",
  operationId: "documentDuplicateUnkeep",
  summary: "Unkeep duplicate documents",
  description: `Removes the 'allowed duplicate' flag from documents, so they will appear in future duplicate scans.

**Behavior:** Clears the \`duplicateAllowed\` flag on each document ID one by one; returns counts of successes and failures.
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own documents)
**Notes:** tenant-scoped; at least one document ID is required.`,
  tags: [OpenAPITagsDocumentFeature.settings],
  request: {
    ...withJsonBody(SchemaKeepDuplicateRequest),
  },
  responses: {
    200: {
      description: "Documents unmarked as allowed duplicates",
      content: {
        "application/json": {
          schema: SchemaKeepDuplicateResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});
