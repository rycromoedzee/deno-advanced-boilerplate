/**
 * @file services/environment-config-notifications/index.ts
 * @description Re-exports for environment notification catalog and defaults services
 *
 * For user notification preferences, see @services/user/notifications/index.ts
 */

// Service class exports
export { EnvironmentConfigNotificationsCreateService } from "./environment-config-notifications-create.service.ts";
export { EnvironmentConfigNotificationsListService } from "./environment-config-notifications-list.service.ts";
export { EnvironmentConfigNotificationsDeleteService } from "./environment-config-notifications-delete.service.ts";

// Singleton getters
export {
  getEnvironmentConfigNotificationsCreateService,
  getEnvironmentConfigNotificationsDeleteService,
  getEnvironmentConfigNotificationsListService,
} from "./singletons.ts";

// Helper functions
export {
  getNotificationTypeById,
  hasNotificationAdminPrefSet,
  validateNotificationTypeExists,
} from "./environment-config-notifications-preferences.helper.ts";

// Types
export type { EnvironmentPreferenceInput } from "./environment-config-notifications-create.service.ts";
