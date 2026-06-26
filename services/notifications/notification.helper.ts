/**
 * @file services/notifications/notification.helper.ts
 * @description Helper for resolving notification preferences before creating notifications
 */

import { hasNotificationPrefSet } from "@services/user/notifications/user-notifications-preferences.helper.ts";
import { NOTIFICATION_TYPE_TO_PREFERENCE_ID } from "@config/notification-event-types.ts";
import type { NotificationEventType } from "@config/notification-event-types.ts";

/**
 * Check if in-app notifications are enabled for a user and event type.
 * Respects the existing preference hierarchy: type defaults → environment defaults → user preferences.
 */
export async function isInAppNotificationEnabled(
  environmentId: string,
  userId: string,
  eventType: NotificationEventType,
): Promise<boolean> {
  const preferenceId = NOTIFICATION_TYPE_TO_PREFERENCE_ID[eventType];
  return await hasNotificationPrefSet(environmentId, userId, preferenceId, "inApp");
}
