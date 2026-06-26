/**
 * @file routes/user/get-current-user.route.ts
 * @description Route definition for GET /user/me endpoint
 */

import { createRoute } from "@deps";
import { httpResponseInternalServerError, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { SchemaCurrentUserResponse } from "@models/environment-config-user/index.ts";

export const getCurrentUserRoute = createRoute({
  method: "get",
  path: "/me",
  summary: "Get current user",
  operationId: "userGetCurrent",
  description:
    "Returns the authenticated user's profile with detailed permission information including source type (group or direct assignment) and expanded permission list.\n\n" +
    "**Behavior:** Reads the user record from the tenant DB, resolves permission source (`group` vs `direct`), and expands the full permission list with per-permission source. Read-only, no side effects.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Tenant-scoped via the authenticated `environmentId`.",
  tags: [OpenAPITags.users],
  responses: {
    200: {
      description: "Current user retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaCurrentUserResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
