/**
 * @file routes/notifications/notification-preferences.route.ts
 * @description OpenAPI route definitions for notification configuration
 *
 * This file contains:
 * - Catalog routes (notification types catalog)
 * - Environment defaults routes (admin-only)
 *
 * For user notification preferences, see /routes/user/notification-preferences.route.ts
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
  SchemaNotificationCatalogGroupedResponse,
  SchemaNotificationTypeIdParam,
  SchemaSuccessResponse,
  SchemaUpsertPreferenceRequest,
} from "@models/notifications/index.ts";

// ============================================================================
// Catalog Routes (Read-only)
// ============================================================================

/**
 * GET /api/notifications/catalog
 * Get notification catalog grouped by category
 */
export const getNotificationCatalogGroupedRoute = createRoute({
  method: "get",
  path: "/catalog",
  summary: "Get notification types catalog grouped by category",
  operationId: "notificationCatalogGet",
  description: `Returns notification types organized by category with metadata for UI rendering.

**Behavior:** Reads the notification catalog for the caller's environment and groups types by category.
**Auth:** cookie session
**Permissions:** none beyond auth`,
  tags: [OpenAPITags.environmentConfig],
  responses: {
    200: {
      description: "Grouped notification catalog",
      content: {
        "application/json": {
          schema: SchemaNotificationCatalogGroupedResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// ============================================================================
// Environment Defaults Routes (Admin Only, Admin-Default Scope)
// ============================================================================

/**
 * PATCH /api/notifications/environment-defaults
 * Batch update environment notification defaults (admin only)
 */
export const batchUpdateEnvironmentDefaultsRoute = createRoute({
  method: "patch",
  path: "/environment-defaults",
  summary: "Batch update environment notification defaults (admin only)",
  operationId: "environmentDefaultsBatchUpdate",
  description: `Update multiple environment notification defaults at once. Admin only. Only works for admin scope notification types.

**Behavior:** Upserts several environment-default channel settings in a single request.
**Auth:** cookie session
**Permissions:** admin-only (verified DB-backed in the service layer)
**Notes:** Tenant-scoped to the caller's environment; user-scope types are rejected.`,
  tags: [OpenAPITags.environmentConfig],
  request: {
    ...withJsonBody(SchemaBatchUpsertPreferenceRequest),
  },
  responses: {
    200: {
      description: "Environment defaults updated successfully",
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
 * PATCH /api/notifications/environment-defaults/{notificationTypeId}
 * Update single environment notification default (admin only)
 */
export const updateEnvironmentDefaultRoute = createRoute({
  method: "patch",
  path: "/environment-defaults/{notificationTypeId}",
  summary: "Update an environment notification default (admin only)",
  operationId: "environmentDefaultUpdate",
  description: `Update a single environment notification default. Admin only. Only works for admin scope notification types.

**Behavior:** Upserts one environment-default channel setting for the given notification type.
**Auth:** cookie session
**Permissions:** admin-only (verified DB-backed in the service layer)
**Notes:** Tenant-scoped to the caller's environment; user-scope types are rejected.`,
  tags: [OpenAPITags.environmentConfig],
  request: {
    params: SchemaNotificationTypeIdParam,
    ...withJsonBody(SchemaUpsertPreferenceRequest),
  },
  responses: {
    200: {
      description: "Environment default updated successfully",
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
 * DELETE /api/notifications/environment-defaults/{notificationTypeId}
 * Reset environment default (admin only)
 */
export const resetEnvironmentDefaultRoute = createRoute({
  method: "delete",
  path: "/environment-defaults/{notificationTypeId}",
  summary: "Reset an environment notification default (admin only)",
  operationId: "environmentDefaultReset",
  description: `Remove environment override and revert to catalog default. Admin only.

**Behavior:** Deletes the environment-default override so the catalog default takes effect again.
**Auth:** cookie session
**Permissions:** admin-only (verified DB-backed in the service layer)
**Notes:** Tenant-scoped to the caller's environment.`,
  tags: [OpenAPITags.environmentConfig],
  request: {
    params: SchemaNotificationTypeIdParam,
  },
  responses: {
    200: {
      description: "Environment default reset successfully",
      content: {
        "application/json": {
          schema: SchemaSuccessResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});
