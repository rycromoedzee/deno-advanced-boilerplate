/**
 * @file services/user/notifications/index.ts
 * @description Re-exports for user notification preference services
 */

// Service class exports
export { UserNotificationsCreateService } from "./user-notifications-create.service.ts";
export { UserNotificationsListService } from "./user-notifications-list.service.ts";
export { UserNotificationsDeleteService } from "./user-notifications-delete.service.ts";

// Singleton getters
export { getUserNotificationsCreateService, getUserNotificationsDeleteService, getUserNotificationsListService } from "./singletons.ts";

// Helper functions
export { hasNotificationPrefSet } from "./user-notifications-preferences.helper.ts";

// Types
export type { UserPreferenceInput } from "./user-notifications-create.service.ts";
