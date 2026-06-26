/**
 * @file services/permissions/singletons.ts
 * @description Lazy singletons for permissions services
 */
import { PermissionAssignmentService } from "./permissions-assignment.service.ts";
import { PermissionsListService } from "./permissions-list.service.ts";
import { PermissionsReadService } from "./permissions-read.service.ts";
import { PermissionsCreateService } from "./permissions-create.service.ts";
import { PermissionsUpdateService } from "./permissions-update.service.ts";
import { PermissionsDeleteService } from "./permissions-delete.service.ts";

let permissionAssignmentService: PermissionAssignmentService;
let permissionsListService: PermissionsListService;
let permissionsReadService: PermissionsReadService;
let permissionsCreateService: PermissionsCreateService;
let permissionsUpdateService: PermissionsUpdateService;
let permissionsDeleteService: PermissionsDeleteService;

/**
 * Gets the singleton instance of PermissionAssignmentService
 * @returns {PermissionAssignmentService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getPermissionAssignmentService(): PermissionAssignmentService {
  if (!permissionAssignmentService) {
    try {
      permissionAssignmentService = new PermissionAssignmentService();
    } catch (error) {
      throw new Error(
        `Failed to initialize PermissionAssignmentService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return permissionAssignmentService;
}

/**
 * Gets the singleton instance of PermissionsListService
 * @returns {PermissionsListService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getPermissionsListService(): PermissionsListService {
  if (!permissionsListService) {
    try {
      permissionsListService = new PermissionsListService();
    } catch (error) {
      throw new Error(
        `Failed to initialize PermissionsListService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return permissionsListService;
}

/**
 * Gets the singleton instance of PermissionsReadService
 * @returns {PermissionsReadService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getPermissionsReadService(): PermissionsReadService {
  if (!permissionsReadService) {
    try {
      permissionsReadService = new PermissionsReadService();
    } catch (error) {
      throw new Error(
        `Failed to initialize PermissionsReadService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return permissionsReadService;
}

/**
 * Gets the singleton instance of PermissionsCreateService
 * @returns {PermissionsCreateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getPermissionsCreateService(): PermissionsCreateService {
  if (!permissionsCreateService) {
    try {
      permissionsCreateService = new PermissionsCreateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize PermissionsCreateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return permissionsCreateService;
}

/**
 * Gets the singleton instance of PermissionsUpdateService
 * @returns {PermissionsUpdateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getPermissionsUpdateService(): PermissionsUpdateService {
  if (!permissionsUpdateService) {
    try {
      permissionsUpdateService = new PermissionsUpdateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize PermissionsUpdateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return permissionsUpdateService;
}

/**
 * Gets the singleton instance of PermissionsDeleteService
 * @returns {PermissionsDeleteService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getPermissionsDeleteService(): PermissionsDeleteService {
  if (!permissionsDeleteService) {
    try {
      permissionsDeleteService = new PermissionsDeleteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize PermissionsDeleteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return permissionsDeleteService;
}
