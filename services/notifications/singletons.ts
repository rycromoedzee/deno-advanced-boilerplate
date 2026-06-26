/**
 * @file services/notifications/singletons.ts
 * @description Singleton management for notification services
 */

import { NotificationCreateService } from "./notification-create.service.ts";
import { NotificationListService } from "./notification-list.service.ts";
import { NotificationUpdateService } from "./notification-update.service.ts";

let notificationCreateServiceInstance: NotificationCreateService | null = null;
let notificationListServiceInstance: NotificationListService | null = null;
let notificationUpdateServiceInstance: NotificationUpdateService | null = null;

export function getNotificationCreateService(): NotificationCreateService {
  if (!notificationCreateServiceInstance) {
    notificationCreateServiceInstance = new NotificationCreateService();
  }
  return notificationCreateServiceInstance;
}

export function getNotificationListService(): NotificationListService {
  if (!notificationListServiceInstance) {
    notificationListServiceInstance = new NotificationListService();
  }
  return notificationListServiceInstance;
}

export function getNotificationUpdateService(): NotificationUpdateService {
  if (!notificationUpdateServiceInstance) {
    notificationUpdateServiceInstance = new NotificationUpdateService();
  }
  return notificationUpdateServiceInstance;
}

export function resetNotificationSingletons(): void {
  notificationCreateServiceInstance = null;
  notificationListServiceInstance = null;
  notificationUpdateServiceInstance = null;
}
