/**
 * @file routes/document-folders/folder-settings.route.ts
 * @description Folder Settings route definition
 */
import { createRoute } from "@deps";
import { SchemaFolderSettingsResponse } from "@models/documents/folder-settings.model.ts";
import { httpResponseInternalServerError, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";

/**
 * Get folder settings route
 * Returns comprehensive folder statistics and structure information
 */
export const getFolderSettingsRoute = createRoute({
  method: "get",
  path: "/settings",
  summary: "Get folder settings and statistics",
  operationId: "documentFolderSettingsGet",
  description:
    "Returns comprehensive folder statistics for the current user, including summary counts, maximum depth, sharing info, and the full recursive folder structure (owned and shared).\n\n**Behavior:** Aggregates per-root-folder stats (subfolder/document counts, shared-user counts, depth) plus a recursive folder structure tree.\n**Auth:** cookie session\n**Permissions:** scoped to the caller's owned and shared folders\n**Notes:** tenant-scoped.",
  tags: [OpenAPITagsDocumentFeature.folders],
  responses: {
    200: {
      description: "Folder settings retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaFolderSettingsResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
