/**
 * @file services/permissions/permissions-read.service.ts
 * @description Read operation for a single permission group
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { count, eq } from "@deps";

import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";

/**
 * Permissions read service.
 */
export class PermissionsReadService {
  /**
   * Read a single permission group with its permission names.
   * @returns Group detail or null if not found / wrong environment.
   */
  async readGroup(
    groupId: string,
    environmentId: string,
  ) {
    return await tracedWithServiceErrorHandling(
      "PermissionReadService.readGroup",
      {
        service: "PermissionReadService",
        method: "readGroup",
        section: loggerAppSections.AUTH,
        details: { groupId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["group_id"] = groupId;
        span.attributes["environment_id"] = environmentId;

        const db = await getTenantDB();

        const groupWithPerms = await traced("PermissionReadService.readGroup", "db.query", async () => {
          return await db
            .select({
              id: tenantTables.permissionGroups.id,
              name: tenantTables.permissionGroups.name,
              description: tenantTables.permissionGroups.description,
              isSystem: tenantTables.permissionGroups.isSystem,
              createdAt: tenantTables.permissionGroups.createdAt,
              updatedAt: tenantTables.permissionGroups.updatedAt,
              permissionName: tenantTables.permissions.name,
            })
            .from(tenantTables.permissionGroups)
            .leftJoin(
              tenantTables.permissionGroupPermissions,
              eq(tenantTables.permissionGroupPermissions.groupId, tenantTables.permissionGroups.id),
            )
            .leftJoin(
              tenantTables.permissions,
              eq(tenantTables.permissionGroupPermissions.permissionId, tenantTables.permissions.id),
            )
            .where(eq(tenantTables.permissionGroups.id, groupId));
        });

        if (groupWithPerms.length === 0 || !groupWithPerms[0].id) {
          span.attributes["group_found"] = false;
          return null;
        }

        // Extract group info from first row and collect permission names from all rows
        const group = groupWithPerms[0];
        const permissionNames = groupWithPerms
          .map((row) => row.permissionName)
          .filter((name): name is string => name !== null);

        span.attributes["group_found"] = true;
        span.attributes["is_system"] = group.isSystem;

        const [memberCountResult] = await traced(
          "PermissionsReadService.readGroup.getMemberCount",
          "db.query",
          () => {
            return db
              .select({ count: count() })
              .from(tenantTables.userPermissionGroups)
              .where(eq(tenantTables.userPermissionGroups.groupId, groupId));
          },
        );

        span.attributes["permission_count"] = permissionNames.length;
        span.attributes["member_count"] = memberCountResult?.count ?? 0;
        span.attributes["success"] = true;

        return {
          id: group.id,
          name: group.name,
          description: group.description,
          isSystem: group.isSystem,
          permissions: permissionNames,
          permissionCount: permissionNames.length,
          memberCount: memberCountResult?.count ?? 0,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        };
      },
      {
        logOverrides: {
          message: "Unexpected error reading permission group",
          messageKey: "permissions.read_group.unexpected_error",
        },
      },
    );
  }
}
