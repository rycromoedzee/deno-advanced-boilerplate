/**
 * @file services/user/notifications/singletons.ts
 * @description Lazy singletons for user notifications services
 */
import { UserNotificationsCreateService } from "./user-notifications-create.service.ts";
import { UserNotificationsListService } from "./user-notifications-list.service.ts";
import { UserNotificationsDeleteService } from "./user-notifications-delete.service.ts";

let userNotificationsCreateService: UserNotificationsCreateService;
let userNotificationsListService: UserNotificationsListService;
let userNotificationsDeleteService: UserNotificationsDeleteService;

/**
 * Gets the singleton instance of UserNotificationsCreateService
 * @returns {UserNotificationsCreateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getUserNotificationsCreateService(): UserNotificationsCreateService {
  if (!userNotificationsCreateService) {
    try {
      userNotificationsCreateService = new UserNotificationsCreateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserNotificationsCreateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userNotificationsCreateService;
}

/**
 * Gets the singleton instance of UserNotificationsListService
 * @returns {UserNotificationsListService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getUserNotificationsListService(): UserNotificationsListService {
  if (!userNotificationsListService) {
    try {
      userNotificationsListService = new UserNotificationsListService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserNotificationsListService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userNotificationsListService;
}

/**
 * Gets the singleton instance of UserNotificationsDeleteService
 * @returns {UserNotificationsDeleteService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getUserNotificationsDeleteService(): UserNotificationsDeleteService {
  if (!userNotificationsDeleteService) {
    try {
      userNotificationsDeleteService = new UserNotificationsDeleteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize UserNotificationsDeleteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return userNotificationsDeleteService;
}
