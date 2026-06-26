/**
 * @file services/environment-config-user/environment-config-user-read.service.ts
 * @description Service for reading environment config users.
 */

import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { and, eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { EnvironmentConfigUserCrudHelpers } from "./environment-config-user-crud.helpers.ts";

/** Service for reading environment config users. */
export class EnvironmentConfigUserReadService {
  private db = getGlobalDB();
  private helperService = new EnvironmentConfigUserCrudHelpers();

  /**
   * Get user by ID with identity and permissions
   * @param userId - User ID
   * @param environmentId - Environment ID
   * @returns User with identity and permissions
   */
  async getUserById(userId: string, environmentId: string) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentConfigUserReadService.getUserById",
      {
        service: "EnvironmentConfigUserReadService",
        method: "getUserById",
        section: loggerAppSections.ENV_CONFIG_USER,
        details: { userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const globalDb = getGlobalDB();
        const tenantDb = await getTenantDB(environmentId);

        // Fetch user from global DB
        const [user] = await globalDb
          .select({
            id: globalTables.users.id,
            isActive: globalTables.users.isActive,
            isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
            createdAt: globalTables.users.createdAt,
            updatedAt: globalTables.users.updatedAt,
            lastLoginAt: globalTables.users.lastLoginAt,
          })
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

        // Fetch name, email, username, and language from tenant userProfiles
        const [userProfile] = await tenantDb
          .select({
            username: tenantTables.userProfiles.username,
            firstName: tenantTables.userProfiles.firstName,
            lastName: tenantTables.userProfiles.lastName,
            email: tenantTables.userProfiles.email,
            isAdmin: tenantTables.userProfiles.isAdmin,
            language: tenantTables.userProfiles.language,
          })
          .from(tenantTables.userProfiles)
          .where(eq(tenantTables.userProfiles.userId, userId))
          .limit(1);

        const username = userProfile?.username ?? "";
        const language = userProfile?.language ?? "en";
        const firstName = userProfile?.firstName ?? "";
        const lastName = userProfile?.lastName ?? "";
        const email = userProfile?.email || null;
        const userData = user!;

        // Get permission group assignment
        const [groupAssignment] = await tenantDb
          .select({ groupId: tenantTables.userPermissionGroups.groupId })
          .from(tenantTables.userPermissionGroups)
          .where(eq(tenantTables.userPermissionGroups.userId, userId))
          .limit(1);

        const permissionGroupId = groupAssignment?.groupId ?? null;

        // Get effective permissions using the helper service
        const permissions = await this.helperService.getEffectivePermissions(userId);

        // Check if user has passkeys
        const hasPasskey = await this.checkIdentityHasPasskey(userData.id);

        span.attributes["success"] = true;
        span.attributes["has_passkey"] = hasPasskey;

        return {
          id: userData.id,
          firstName,
          lastName,
          email,
          username,
          language,
          isActive: userData.isActive,
          isSignedUp: true,
          isAdmin: userProfile?.isAdmin ?? false,
          isTwoFactorEnabled: userData.isTwoFactorEnabled,
          createdAt: userData.createdAt,
          updatedAt: userData.updatedAt,
          lastLoginAt: userData.lastLoginAt,
          permissionGroupId: permissionGroupId,
          permissions: permissions,
          hasPasskey,
        };
      },
      {
        logOverrides: {
          message: "Unexpected error reading environment config user",
          messageKey: "env_config_user.read.unexpected_error",
        },
      },
    );
  }

  /**
   * Checks if a user has any passkeys registered
   * @param userId - User ID
   * @returns true if passkeys exist, false otherwise
   */
  private async checkIdentityHasPasskey(userId: string): Promise<boolean> {
    const result = await this.db
      .select({ id: globalTables.userPasskeys.userId })
      .from(globalTables.userPasskeys)
      .where(eq(globalTables.userPasskeys.userId, userId))
      .limit(1);

    return result.length > 0;
  }
}
