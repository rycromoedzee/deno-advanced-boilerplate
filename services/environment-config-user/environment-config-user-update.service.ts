/**
 * @file services/environment-config-user/environment-config-user-update.service.ts
 * @description Service for updating environment config users.
 */

import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { and, eq, sql } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { AuthPasswordService } from "@services/auth/index.ts";
import { hasPermission, PermissionAssignmentService } from "@services/permissions/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { IEnvironmentConfigUserUpdateRequest } from "@models/environment-config-user/index.ts";
import { EnvironmentConfigUserCrudHelpers } from "./environment-config-user-crud.helpers.ts";
import { getEnvironmentConfigUserReadService } from "./singletons.ts";
import { canonicalizeUsername, isReservedUsername } from "@utils/auth/index.ts";
import { permissionsCacheClearUserAdminStatus } from "@services/permissions/permissions-clear-cache.helper.ts";

/** Service for updating environment config users. */
export class EnvironmentConfigUserUpdateService {
  private db = getGlobalDB();
  private helperService = new EnvironmentConfigUserCrudHelpers();
  private permissionAssignmentService = new PermissionAssignmentService();

  /**
   * Update user with identity and permissions
   * @param userId - User ID
   * @param environmentId - Environment ID
   * @param data - User update data
   * @param updaterId - Updater user ID
   * @param isAdmin - Whether the updater is an admin
   * @returns Updated user with identity and permissions
   */
  async updateUser(
    userId: string,
    environmentId: string,
    data: IEnvironmentConfigUserUpdateRequest,
    updaterId: string,
    isAdmin: boolean,
  ) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentConfigUserUpdateService.updateUser",
      {
        service: "EnvironmentConfigUserUpdateService",
        method: "updateUser",
        section: loggerAppSections.ENV_CONFIG_USER,
        details: { userId, environmentId, updaterId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["updater_id"] = updaterId;

        // Check if updater has permission
        const updaterHasPermission = await hasPermission(isAdmin, updaterId, "users.update");
        if (!updaterHasPermission) {
          span.attributes["failure_reason"] = "no_update_permission";
          throwHttpError("USER_API_KEY.NO_PERMISSION");
        }

        if (data.isAdmin !== undefined) {
          if (!isAdmin) {
            throwHttpError("USER.PERMISSION_DENIED", "Only admins can modify admin status");
          }
        }

        // Validate permission assignment if provided
        if (data.permissionGroupId || data.permissions) {
          await this.helperService.validatePermissionAssignment(
            updaterId,
            data.permissionGroupId,
            data.permissions,
          );
        }

        // Track canonicalized username for tenant sync after transaction
        let canonicalizedUsername: string | undefined;

        // Use transaction for atomic updates across user + identity tables
        await this.db.transaction(async (tx) => {
          // Get existing user within transaction
          const [existingUser] = await tx
            .select()
            .from(globalTables.users)
            .where(
              and(
                eq(globalTables.users.id, userId),
                eq(globalTables.users.environmentId, environmentId),
              ),
            )
            .limit(1);

          if (!existingUser) {
            span.attributes["not_found"] = true;
            throwHttpError("USER.NOT_FOUND");
          }

          // Update user fields (excluding language which is in tenant table)
          const userUpdateData: Record<string, unknown> = {};
          if (data.firstName !== undefined) userUpdateData.firstName = data.firstName;
          if (data.lastName !== undefined) userUpdateData.lastName = data.lastName;
          if (data.isActive !== undefined) userUpdateData.isActive = data.isActive;
          if (data.isSignedUp !== undefined) userUpdateData.isSignedUp = data.isSignedUp;

          if (Object.keys(userUpdateData).length > 0) {
            await tx
              .update(globalTables.users)
              .set(userUpdateData)
              .where(eq(globalTables.users.id, userId));
          }

          // Update user credentials if email, username, or password provided
          if (data.email !== undefined || data.username !== undefined || data.password !== undefined) {
            const userUpdateCredentialsData: Record<string, unknown> = {};

            if (data.email !== undefined && data.email !== null) {
              // Check if email is already used by a different user
              const [conflictingUser] = await tx
                .select({ id: globalTables.users.id })
                .from(globalTables.users)
                .where(
                  and(
                    eq(globalTables.users.email, data.email),
                    sql`${globalTables.users.id} != ${userId}`,
                  ),
                )
                .limit(1);

              if (conflictingUser) {
                span.attributes["failure_reason"] = "email_in_use";
                throwHttpError("USER.EMAIL_ALREADY_EXISTS", "Email is already in use");
              }

              userUpdateCredentialsData.email = data.email;
            }

            if (data.username !== undefined && data.username !== null) {
              // Only allow the user themselves or an admin to change the username
              const isSelfUpdate = updaterId === userId;
              if (!isSelfUpdate && !isAdmin) {
                span.attributes["failure_reason"] = "username_update_not_authorized";
                throwHttpError("USER.PERMISSION_DENIED", "Only the user themselves or an admin can change the username");
              }
              const canonicalUsername = canonicalizeUsername(data.username);
              if (isReservedUsername(canonicalUsername)) {
                throwHttpError("USER.RESERVED_USERNAME");
              }

              // Check if username is already used by a different user
              const [conflictingUsername] = await tx
                .select({ id: globalTables.users.id })
                .from(globalTables.users)
                .where(
                  and(
                    eq(globalTables.users.username, canonicalUsername),
                    sql`${globalTables.users.id} != ${userId}`,
                  ),
                )
                .limit(1);

              if (conflictingUsername) {
                span.attributes["failure_reason"] = "username_in_use";
                throwHttpError("USER.ALREADY_EXISTS", "Username is already in use");
              }

              userUpdateCredentialsData.username = canonicalUsername;
              canonicalizedUsername = canonicalUsername;
            }

            if (data.password !== undefined && data.password !== null && data.password !== "") {
              const hashedPassword = await AuthPasswordService.generatePassword(data.password);
              userUpdateCredentialsData.password = hashedPassword;
            }

            if (Object.keys(userUpdateCredentialsData).length > 0) {
              await tx
                .update(globalTables.users)
                .set(userUpdateCredentialsData)
                .where(eq(globalTables.users.id, userId));
            }
          }

          // Handle permission updates using the permission assignment service
          if (data.permissionGroupId !== undefined || data.permissions !== undefined) {
            const strategy = data.permissionStrategy || "replace";
            await this.permissionAssignmentService.assignPermissions(
              userId,
              data.permissionGroupId,
              data.permissions,
              strategy,
            );
          }
        });

        // Sync identity fields to tenant userProfiles (including language)
        const profileSyncData: Record<string, unknown> = {};
        if (data.firstName !== undefined) profileSyncData.firstName = data.firstName;
        if (data.lastName !== undefined) profileSyncData.lastName = data.lastName;
        if (data.email !== undefined) profileSyncData.email = data.email || "";
        if (canonicalizedUsername !== undefined) profileSyncData.username = canonicalizedUsername;
        if (data.isAdmin !== undefined && isAdmin) profileSyncData.isAdmin = data.isAdmin;
        if (data.language !== undefined) profileSyncData.language = data.language;
        if (Object.keys(profileSyncData).length > 0) {
          profileSyncData.updatedAt = Math.floor(Date.now() / 1000);
          const tenantDb = await getTenantDB(environmentId);
          await tenantDb
            .update(tenantTables.userProfiles)
            .set(profileSyncData)
            .where(eq(tenantTables.userProfiles.userId, userId));
        }

        // Clear permission cache for the updated user (outside transaction)
        await this.helperService.clearUserPermissionCache(userId);
        if (data.isAdmin !== undefined) {
          await permissionsCacheClearUserAdminStatus(userId, environmentId);
        }

        span.attributes["success"] = true;

        return await getEnvironmentConfigUserReadService().getUserById(userId, environmentId);
      },
      {
        logOverrides: {
          message: "Unexpected error updating environment config user",
          messageKey: "env_config_user.update.unexpected_error",
        },
      },
    );
  }
}
