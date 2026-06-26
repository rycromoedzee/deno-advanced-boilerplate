/**
 * @file services/environment-config-user/environment-config-user-delete.service.ts
 * @description Service for deleting environment config users.
 */

import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { and, eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { EnvironmentConfigUserCrudHelpers } from "./environment-config-user-crud.helpers.ts";
import { hasPermission } from "../permissions/index.ts";

/** Service for deleting environment config users. */
export class EnvironmentConfigUserDeleteService {
  private db = getGlobalDB();
  private helperService = new EnvironmentConfigUserCrudHelpers();

  /**
   * Delete user and cascade cleanup
   * @param userId - User ID
   * @param environmentId - Environment ID
   * @param deleterId - Deleter user ID
   * @param isAdmin - Whether the deleter is an admin
   */
  async deleteUser(
    userId: string,
    environmentId: string,
    deleterId: string,
    isAdmin: boolean,
  ) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentConfigUserDeleteService.deleteUser",
      {
        service: "EnvironmentConfigUserDeleteService",
        method: "deleteUser",
        section: loggerAppSections.ENV_CONFIG_USER,
        details: { userId, environmentId, deleterId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["deleter_id"] = deleterId;

        // Check if deleter has permission
        const deleterHasPermission = await hasPermission(isAdmin, deleterId, "users.delete");
        if (!deleterHasPermission) {
          span.attributes["failure_reason"] = "no_delete_permission";
          throwHttpError("USER_API_KEY.NO_PERMISSION");
        }

        // Get user and identity
        const [user] = await this.db
          .select()
          .from(globalTables.users)
          .where(
            and(
              eq(globalTables.users.id, userId),
              eq(globalTables.users.environmentId, environmentId),
            ),
          )
          .limit(1);

        if (!user) {
          span.attributes["not_found"] = true;
          throwHttpError("USER.NOT_FOUND");
        }

        const tenantDb = await getTenantDB(environmentId);

        // Start transaction for cascade delete
        await this.db.transaction(async (tx) => {
          // 1. Delete tenant data
          await tenantDb.transaction(async (ttx) => {
            // Delete user permission assignments first
            await ttx.delete(tenantTables.userPermissionGroups).where(
              eq(tenantTables.userPermissionGroups.userId, userId),
            );
            await ttx.delete(tenantTables.userPermissions).where(
              eq(tenantTables.userPermissions.userId, userId),
            );

            // Delete 2FA secrets
            await ttx.delete(tenantTables.userTwoFactorSecrets).where(
              eq(tenantTables.userTwoFactorSecrets.userId, userId),
            );

            // Delete backup codes
            await ttx.delete(tenantTables.userBackupCodes).where(
              eq(tenantTables.userBackupCodes.userId, userId),
            );

            // Delete API keys
            await ttx.delete(tenantTables.apiKeys).where(
              eq(tenantTables.apiKeys.userId, userId),
            );
          });

          // 2. Delete global data
          // Delete password history
          await tx.delete(globalTables.userPasswordHistory).where(
            eq(globalTables.userPasswordHistory.userId, userId),
          );

          // Delete passkeys
          await tx.delete(globalTables.userPasskeys).where(
            eq(globalTables.userPasskeys.userId, userId),
          );

          // Delete user
          await tx.delete(globalTables.users).where(eq(globalTables.users.id, userId));
        });

        // Clear permission cache
        await this.helperService.clearUserPermissionCache(userId);

        span.attributes["success"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error deleting environment config user",
          messageKey: "env_config_user.delete.unexpected_error",
        },
      },
    );
  }
}
