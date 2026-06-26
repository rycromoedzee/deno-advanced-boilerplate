/**
 * @file services/environment-config-user/environment-config-user-crud.helpers.ts
 * @description Helper methods for user CRUD operations including permission validation and caching.
 */

import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { PermissionAssignmentService, permissionsCacheClearUserPermissions } from "@services/permissions/index.ts";

/** Helper service for user CRUD operations. */
export class EnvironmentConfigUserCrudHelpers {
  private permissionAssignmentService = new PermissionAssignmentService();

  /**
   * Get effective permissions for a user (union of direct and group permissions)
   * @param userId - User ID
   * @returns Array of permission names
   */
  async getEffectivePermissions(userId: string): Promise<string[]> {
    return await this.permissionAssignmentService.getEffectivePermissions(userId);
  }

  /**
   * Get effective permissions for multiple users in batch
   * @param userIds - Array of user IDs
   * @returns Map of userId -> permission names array
   */
  async getBatchEffectivePermissions(userIds: string[]): Promise<Map<string, string[]>> {
    return await this.permissionAssignmentService.getBatchEffectivePermissions(userIds);
  }

  /**
   * Validate that permission assignments are within creator's effective permissions.
   * A user can have ONE permission group OR direct permissions, not both.
   * @param creatorId - Creator user ID
   * @param permissionGroupId - Single permission group ID to validate
   * @param permissions - Direct permissions to validate
   */
  async validatePermissionAssignment(
    creatorId: string,
    permissionGroupId?: string,
    permissions?: string[],
  ): Promise<void> {
    return await this.permissionAssignmentService.validatePermissionAssignment(
      creatorId,
      permissionGroupId,
      permissions,
    );
  }

  /**
   * Clear permission cache for a user
   * @param userId - User ID
   */
  async clearUserPermissionCache(userId: string): Promise<void> {
    try {
      await permissionsCacheClearUserPermissions(userId);
    } catch (error) {
      useLogger(LoggerLevels.warn, {
        message: "Failed to clear user permission cache",
        section: loggerAppSections.USER,
        messageKey: "user.permission_cache.clear_failed",
        details: { userId, error },
      });
    }
  }
}
