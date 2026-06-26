/**
 * @file routes/user/notification-preferences.route.ts
 * @description User notification preferences routes (user's own settings)
 */

import { createRoute } from "@deps";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import {
  SchemaBatchUpsertPreferenceRequest,
  SchemaNotificationTypeIdParam,
  SchemaSuccessResponse,
  SchemaUpsertPreferenceRequest,
  SchemaUserPreferencesGroupedResponse,
} from "@models/notifications/index.ts";

// ============================================================================
// User Preferences Routes (Read)
// ============================================================================

/**
 * GET /api/user/notification-preferences
 * Get preferences grouped by category
 */
export const getUserPreferencesGroupedRoute = createRoute({
  method: "get",
  path: "/notification-preferences",
  summary: "Get your notification preferences grouped by category",
  operationId: "userNotificationPreferencesGetGrouped",
  description:
    "Returns notification preferences organized by category for easier UI rendering. User-configurable categories appear first.\n\n" +
    "**Behavior:** Reads effective notification preferences (user overrides merged with defaults) grouped by category. Read-only, no side effects.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Tenant-scoped; admin flag may surface admin-scope categories.",
  tags: [OpenAPITags.users],
  responses: {
    200: {
      description: "Grouped notification preferences",
      content: {
        "application/json": {
          schema: SchemaUserPreferencesGroupedResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// ============================================================================
// User Preferences Routes (Write - User-configurable types only)
// ============================================================================

/**
 * PATCH /api/user/notification-preferences
 * Batch update your notification preferences
 */
export const batchUpdateUserPreferencesRoute = createRoute({
  method: "patch",
  path: "/notification-preferences",
  summary: "Batch update your notification preferences",
  operationId: "userNotificationPreferencesBatchUpdate",
  description:
    "Update multiple notification preferences at once. Only works for user-configurable notification types (scope: user). Admin types will return an error.\n\n" +
    "**Behavior:** Upserts the supplied per-channel (email / in-app / push) overrides for each notification type in the request body.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — only the calling user's own preferences are mutated.\n" +
    "**Notes:** Tenant-scoped. Returns `204 No Content` on success.",
  tags: [OpenAPITags.users],
  request: {
    ...withJsonBody(SchemaBatchUpsertPreferenceRequest),
  },
  responses: {
    200: {
      description: "Preferences updated successfully",
      content: {
        "application/json": {
          schema: SchemaSuccessResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

/**
 * PATCH /api/user/notification-preferences/{notificationTypeId}
 * Update single notification preference
 */
export const updateUserPreferenceRoute = createRoute({
  method: "patch",
  path: "/notification-preferences/{notificationTypeId}",
  summary: "Update a notification preference",
  operationId: "userNotificationPreferenceUpdate",
  description: "Update a single notification preference. Only works for user-configurable types (scope: user).\n\n" +
    "**Behavior:** Upserts the per-channel (email / in-app / push) override for the notification type identified by the path parameter.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — only the calling user's own preference is mutated.\n" +
    "**Notes:** Tenant-scoped. Returns `204 No Content` on success.",
  tags: [OpenAPITags.users],
  request: {
    params: SchemaNotificationTypeIdParam,
    ...withJsonBody(SchemaUpsertPreferenceRequest),
  },
  responses: {
    200: {
      description: "Preference updated successfully",
      content: {
        "application/json": {
          schema: SchemaSuccessResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

/**
 * DELETE /api/user/notification-preferences/{notificationTypeId}
 * Reset preference to default
 */
export const resetUserPreferenceRoute = createRoute({
  method: "delete",
  path: "/notification-preferences/{notificationTypeId}",
  summary: "Reset a notification preference to default",
  operationId: "userNotificationPreferenceReset",
  description: "Remove your override and revert to the default setting. Only works for user-configurable types (scope: user).\n\n" +
    "**Behavior:** Deletes the calling user's stored override for the notification type identified by the path parameter, restoring the system default.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — only the calling user's own preference is affected.\n" +
    "**Notes:** Tenant-scoped.",
  tags: [OpenAPITags.users],
  request: {
    params: SchemaNotificationTypeIdParam,
  },
  responses: {
    200: {
      description: "Preference reset successfully",
      content: {
        "application/json": {
          schema: SchemaSuccessResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});
