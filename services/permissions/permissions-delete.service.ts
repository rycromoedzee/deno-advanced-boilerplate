/**
 * @file services/permissions/permissions-delete.service.ts
 * @description Delete operation for permission groups
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { count, eq } from "@deps";

import { getCurrentPermissions } from "./permissions-helper.service.ts";
import { permissionsCacheClearPermissionGroup } from "./permissions-clear-cache.helper.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getPermissionsReadService } from "./singletons.ts";

/**
 * Permissions delete service.
 */
export class PermissionsDeleteService {
  /**
   * Delete a permission group. If users/API keys are assigned, they must be
   * migrated to a replacement group first.
   * Performs permission check to ensure user has permissions from both the
   * deleted group and the replacement group (if provided).
   * @throws AppHttpException if group not found, replacement required, or user lacks permissions.
   */
  async deleteGroup(
    userId: string,
    isAdmin: boolean,
    groupId: string,
    environmentId: string,
    replacementGroupId?: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "PermissionDeleteService.deleteGroup",
      {
        service: "PermissionDeleteService",
        method: "deleteGroup",
        section: loggerAppSections.AUTH,
        details: { userId, groupId, hasReplacement: !!replacementGroupId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const db = await getTenantDB();

        span.attributes["user_id"] = userId;
        span.attributes["group_id"] = groupId;
        span.attributes["has_replacement"] = !!replacementGroupId;

        // Verify group exists and belongs to environment
        const existing = await getPermissionsReadService().readGroup(groupId, environmentId);
        if (!existing) {
          span.attributes["group_found"] = false;
          throwHttpError("COMMON.NOT_FOUND");
        }

        span.attributes["group_found"] = true;
        span.attributes["member_count"] = existing.memberCount;

        // Clear caches for this group before any membership changes
        await permissionsCacheClearPermissionGroup(groupId);

        // Check if users or API keys are assigned
        const [userCount, apiKeyCount] = await traced(
          "PermissionsDeleteService.deleteGroup.getMemberCounts",
          "db.query",
          () => {
            return Promise.all([
              db
                .select({ count: count() })
                .from(tenantTables.userPermissionGroups)
                .where(eq(tenantTables.userPermissionGroups.groupId, groupId))
                .then((rows) => rows[0]),
              db
                .select({ count: count() })
                .from(tenantTables.apiKeyPermissionGroups)
                .where(eq(tenantTables.apiKeyPermissionGroups.groupId, groupId))
                .then((rows) => rows[0]),
            ]);
          },
        );

        const hasMembers = (userCount?.count ?? 0) > 0 || (apiKeyCount?.count ?? 0) > 0;

        // Build list of permissions to check
        let permissionsToCheck = [...existing.permissions];

        if (hasMembers) {
          if (!replacementGroupId) {
            throwHttpError("VALIDATION.REQUIRED_FIELD_MISSING");
          }

          // Validate replacement group exists and is in same env or is system
          const replacementGroup = await getPermissionsReadService().readGroup(replacementGroupId, environmentId);
          if (!replacementGroup) {
            throwHttpError("COMMON.NOT_FOUND");
          }

          span.attributes["replacement_group_id"] = replacementGroupId;

          // Add replacement group permissions to check
          permissionsToCheck = [...permissionsToCheck, ...replacementGroup.permissions];
        }

        // Check if user has all required permissions
        const permissionContext = await getCurrentPermissions(isAdmin, userId);
        if (!permissionContext.isAdmin) {
          const userPermSet = new Set(permissionContext.effectivePermissions);
          const missingPermissions = permissionsToCheck.filter((perm) => !userPermSet.has(perm));
          if (missingPermissions.length > 0) {
            span.attributes["permission_check_failed"] = true;
            span.attributes["missing_permissions"] = missingPermissions.join(",");
            throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS", {
              missingPermissions,
            });
          }
        }

        // Migrate members if needed
        if (hasMembers && replacementGroupId) {
          await traced(
            "PermissionsDeleteService.deleteGroup.migrateMembers",
            "db.query",
            () => {
              return Promise.all([
                db
                  .update(tenantTables.userPermissionGroups)
                  .set({ groupId: replacementGroupId })
                  .where(eq(tenantTables.userPermissionGroups.groupId, groupId)),
                db
                  .update(tenantTables.apiKeyPermissionGroups)
                  .set({ groupId: replacementGroupId })
                  .where(eq(tenantTables.apiKeyPermissionGroups.groupId, groupId)),
              ]);
            },
          );

          // Clear caches for the replacement group after migration
          await permissionsCacheClearPermissionGroup(replacementGroupId);
        }

        // Delete permission mappings and the group
        await traced(
          "PermissionsDeleteService.deleteGroup.deleteGroup",
          "db.query",
          async () => {
            await db
              .delete(tenantTables.permissionGroupPermissions)
              .where(eq(tenantTables.permissionGroupPermissions.groupId, groupId));
            return db
              .delete(tenantTables.permissionGroups)
              .where(eq(tenantTables.permissionGroups.id, groupId));
          },
        );

        span.attributes["success"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error deleting permission group",
          messageKey: "permissions.delete_group.unexpected_error",
        },
      },
    );
  }
}
