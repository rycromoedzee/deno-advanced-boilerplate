/**
 * @file services/permissions/permissions-update.service.ts
 * @description Update operations for permission groups and user permissions
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq, inArray } from "@deps";

import { getCurrentPermissions, hasPermission } from "./permissions-helper.service.ts";
import { validatePermissionNames } from "./permissions-validation.helper.ts";
import {
  permissionsCacheClearPermissionGroup,
  permissionsCacheClearUserAdminStatus,
  permissionsCacheClearUserPermissions,
} from "./permissions-clear-cache.helper.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getPermissionsReadService } from "./singletons.ts";

export interface UpdateUserPermissionsResult {
  userId: string;
  permissions: string[];
  isAdmin: boolean;
  wasInGroup: boolean;
}

/**
 * Permissions update service for permission groups and user permissions.
 */
export class PermissionsUpdateService {
  /**
   * Update a permission group's metadata and/or permissions.
   * Performs permission check when permissions are being updated.
   * @throws AppHttpException if group not found, user lacks permissions, or permission names invalid.
   */
  async updateGroup(
    userId: string,
    isAdmin: boolean,
    groupId: string,
    environmentId: string,
    name?: string,
    description?: string,
    permissionNames?: string[],
  ) {
    return await tracedWithServiceErrorHandling(
      "PermissionUpdateService.updateGroup",
      {
        service: "PermissionUpdateService",
        method: "updateGroup",
        section: loggerAppSections.AUTH,
        details: { userId, groupId, permissionCount: permissionNames?.length ?? 0 },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const db = await getTenantDB();

        span.attributes["user_id"] = userId;
        span.attributes["group_id"] = groupId;

        // Verify group exists and belongs to environment
        const existing = await getPermissionsReadService().readGroup(groupId, environmentId);
        if (!existing) {
          span.attributes["group_found"] = false;
          throwHttpError("COMMON.NOT_FOUND");
        }

        span.attributes["group_found"] = true;
        span.attributes["is_system"] = existing.isSystem;

        // If updating permissions, check if user has all the new permissions
        if (permissionNames !== undefined) {
          span.attributes["new_permission_count"] = permissionNames.length;
          const permissionContext = await getCurrentPermissions(isAdmin, userId);
          if (!permissionContext.isAdmin) {
            const userPermSet = new Set(permissionContext.effectivePermissions);
            const missingPermissions = permissionNames.filter((perm) => !userPermSet.has(perm));
            if (missingPermissions.length > 0) {
              span.attributes["permission_check_failed"] = true;
              span.attributes["missing_permissions"] = missingPermissions.join(",");
              throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS", {
                missingPermissions,
              });
            }
          }
        }

        // Update metadata if provided
        const metadataUpdates: Record<string, unknown> = {};
        if (name !== undefined) metadataUpdates.name = name;
        if (description !== undefined) metadataUpdates.description = description;

        if (Object.keys(metadataUpdates).length > 0) {
          await traced(
            "PermissionsUpdateService.updateGroup.updateMetadata",
            "db.query",
            () => {
              return db
                .update(tenantTables.permissionGroups)
                .set(metadataUpdates)
                .where(eq(tenantTables.permissionGroups.id, groupId));
            },
          );
        }

        // Replace permissions if provided
        if (permissionNames !== undefined) {
          // Use shared validation helper
          const validPerms = await validatePermissionNames(permissionNames);

          // Delete existing mappings
          await traced(
            "PermissionsUpdateService.updateGroup.deletePermissions",
            "db.query",
            () => {
              return db
                .delete(tenantTables.permissionGroupPermissions)
                .where(eq(tenantTables.permissionGroupPermissions.groupId, groupId));
            },
          );

          // Insert new mappings
          if (validPerms.length > 0) {
            await traced(
              "PermissionsUpdateService.updateGroup.insertPermissions",
              "db.query",
              () => {
                return db.insert(tenantTables.permissionGroupPermissions).values(
                  validPerms.map((p) => ({
                    groupId,
                    permissionId: p.id,
                  })),
                );
              },
            );
          }
        }

        // Clear permission caches for this group (metadata or permissions may have changed)
        await permissionsCacheClearPermissionGroup(groupId);

        span.attributes["success"] = true;

        const updated = await getPermissionsReadService().readGroup(groupId, environmentId);
        return updated!;
      },
      {
        logOverrides: {
          message: "Unexpected error updating permission group",
          messageKey: "permissions.update_group.unexpected_error",
        },
      },
    );
  }

  /**
   * Update a user's direct permissions with authorization checks.
   *
   * Authorization rules:
   * - Admins can assign any permissions and set the admin flag
   * - Users with permissionGroupsExtra.assign can only assign permissions they have (cannot set admin)
   *
   * Behavior:
   * - Removes user from any permission group (if applicable)
   * - Replaces all direct permissions with the new set
   * - Updates isAdmin flag if provided by admin
   * - Clears user permission cache
   *
   * @param actorUserId - ID of user performing the update
   * @param targetUserId - ID of user whose permissions are being updated
   * @param isAdmin - admin flag for current user
   * @param permissionNames - Array of permission names to assign (empty = remove all)
   * @param isAdminFlag - Optional boolean to set user's admin status (admin-only)
   * @returns Result with updated permissions and status
   */
  async updateUserPermissions(
    actorUserId: string,
    targetUserId: string,
    isAdmin: boolean,
    permissionNames: string[],
    isAdminFlag?: boolean,
  ): Promise<UpdateUserPermissionsResult> {
    return await tracedWithServiceErrorHandling(
      "UpdateUserPermissionsService.updateUserPermissions",
      {
        service: "UpdateUserPermissionsService",
        method: "updateUserPermissions",
        section: loggerAppSections.AUTH,
        details: {
          actorUserId,
          targetUserId,
          permissionCount: permissionNames.length,
          isAdminFlag,
        },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const tenantDb = await getTenantDB();

        span.attributes["actor_user_id"] = actorUserId;
        span.attributes["target_user_id"] = targetUserId;
        span.attributes["permission_count"] = permissionNames.length;
        span.attributes["admin_flag_requested"] = isAdminFlag !== undefined;

        // 1. Verify target user exists in environment via tenant profile
        const targetProfile = await traced(
          "PermissionsUpdateService.updateUserPermissions.getTargetUserProfile",
          "db.query",
          () => {
            return tenantDb
              .select({
                isAdmin: tenantTables.userProfiles.isAdmin,
              })
              .from(tenantTables.userProfiles)
              .where(eq(tenantTables.userProfiles.userId, targetUserId))
              .limit(1);
          },
        );

        if (targetProfile.length === 0) {
          span.attributes["user_found"] = false;
          throwHttpError("COMMON.NOT_FOUND", { resource: "User" });
        }

        span.attributes["user_found"] = true;
        span.attributes["current_is_admin"] = targetProfile[0]?.isAdmin ?? false;

        // 2. Check actor authorization
        span.attributes["is_actor_admin"] = isAdmin;

        if (!isAdmin) {
          // Non-admin cannot set admin flag
          if (isAdminFlag !== undefined) {
            span.attributes["admin_flag_denied"] = true;
            throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS", {
              message: "Only admins can set the admin flag",
            });
          }

          // Check for assign permission using the proper permission checking function
          const canAssignPermissions = await hasPermission(
            isAdmin,
            actorUserId,
            "permissionGroupsExtra.assign",
          );

          if (!canAssignPermissions) {
            span.attributes["has_assign_permission"] = false;
            throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS", {
              missingPermissions: ["permissionGroupsExtra.assign"],
            });
          }

          // Validate actor has all requested permissions
          const actorContext = await getCurrentPermissions(isAdmin, actorUserId);
          const actorPermSet = new Set(actorContext.effectivePermissions);
          const missingPermissions = permissionNames.filter(
            (perm) => !actorPermSet.has(perm),
          );

          if (missingPermissions.length > 0) {
            span.attributes["missing_permissions"] = missingPermissions.join(",");
            throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS", {
              missingPermissions,
            });
          }
        }

        // 3. Validate permission names exist in database using shared helper
        if (permissionNames.length > 0) {
          await validatePermissionNames(permissionNames);
          span.attributes["permissions_validated"] = true;
        }

        // 4. Check if user is in a permission group (uses tenantDb for permission tables)
        const groupMembership = await traced(
          "PermissionsUpdateService.updateUserPermissions.getGroupMembership",
          "db.query",
          () => {
            return tenantDb
              .select({ groupId: tenantTables.userPermissionGroups.groupId })
              .from(tenantTables.userPermissionGroups)
              .where(eq(tenantTables.userPermissionGroups.userId, targetUserId))
              .limit(1);
          },
        );

        const wasInGroup = groupMembership.length > 0;
        span.attributes["was_in_group"] = wasInGroup;

        // 5. Remove from group (if applicable)
        if (wasInGroup) {
          await traced(
            "PermissionsUpdateService.updateUserPermissions.removeGroup",
            "db.query",
            () => {
              return tenantDb
                .delete(tenantTables.userPermissionGroups)
                .where(eq(tenantTables.userPermissionGroups.userId, targetUserId));
            },
          );
          span.attributes["group_removed"] = true;
        }

        // 6. Remove all existing direct permissions
        await traced(
          "PermissionsUpdateService.updateUserPermissions.deleteDirectPermissions",
          "db.query",
          () => {
            return tenantDb
              .delete(tenantTables.userPermissions)
              .where(eq(tenantTables.userPermissions.userId, targetUserId));
          },
        );

        // 7. Insert new direct permissions
        if (permissionNames.length > 0) {
          const permissionIds = await getPermissionIds(permissionNames);

          await traced(
            "PermissionsUpdateService.updateUserPermissions.insertPermissions",
            "db.query",
            () => {
              return tenantDb.insert(tenantTables.userPermissions).values(
                permissionIds.map((permissionId) => ({
                  userId: targetUserId,
                  permissionId,
                })),
              );
            },
          );
        }

        // 8. Update admin flag if provided (admin-only)
        let newIsAdmin = targetProfile[0]?.isAdmin ?? false;
        if (isAdminFlag !== undefined && isAdmin) {
          await traced(
            "PermissionsUpdateService.updateUserPermissions.updateAdminFlag",
            "db.query",
            () => {
              return tenantDb
                .update(tenantTables.userProfiles)
                .set({
                  isAdmin: isAdminFlag,
                })
                .where(eq(tenantTables.userProfiles.userId, targetUserId));
            },
          );
          newIsAdmin = isAdminFlag;
          span.attributes["admin_flag_updated"] = true;
          span.attributes["new_is_admin"] = newIsAdmin;
        }

        // 9. Clear user permission cache
        await permissionsCacheClearUserPermissions(targetUserId);
        if (isAdminFlag !== undefined) {
          await permissionsCacheClearUserAdminStatus(targetUserId);
        }

        span.attributes["success"] = true;

        return {
          userId: targetUserId,
          permissions: permissionNames,
          isAdmin: newIsAdmin,
          wasInGroup,
        };
      },
      {
        logOverrides: {
          message: "Unexpected error updating user permissions",
          messageKey: "permissions.update_user_permissions.unexpected_error",
        },
      },
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get permission IDs from permission names.
 * Assumes names have already been validated.
 */
async function getPermissionIds(names: string[]): Promise<string[]> {
  const db = await getTenantDB();
  const found = await traced(
    "PermissionsUpdateService.getPermissionIds",
    "db.query",
    () => {
      return db
        .select({ id: tenantTables.permissions.id })
        .from(tenantTables.permissions)
        .where(inArray(tenantTables.permissions.name, names));
    },
  );

  return found.map((p) => p.id);
}
