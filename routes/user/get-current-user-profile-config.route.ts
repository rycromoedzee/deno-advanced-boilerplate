/**
 * @file routes/user/get-current-user-profile-config.route.ts
 * @description Route definition for GET /user/profile-config endpoint
 */

import { createRoute } from "@deps";
import { httpResponseInternalServerError, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { SchemaCurrentUserProfileConfigResponse } from "@models/user-profile-config/index.ts";

export const getCurrentUserProfileConfigRoute = createRoute({
  method: "get",
  path: "/profile-config",
  summary: "Get current user profile config",
  operationId: "userGetProfileConfig",
  description: "Returns the authenticated user's profile configuration including passkeys, notification preferences, and permissions.\n\n" +
    "**Behavior:** Aggregates the current-user profile (see `GET /user/me`), the user's registered passkeys (with PRF flags), and effective notification preferences grouped by category into a single UI bootstrap payload. Read-only, no side effects.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Admin flag influences notification scope visibility.\n" +
    "**Notes:** Tenant-scoped via the authenticated `environmentId`.",
  tags: [OpenAPITags.users],
  responses: {
    200: {
      description: "Profile config retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaCurrentUserProfileConfigResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
