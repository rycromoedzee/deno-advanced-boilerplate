/**
 * @file routes/documents-activity-logs/activity-logs.route.ts
 * @description Activity Logs route definition
 */
import { createRoute } from "@deps";
import { httpResponseBadRequest, httpResponseInternalServerError, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";
import { SchemaActivityLogQuery, SchemaActivityLogsResponse } from "@models/documents/activity-logs.model.ts";

/**
 * Get Activity Logs Route
 * Retrieves activity logs across all documents and folders the user has access to
 */
export const getActivityLogsRoute = createRoute({
  method: "get",
  path: "/activity-logs",
  operationId: "documentActivityLogsList",
  summary: "List activity logs",
  description: `Returns a paginated, filterable list of document and folder activity logs.

**Behavior:** Queries the unified access-log store across all documents and folders the user owns or can access, applying the supplied filters (entity, owner/accessor, content type, tags, access type/method, date ranges) and sort/pagination.
**Auth:** cookie session
**Permissions:** none beyond auth (results are scoped to documents/folders the caller owns or has access to)
**Notes:** tenant-scoped; max 100 items per page.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    query: SchemaActivityLogQuery,
  },
  responses: {
    200: {
      description: "Activity logs retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaActivityLogsResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
