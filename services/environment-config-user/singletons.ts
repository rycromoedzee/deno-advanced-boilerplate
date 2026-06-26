/**
 * @file services/environment-config-user/singletons.ts
 * @description Lazy singletons for environment config user services
 */
import { EnvironmentConfigUserCreateService } from "./environment-config-user-create.service.ts";
import { EnvironmentConfigUserReadService } from "./environment-config-user-read.service.ts";
import { EnvironmentConfigUserUpdateService } from "./environment-config-user-update.service.ts";
import { EnvironmentConfigUserDeleteService } from "./environment-config-user-delete.service.ts";
import { EnvironmentConfigUserListService } from "./environment-config-user-list.service.ts";
import { EnvironmentConfigUserCrudHelpers } from "./environment-config-user-crud.helpers.ts";

let environmentConfigUserCreateService: EnvironmentConfigUserCreateService;
let environmentConfigUserReadService: EnvironmentConfigUserReadService;
let environmentConfigUserUpdateService: EnvironmentConfigUserUpdateService;
let environmentConfigUserDeleteService: EnvironmentConfigUserDeleteService;
let environmentConfigUserListService: EnvironmentConfigUserListService;
let environmentConfigUserCrudHelpers: EnvironmentConfigUserCrudHelpers;

/**
 * Gets the singleton instance of EnvironmentConfigUserCreateService
 * @returns {EnvironmentConfigUserCreateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getEnvironmentConfigUserCreateService(): EnvironmentConfigUserCreateService {
  if (!environmentConfigUserCreateService) {
    try {
      environmentConfigUserCreateService = new EnvironmentConfigUserCreateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EnvironmentConfigUserCreateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return environmentConfigUserCreateService;
}

/**
 * Gets the singleton instance of EnvironmentConfigUserReadService
 * @returns {EnvironmentConfigUserReadService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getEnvironmentConfigUserReadService(): EnvironmentConfigUserReadService {
  if (!environmentConfigUserReadService) {
    try {
      environmentConfigUserReadService = new EnvironmentConfigUserReadService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EnvironmentConfigUserReadService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return environmentConfigUserReadService;
}

/**
 * Gets the singleton instance of EnvironmentConfigUserUpdateService
 * @returns {EnvironmentConfigUserUpdateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getEnvironmentConfigUserUpdateService(): EnvironmentConfigUserUpdateService {
  if (!environmentConfigUserUpdateService) {
    try {
      environmentConfigUserUpdateService = new EnvironmentConfigUserUpdateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EnvironmentConfigUserUpdateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return environmentConfigUserUpdateService;
}

/**
 * Gets the singleton instance of EnvironmentConfigUserDeleteService
 * @returns {EnvironmentConfigUserDeleteService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getEnvironmentConfigUserDeleteService(): EnvironmentConfigUserDeleteService {
  if (!environmentConfigUserDeleteService) {
    try {
      environmentConfigUserDeleteService = new EnvironmentConfigUserDeleteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EnvironmentConfigUserDeleteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return environmentConfigUserDeleteService;
}

/**
 * Gets the singleton instance of EnvironmentConfigUserListService
 * @returns {EnvironmentConfigUserListService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getEnvironmentConfigUserListService(): EnvironmentConfigUserListService {
  if (!environmentConfigUserListService) {
    try {
      environmentConfigUserListService = new EnvironmentConfigUserListService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EnvironmentConfigUserListService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return environmentConfigUserListService;
}

/**
 * Gets the singleton instance of EnvironmentConfigUserCrudHelpers
 * @returns {EnvironmentConfigUserCrudHelpers} The singleton instance
 * @throws {Error} If helper initialization fails
 */
export function getEnvironmentConfigUserCrudHelpers(): EnvironmentConfigUserCrudHelpers {
  if (!environmentConfigUserCrudHelpers) {
    try {
      environmentConfigUserCrudHelpers = new EnvironmentConfigUserCrudHelpers();
    } catch (error) {
      throw new Error(
        `Failed to initialize EnvironmentConfigUserCrudHelpers: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return environmentConfigUserCrudHelpers;
}
