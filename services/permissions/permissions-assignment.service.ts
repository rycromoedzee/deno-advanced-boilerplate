/**
 * @file services/permissions/permissions-assignment.service.ts
 * @description Permission assignment service for managing user permissions and groups.
 * Handles validation and assignment of permissions to users.
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq, inArray } from "@deps";
import { loggerAppSections } from "@logger/index.ts";
import { getPermissionGroup } from "./permissions-helper.service.ts";
import { permissionsCacheClearUserPermissions } from "./permissions-clear-cache.helper.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";

/** Service for managing permission assignments to users. */
export class PermissionAssignmentService {
  private get dbPromise() {
    return getTenantDB();
  }

  /**
   * Get effective permissions for a user (union of direct and group permissions)
   * @param userId - User ID
   * @returns Array of permission names
   */
  async getEffectivePermissions(userId: string): Promise<string[]> {
    return await tracedWithServiceErrorHandling(
      "PermissionAssignmentService.getEffectivePermissions",
      {
        service: "PermissionAssignmentService",
        method: "getEffectivePermissions",
        section: loggerAppSections.AUTH,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const db = await this.dbPromise;
        // Fetch direct permissions and group assignments in parallel
        const [directPermissionsResult, groupAssignments] = await traced(
          "PermissionAssignmentService.getEffectivePermissions",
          "db.query",
          () => {
            return Promise.all([
              db
                .select({ name: tenantTables.permissions.name })
                .from(tenantTables.userPermissions)
                .innerJoin(
                  tenantTables.permissions,
                  eq(tenantTables.userPermissions.permissionId, tenantTables.permissions.id),
                )
                .where(eq(tenantTables.userPermissions.userId, userId)),
              db
                .select({ groupId: tenantTables.userPermissionGroups.groupId })
                .from(tenantTables.userPermissionGroups)
                .where(eq(tenantTables.userPermissionGroups.userId, userId)),
            ]);
          },
        );

        const directPermissions = directPermissionsResult.map((p) => p.name);
        const groupIds = groupAssignments.map((g) => g.groupId);

        // Batch fetch group permissions if user has any group assignments
        let groupPermissions: string[] = [];
        if (groupIds.length > 0) {
          const groupPerms = await traced(
            "PermissionAssignmentService.getEffectivePermissions.groupPermissions",
            "db.query",
            () => {
              return db
                .select({
                  groupId: tenantTables.permissionGroupPermissions.groupId,
                  name: tenantTables.permissions.name,
                })
                .from(tenantTables.permissionGroupPermissions)
                .innerJoin(
                  tenantTables.permissions,
                  eq(tenantTables.permissionGroupPermissions.permissionId, tenantTables.permissions.id),
                )
                .where(inArray(tenantTables.permissionGroupPermissions.groupId, groupIds));
            },
          );

          groupPermissions = groupPerms.map((gp) => gp.name);
        }

        // Combine and deduplicate
        const allPermissions = [
          ...directPermissions,
          ...groupPermissions,
        ];

        span.attributes["permission_count"] = allPermissions.length;
        span.attributes["direct_count"] = directPermissions.length;
        span.attributes["group_count"] = groupPermissions.length;
        span.attributes["group_ids_count"] = groupIds.length;

        return [...new Set(allPermissions)];
      },
      {
        logOverrides: {
          message: "Unexpected error getting effective permissions",
          messageKey: "permissions.assignment.get_effective_permissions.unexpected_error",
        },
      },
    );
  }

  /**
   * Validate that permission assignments are within creator's effective permissions.
   * This ensures that users can only assign permissions they themselves possess.
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
    return await tracedWithServiceErrorHandling(
      "PermissionAssignmentService.validatePermissionAssignment",
      {
        service: "PermissionAssignmentService",
        method: "validatePermissionAssignment",
        section: loggerAppSections.AUTH,
        details: { creatorId, permissionGroupId, permissionsCount: permissions?.length ?? 0 },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["creator_id"] = creatorId;

        // Enforce mutual exclusivity
        if (permissionGroupId && permissions && permissions.length > 0) {
          throwHttpError("COMMON.INVALID_INPUT", "Cannot assign both a permission group and direct permissions. Choose one.");
        }

        const creatorPermissions = await this.getEffectivePermissions(creatorId);
        const creatorPermissionSet = new Set(creatorPermissions);

        // Validate direct permissions
        if (permissions && permissions.length > 0) {
          for (const perm of permissions) {
            if (!creatorPermissionSet.has(perm)) {
              span.attributes["invalid_permission"] = perm;
              throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
            }
          }
        }

        // Validate permission group
        if (permissionGroupId) {
          const group = await getPermissionGroup(permissionGroupId);
          const groupPermissions = group?.permissions ?? [];
          for (const perm of groupPermissions) {
            if (!creatorPermissionSet.has(perm)) {
              span.attributes["invalid_group"] = permissionGroupId;
              span.attributes["invalid_permission"] = perm;
              throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
            }
          }
        }

        span.attributes["valid"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error validating permission assignment",
          messageKey: "permissions.assignment.validate.unexpected_error",
        },
      },
    );
  }

  /**
   * Assign permissions to a user (replace or merge strategy).
   * A user can be assigned to ONE permission group OR have direct permissions, not both.
   * @param userId - User ID to assign permissions to
   * @param permissionGroupId - Single permission group ID to assign (mutually exclusive with permissions)
   * @param permissions - Direct permissions to assign (mutually exclusive with permissionGroupId)
   * @param strategy - "replace" to remove existing and add new, "merge" to add without removing
   */
  async assignPermissions(
    userId: string,
    permissionGroupId?: string,
    permissions?: string[],
    strategy: "replace" | "merge" = "replace",
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "PermissionAssignmentService.assignPermissions",
      {
        service: "PermissionAssignmentService",
        method: "assignPermissions",
        section: loggerAppSections.AUTH,
        details: {
          userId,
          permissionGroupId,
          permissionsCount: permissions?.length ?? 0,
          strategy,
        },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["strategy"] = strategy;

        const db = await this.dbPromise;

        // Enforce mutual exclusivity: group OR permissions, not both
        if (permissionGroupId && permissions && permissions.length > 0) {
          throwHttpError("COMMON.INVALID_INPUT", "Cannot assign both a permission group and direct permissions. Choose one.");
        }

        if (strategy === "replace") {
          // Remove existing permissions
          await db
            .delete(tenantTables.userPermissionGroups)
            .where(eq(tenantTables.userPermissionGroups.userId, userId));
          await db
            .delete(tenantTables.userPermissions)
            .where(eq(tenantTables.userPermissions.userId, userId));
        }

        // Assign to a single permission group
        if (permissionGroupId) {
          if (strategy === "merge") {
            // For merge, check if user already has a group
            const existing = await db
              .select({ groupId: tenantTables.userPermissionGroups.groupId })
              .from(tenantTables.userPermissionGroups)
              .where(eq(tenantTables.userPermissionGroups.userId, userId))
              .limit(1);

            if (existing.length > 0) {
              // Replace the existing group assignment
              await db
                .delete(tenantTables.userPermissionGroups)
                .where(eq(tenantTables.userPermissionGroups.userId, userId));
            }
          }
          await db.insert(tenantTables.userPermissionGroups).values({
            userId: userId,
            groupId: permissionGroupId,
          });
        }

        // Add new direct permissions
        if (permissions && permissions.length > 0) {
          const permissionIds = await this.getPermissionIds(permissions);
          const permissionInserts = permissionIds.map((permissionId) => ({
            userId: userId,
            permissionId: permissionId,
          }));
          await db.insert(tenantTables.userPermissions).values(permissionInserts);
        }

        // Clear user permission cache after updates
        await permissionsCacheClearUserPermissions(userId);

        span.attributes["success"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error assigning permissions",
          messageKey: "permissions.assignment.assign.unexpected_error",
        },
      },
    );
  }

  /**
   * Get effective permissions for multiple users in batch (2 queries total instead of 2N)
   * @param userIds - Array of user IDs
   * @returns Map of userId -> permission names array
   */
  async getBatchEffectivePermissions(userIds: string[]): Promise<Map<string, string[]>> {
    return await tracedWithServiceErrorHandling(
      "PermissionAssignmentService.getBatchEffectivePermissions",
      {
        service: "PermissionAssignmentService",
        method: "getBatchEffectivePermissions",
        section: loggerAppSections.AUTH,
        details: { userCount: userIds.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_count"] = userIds.length;

        if (userIds.length === 0) {
          return new Map();
        }

        const db = await this.dbPromise;

        // Get all direct permissions for all users in one query
        const directPermissions = await db
          .select({
            userId: tenantTables.userPermissions.userId,
            name: tenantTables.permissions.name,
          })
          .from(tenantTables.userPermissions)
          .innerJoin(
            tenantTables.permissions,
            eq(tenantTables.userPermissions.permissionId, tenantTables.permissions.id),
          )
          .where(inArray(tenantTables.userPermissions.userId, userIds));

        // Get all group assignments for all users in one query
        const groupAssignments = await db
          .select({
            userId: tenantTables.userPermissionGroups.userId,
            groupId: tenantTables.userPermissionGroups.groupId,
          })
          .from(tenantTables.userPermissionGroups)
          .where(inArray(tenantTables.userPermissionGroups.userId, userIds));

        // Get unique group IDs and fetch their permissions
        const uniqueGroupIds = [...new Set(groupAssignments.map((g) => g.groupId))];
        const groupPermissionMap = new Map<string, string[]>();

        if (uniqueGroupIds.length > 0) {
          // Get all permissions for all groups in one query
          const groupPerms = await db
            .select({
              groupId: tenantTables.permissionGroupPermissions.groupId,
              name: tenantTables.permissions.name,
            })
            .from(tenantTables.permissionGroupPermissions)
            .innerJoin(
              tenantTables.permissions,
              eq(tenantTables.permissionGroupPermissions.permissionId, tenantTables.permissions.id),
            )
            .where(inArray(tenantTables.permissionGroupPermissions.groupId, uniqueGroupIds));

          for (const gp of groupPerms) {
            const existing = groupPermissionMap.get(gp.groupId) ?? [];
            existing.push(gp.name);
            groupPermissionMap.set(gp.groupId, existing);
          }
        }

        // Build result map
        const result = new Map<string, string[]>();
        for (const userId of userIds) {
          const permSet = new Set<string>();

          // Add direct permissions
          for (const dp of directPermissions) {
            if (dp.userId === userId) {
              permSet.add(dp.name);
            }
          }

          // Add group permissions
          for (const ga of groupAssignments) {
            if (ga.userId === userId) {
              const perms = groupPermissionMap.get(ga.groupId) ?? [];
              for (const p of perms) {
                permSet.add(p);
              }
            }
          }

          result.set(userId, [...permSet]);
        }

        span.attributes["success"] = true;
        return result;
      },
      {
        logOverrides: {
          message: "Unexpected error getting batch effective permissions",
          messageKey: "permissions.assignment.get_batch_effective_permissions.unexpected_error",
        },
      },
    );
  }

  /**
   * Get permission IDs from permission names
   * @param permissionNames - Array of permission names
   * @returns Array of permission IDs
   */
  private async getPermissionIds(permissionNames: string[]): Promise<string[]> {
    const db = await this.dbPromise;
    const permissionIds = await db
      .select({ id: tenantTables.permissions.id })
      .from(tenantTables.permissions)
      .where(inArray(tenantTables.permissions.name, permissionNames));

    if (permissionIds.length !== permissionNames.length) {
      const foundNames = permissionIds.map((p) => p.id);
      const missingPermissions = permissionNames.filter((name) => !foundNames.includes(name));
      throwHttpError("COMMON.INVALID_INPUT", `Permissions not found: ${missingPermissions.join(", ")}`);
    }

    return permissionIds.map((p) => p.id);
  }
}
