/**
 * @file services/encryption/permission.service.ts
 * @description Generic, table-agnostic permission service for *DataKeys tables
 *
 * This service centralizes all permission checking and access-level retrieval
 * logic for any resource that uses the DataKeys pattern (documentsDataKeys,
 * notesDataKeys, etc.). It replaces duplicate permission logic scattered across
 * document/folder services.
 *
 * Usage:
 * ```typescript
 * const permissionService = new PermissionService(
 *   { tableName: tenantTables.documentsDataKeys, resourceIdColumn: "documentId" },
 * );
 * const level = await permissionService.getAccessLevel(documentId, userId);
 * ```
 */

import { and, eq, inArray } from "@deps";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import type { IEncryptionTableConfig } from "@interfaces/encryption.ts";
import { getTenantDB } from "@db/index.ts";

/**
 * Generic Permission Service
 */
export class PermissionService {
  constructor(
    private readonly tableConfig: IEncryptionTableConfig,
  ) {}

  /**
   * Retrieves the user's permission level for a specific resource.
   */
  async getAccessLevel(
    resourceId: string,
    userId: string,
  ): Promise<DB_ENUM_PERMISSION_ACCESS_LEVEL | null> {
    return await tracedWithServiceErrorHandling(
      "PermissionService.getAccessLevel",
      {
        service: "PermissionService",
        method: "getAccessLevel",
        section: loggerAppSections.ENCRYPTION,
        details: { resourceId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["resource_id"] = resourceId;
        span.attributes["user_id"] = userId;

        const db = await getTenantDB();

        const result = await db
          .select({
            permissionLevel: this.tableConfig.tableName.permissionLevel,
          })
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
              eq(this.tableConfig.tableName.userId, userId),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          )
          .limit(1);

        const permissionLevel = result.length === 0 ? null : result[0].permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL;

        return permissionLevel;
      },
    );
  }

  /**
   * Checks if a user has at least the required permission level.
   *
   * Pure read — no side effects. (Historically this accepted a `userMasterKey`
   * and lazily converted an ASYMMETRIC data key to USER_CONTROLLED as a side
   * effect, mirroring the `DataAccessService.checkPermission` smell. That branch
   * was dead — no caller ever passed a key — and has been removed, see backlog
   * item #2. Callers that need the lazy conversion must invoke
   * `DataAccessService.ensureUserControlledDataKey` explicitly.)
   */
  async checkAccess(
    resourceId: string,
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<boolean> {
    const accessLevel = await this.getAccessLevel(resourceId, userId);

    if (accessLevel === null) {
      return false;
    }

    return this.permissionLevelMeets(accessLevel, requiredPermission);
  }

  async hasAnyAccess(resourceId: string, userId: string): Promise<boolean> {
    const level = await this.getAccessLevel(resourceId, userId);
    return level !== null;
  }

  permissionLevelMeets(
    userLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
    requiredLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): boolean {
    return permissionLevelMeets(userLevel, requiredLevel);
  }

  async batchCheckAccess(
    resourceIds: string[],
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<Map<string, boolean>> {
    return await tracedWithServiceErrorHandling(
      "PermissionService.batchCheckAccess",
      {
        service: "PermissionService",
        method: "batchCheckAccess",
        section: loggerAppSections.ENCRYPTION,
        details: { userId, resourceCount: resourceIds.length, requiredPermission },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (_span) => {
        const result = new Map<string, boolean>();
        if (resourceIds.length === 0) return result;

        const db = await getTenantDB();
        const permissions = await db
          .select({
            resourceId: this.tableConfig.tableName[this.tableConfig.resourceIdColumn],
            permissionLevel: this.tableConfig.tableName.permissionLevel,
          })
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName.userId, userId),
              eq(this.tableConfig.tableName.isActive, true),
              inArray(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceIds),
            ),
          );

        const permissionMap = new Map<string, DB_ENUM_PERMISSION_ACCESS_LEVEL>();
        for (const perm of permissions) {
          const level = perm.permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL;
          permissionMap.set(perm.resourceId as string, level);
        }

        for (const id of resourceIds) {
          const level = permissionMap.get(id);
          if (level !== undefined) {
            result.set(id, this.permissionLevelMeets(level, requiredPermission));
          } else {
            result.set(id, false);
          }
        }

        return result;
      },
    );
  }

  async batchGetAccessLevels(
    resourceIds: string[],
    userId: string,
  ): Promise<Map<string, DB_ENUM_PERMISSION_ACCESS_LEVEL | null>> {
    const result = new Map<string, DB_ENUM_PERMISSION_ACCESS_LEVEL | null>();
    if (resourceIds.length === 0) return result;

    const db = await getTenantDB();
    const permissions = await db
      .select({
        resourceId: this.tableConfig.tableName[this.tableConfig.resourceIdColumn],
        permissionLevel: this.tableConfig.tableName.permissionLevel,
      })
      .from(this.tableConfig.tableName)
      .where(
        and(
          eq(this.tableConfig.tableName.userId, userId),
          eq(this.tableConfig.tableName.isActive, true),
          inArray(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceIds),
        ),
      );

    const permissionMap = new Map<string, DB_ENUM_PERMISSION_ACCESS_LEVEL>();
    for (const perm of permissions) {
      const level = perm.permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL;
      permissionMap.set(perm.resourceId as string, level);
    }

    for (const id of resourceIds) {
      result.set(id, permissionMap.get(id) ?? null);
    }

    return result;
  }
}
