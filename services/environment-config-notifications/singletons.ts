/**
 * @file services/environment-config-notifications/singletons.ts
 * @description Lazy singletons for environment config notifications services
 */
import { EnvironmentConfigNotificationsCreateService } from "./environment-config-notifications-create.service.ts";
import { EnvironmentConfigNotificationsListService } from "./environment-config-notifications-list.service.ts";
import { EnvironmentConfigNotificationsDeleteService } from "./environment-config-notifications-delete.service.ts";

let environmentConfigNotificationsCreateService: EnvironmentConfigNotificationsCreateService;
let environmentConfigNotificationsListService: EnvironmentConfigNotificationsListService;
let environmentConfigNotificationsDeleteService: EnvironmentConfigNotificationsDeleteService;

/**
 * Gets the singleton instance of EnvironmentConfigNotificationsCreateService
 * @returns {EnvironmentConfigNotificationsCreateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getEnvironmentConfigNotificationsCreateService(): EnvironmentConfigNotificationsCreateService {
  if (!environmentConfigNotificationsCreateService) {
    try {
      environmentConfigNotificationsCreateService = new EnvironmentConfigNotificationsCreateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EnvironmentConfigNotificationsCreateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return environmentConfigNotificationsCreateService;
}

/**
 * Gets the singleton instance of EnvironmentConfigNotificationsListService
 * @returns {EnvironmentConfigNotificationsListService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getEnvironmentConfigNotificationsListService(): EnvironmentConfigNotificationsListService {
  if (!environmentConfigNotificationsListService) {
    try {
      environmentConfigNotificationsListService = new EnvironmentConfigNotificationsListService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EnvironmentConfigNotificationsListService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return environmentConfigNotificationsListService;
}

/**
 * Gets the singleton instance of EnvironmentConfigNotificationsDeleteService
 * @returns {EnvironmentConfigNotificationsDeleteService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getEnvironmentConfigNotificationsDeleteService(): EnvironmentConfigNotificationsDeleteService {
  if (!environmentConfigNotificationsDeleteService) {
    try {
      environmentConfigNotificationsDeleteService = new EnvironmentConfigNotificationsDeleteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EnvironmentConfigNotificationsDeleteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return environmentConfigNotificationsDeleteService;
}
