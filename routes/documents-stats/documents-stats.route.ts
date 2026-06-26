/**
 * @file routes/documents-stats/documents-stats.route.ts
 * @description Documents Stats route definition
 */
import { createRoute } from "@deps";
import { SchemaDocumentStatsResponse } from "@models/documents/stats.model.ts";
import { httpResponseInternalServerError, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";

/**
 * Get document statistics route
 * Returns aggregate statistics for user's documents
 */
export const getDocumentStatsRoute = createRoute({
  method: "get",
  path: "/stats",
  operationId: "documentsStatsGet",
  summary: "Get document statistics",
  description: `Retrieves aggregate statistics including document count, folder count, tag count, and total storage used.

**Behavior:** Computes counts (including archived subsets) and storage totals (original and encrypted bytes) for the authenticated user.
**Auth:** cookie session
**Permissions:** none beyond auth (scoped to the caller's own data)
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  responses: {
    200: {
      description: "Document statistics retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentStatsResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
