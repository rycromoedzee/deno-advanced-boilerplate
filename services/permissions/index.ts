/**
 * @file services/permissions/index.ts
 * @description Main export file for permission services and helpers
 */

// Service class exports
export { PermissionsListService } from "./permissions-list.service.ts";
export { PermissionsReadService } from "./permissions-read.service.ts";
export { PermissionsCreateService } from "./permissions-create.service.ts";
export { PermissionsUpdateService } from "./permissions-update.service.ts";
export { PermissionsDeleteService } from "./permissions-delete.service.ts";
export { PermissionAssignmentService } from "./permissions-assignment.service.ts";

// Singleton getters
export {
  getPermissionAssignmentService,
  getPermissionsCreateService,
  getPermissionsDeleteService,
  getPermissionsListService,
  getPermissionsReadService,
  getPermissionsUpdateService,
} from "./singletons.ts";

// Helper exports
export * from "./permissions-helper.service.ts";
export * from "./permissions-clear-cache.helper.ts";

// Type exports
export type { UpdateUserPermissionsResult } from "./permissions-update.service.ts";
