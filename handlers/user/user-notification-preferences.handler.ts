/**
 * @file handlers/user/user-notification-preferences.handler.ts
 * @description User notification preference handlers (user's own settings)
 */

import { loggerAppSections } from "@logger/index.ts";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import {
  batchUpdateUserPreferencesRoute,
  getUserPreferencesGroupedRoute,
  resetUserPreferenceRoute,
  updateUserPreferenceRoute,
} from "@routes/user/notification-preferences.route.ts";
import {
  getUserNotificationsCreateService,
  getUserNotificationsDeleteService,
  getUserNotificationsListService,
} from "@services/user/notifications/index.ts";
import { SchemaSuccessResponse, SchemaUserPreferencesGroupedResponse } from "@models/notifications/index.ts";

const ENTITY_TYPE = "user_notification_preference" as const;

const baseConfig = {
  entityType: ENTITY_TYPE,
  loggerSection: loggerAppSections.USER,
};

// =====================================
// User Preferences (Read)
// =====================================

export const getUserPreferencesGroupedHandler = defineHandler(
  {
    ...baseConfig,
    route: getUserPreferencesGroupedRoute,
    operationName: "user_notification_preferences_get_grouped",
    responseSchema: SchemaUserPreferencesGroupedResponse,
  },
  async ({ userId, environmentId, isAdmin }) => {
    const categories = await getUserNotificationsListService()
      .getUserNotificationPreferencesGrouped(userId, environmentId, isAdmin);
    return { data: { categories }, status: 200 };
  },
);

// =====================================
// User Preferences (Write)
// =====================================

export const batchUpdateUserPreferencesHandler = defineHandler(
  {
    ...baseConfig,
    route: batchUpdateUserPreferencesRoute,
    operationName: "user_notification_preferences_batch_update",
  },
  async ({ userId, isAdmin, body }) => {
    const inputs = body.preferences.map((p) => ({
      notificationTypeId: p.notificationTypeId,
      emailEnabled: p.channels.email,
      inAppEnabled: p.channels.inApp,
      pushEnabled: p.channels.push,
    }));
    await getUserNotificationsCreateService().batchUpsertUserPreferences(userId, inputs, isAdmin);
    return { status: 204 };
  },
);

export const updateUserPreferenceHandler = defineHandler(
  {
    ...baseConfig,
    route: updateUserPreferenceRoute,
    operationName: "user_notification_preference_update",
  },
  async ({ userId, isAdmin, body }) => {
    await getUserNotificationsCreateService().upsertUserNotificationPreference(
      userId,
      {
        notificationTypeId: body.notificationTypeId,
        emailEnabled: body.channels.email,
        inAppEnabled: body.channels.inApp,
        pushEnabled: body.channels.push,
      },
      isAdmin,
    );
    return { status: 204 };
  },
);

export const resetUserPreferenceHandler = defineHandler(
  {
    ...baseConfig,
    route: resetUserPreferenceRoute,
    operationName: "user_notification_preference_reset",
    responseSchema: SchemaSuccessResponse,
  },
  async ({ userId, params }) => {
    await getUserNotificationsDeleteService().resetUserNotificationPreference(
      userId,
      params.notificationTypeId,
    );
    return { data: { success: true }, status: 200 };
  },
);
