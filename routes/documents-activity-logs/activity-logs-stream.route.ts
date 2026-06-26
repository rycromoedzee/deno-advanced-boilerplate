/**
 * @file routes/documents-activity-logs/activity-logs-stream.route.ts
 * @description Activity Logs Stream route definition
 */
import { createRoute } from "@deps";
import { httpResponseInternalServerError, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";
import { SchemaActivityLogQuery } from "@models/documents/activity-logs.model.ts";

/**
 * Get Activity Logs Stream Route (SSE)
 * Streams real-time activity logs to the client via Server-Sent Events
 */
export const getActivityLogsStreamRoute = createRoute({
  method: "get",
  path: "/activity-logs/stream",
  operationId: "documentActivityLogsStream",
  summary: "Stream activity logs (SSE)",
  description:
    `Establishes a Server-Sent Events (SSE) connection to stream real-time activity logs for all documents and folders the authenticated user owns or has access to.

**Behavior:** Opens a long-lived \`text/event-stream\` and pushes new activity-log entries as they occur, optionally filtered by document/folder and access type/method.
**Auth:** cookie session
**Permissions:** none beyond auth (events are scoped to the caller's accessible documents/folders)
**Notes:** tenant-scoped; limited to 3 concurrent SSE connections per user (429 on excess, with active/max counts). Disconnects free their slot.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    query: SchemaActivityLogQuery.pick({
      documentId: true,
      folderId: true,
      accessType: true,
      accessMethod: true,
    }).partial(),
  },
  responses: {
    200: {
      description: "SSE stream established successfully",
      content: {
        "text/event-stream": {
          schema: {
            type: "string",
            description: "Server-Sent Events stream with activity log updates",
          },
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
