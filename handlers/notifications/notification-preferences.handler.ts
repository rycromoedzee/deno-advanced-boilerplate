/**
 * @file handlers/notifications/notification-preferences.handler.ts
 * @description Notification configuration handlers — catalog + environment defaults
 *   (mirrors routes/notifications/notification-preferences.route.ts).
 *
 * For user notification preferences, see /handlers/user/user-notification-preferences.handler.ts
 */

import { loggerAppSections } from "@logger/index.ts";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import {
  batchUpdateEnvironmentDefaultsRoute,
  getNotificationCatalogGroupedRoute,
  resetEnvironmentDefaultRoute,
  updateEnvironmentDefaultRoute,
} from "@routes/notifications/notification-preferences.route.ts";
import {
  getEnvironmentConfigNotificationsCreateService,
  getEnvironmentConfigNotificationsDeleteService,
  getEnvironmentConfigNotificationsListService,
} from "@services/environment-config-notifications/index.ts";
import { SchemaNotificationCatalogGroupedResponse, SchemaSuccessResponse } from "@models/notifications/index.ts";

const ENTITY_TYPE = "notification_config" as const;

const baseConfig = {
  entityType: ENTITY_TYPE,
  loggerSection: loggerAppSections.AUTH,
};

// =====================================
// Catalog (Public to authenticated users)
// =====================================

export const getNotificationCatalogGroupedHandler = defineHandler(
  {
    ...baseConfig,
    route: getNotificationCatalogGroupedRoute,
    operationName: "notification_catalog_get_grouped",
    responseSchema: SchemaNotificationCatalogGroupedResponse,
  },
  async ({ environmentId }) => {
    const categories = await getEnvironmentConfigNotificationsListService()
      .getNotificationCatalogGrouped(environmentId);
    return { data: { categories }, status: 200 };
  },
);

// =====================================
// Environment Defaults (Admin Only)
// isAdmin check is performed in the service layer (DB-backed, authoritative)
// =====================================

export const batchUpdateEnvironmentDefaultsHandler = defineHandler(
  {
    ...baseConfig,
    route: batchUpdateEnvironmentDefaultsRoute,
    operationName: "notification_env_defaults_batch_update",
    responseSchema: SchemaSuccessResponse,
  },
  async ({ userId, environmentId, isAdmin, body }) => {
    const inputs = body.preferences.map((p) => ({
      notificationTypeId: p.notificationTypeId,
      emailEnabled: p.channels.email,
      inAppEnabled: p.channels.inApp,
      pushEnabled: p.channels.push,
    }));
    // isAdmin check performed in service (DB-backed)
    await getEnvironmentConfigNotificationsCreateService().batchUpsertEnvironmentDefaults(
      userId,
      environmentId,
      isAdmin,
      inputs,
    );
    return { data: { success: true }, status: 200 };
  },
);

export const updateEnvironmentDefaultHandler = defineHandler(
  {
    ...baseConfig,
    route: updateEnvironmentDefaultRoute,
    operationName: "notification_env_default_update",
    responseSchema: SchemaSuccessResponse,
  },
  async ({ userId, environmentId, body, isAdmin }) => {
    // isAdmin check performed in service (DB-backed)
    await getEnvironmentConfigNotificationsCreateService().upsertEnvironmentNotificationDefault(
      userId,
      environmentId,
      isAdmin,
      {
        notificationTypeId: body.notificationTypeId,
        emailEnabled: body.channels.email,
        inAppEnabled: body.channels.inApp,
        pushEnabled: body.channels.push,
      },
    );
    return { data: { success: true }, status: 200 };
  },
);

export const resetEnvironmentDefaultHandler = defineHandler(
  {
    ...baseConfig,
    route: resetEnvironmentDefaultRoute,
    operationName: "notification_env_default_reset",
    responseSchema: SchemaSuccessResponse,
  },
  async ({ userId, environmentId, isAdmin, params }) => {
    // isAdmin check performed in service (DB-backed)
    await getEnvironmentConfigNotificationsDeleteService().resetEnvironmentNotificationDefault(
      userId,
      environmentId,
      isAdmin,
      params.notificationTypeId,
    );
    return { data: { success: true }, status: 200 };
  },
);
