/**
 * @file services/permissions/permissions-create.service.ts
 * @description Create operation for permission groups
 */

import { getTenantDB, tenantTables } from "@db/index.ts";

import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { getCurrentPermissions } from "./permissions-helper.service.ts";
import { validatePermissionNames } from "./permissions-validation.helper.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";

/**
 * Permissions create service.
 */
export class PermissionsCreateService {
  /**
   * Create a new permission group with the given permissions.
   * Performs permission check to ensure user has all permissions they're trying to assign.
   * @throws AppHttpException if user lacks required permissions or permission names are invalid.
   */
  async createGroup(
    userId: string,
    isAdmin: boolean,
    name: string,
    description: string | undefined,
    _environmentId: string,
    permissionNames: string[],
  ) {
    return await tracedWithServiceErrorHandling(
      "PermissionCreateService.createGroup",
      {
        service: "PermissionCreateService",
        method: "createGroup",
        section: loggerAppSections.AUTH,
        details: { userId, groupName: name, permissionCount: permissionNames.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const db = await getTenantDB();

        span.attributes["user_id"] = userId;
        span.attributes["group_name"] = name;
        span.attributes["permission_count"] = permissionNames.length;

        // Check if user can manage a group with these permissions
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

        // Validate permission names exist using shared helper
        const validPerms = await validatePermissionNames(permissionNames);

        // Insert the group with retry on ID collision
        const [group] = await traced(
          "PermissionsCreateService.createGroup.insertGroup",
          "db.query",
          () => {
            return databaseCreateWithRetry(async (newId) => {
              return await db
                .insert(tenantTables.permissionGroups)
                .values({
                  id: newId,
                  name,
                  description: description ?? null,
                  isSystem: false,
                })
                .returning();
            }, generateIdRandom);
          },
        );

        // Insert permission mappings
        if (validPerms.length > 0) {
          await traced(
            "PermissionsCreateService.createGroup.insertPermissions",
            "db.query",
            () => {
              return db.insert(tenantTables.permissionGroupPermissions).values(
                validPerms.map((p) => ({
                  groupId: group.id,
                  permissionId: p.id,
                })),
              );
            },
          );
        }

        span.attributes["success"] = true;
        span.attributes["group_id"] = group.id;

        return {
          id: group.id,
          name: group.name,
          description: group.description,
          isSystem: group.isSystem,
          permissions: validPerms.map((p) => p.name),
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        };
      },
      {
        logOverrides: {
          message: "Unexpected error creating permission group",
          messageKey: "permissions.create_group.unexpected_error",
        },
      },
    );
  }
}
