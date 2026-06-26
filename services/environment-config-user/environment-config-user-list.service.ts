/**
 * @file services/environment-config-user/environment-config-user-list.service.ts
 * @description Service for listing environment config users with filtering and pagination.
 */

import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { and, eq, ilike, inArray, or, sql } from "@deps";
import type { SQL } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { useValidateAndSanitizeString } from "@utils/security-check.ts";
import { calculatePagination } from "@utils/shared/index.ts";
import { EnvironmentConfigUserCrudHelpers } from "./environment-config-user-crud.helpers.ts";
import { hasPermission } from "../permissions/index.ts";

/** Service for listing environment config users with filtering and pagination. */
export class EnvironmentConfigUserListService {
  private helperService = new EnvironmentConfigUserCrudHelpers();

  /**
   * List users with filtering and pagination
   * @param environmentId - Environment ID
   * @param query - Query parameters
   * @param userId - Current user ID (for permission checks)
   * @param isAdmin - Whether the user is an admin
   * @returns Paginated list of users
   */
  async listUsers(
    environmentId: string,
    query: {
      page: number;
      limit: number;
      sortBy: string;
      sortOrder: "asc" | "desc";
      search?: string;
      email?: string;
      username?: string;
      isActive?: boolean;
      isSignedUp?: boolean;
      isAdmin?: boolean;
      permissionGroupId?: string;
      permissionName?: string;
    },
    userId: string,
    isAdmin: boolean,
  ) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentConfigUserListService.listUsers",
      {
        service: "EnvironmentConfigUserListService",
        method: "listUsers",
        section: loggerAppSections.ENV_CONFIG_USER,
        details: { environmentId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;
        span.attributes["user_id"] = userId;

        // Check if user has permission
        const userHasPermission = await hasPermission(isAdmin, userId, "users.read");
        if (!userHasPermission) {
          span.attributes["failure_reason"] = "no_read_permission";
          throwHttpError("USER.PERMISSION_DENIED");
        }

        const tenantDb = await getTenantDB(environmentId);
        const globalDb = getGlobalDB();

        // Build WHERE clauses against tenantTables.userProfiles
        // (tenantDB is already scoped to the environment — no environmentId clause needed)
        const whereClauses: SQL[] = [];

        if (query.search) {
          const sanitizedSearch = useValidateAndSanitizeString(query.search, 200);
          const searchPattern = `%${sanitizedSearch}%`;
          // Username lives only in global DB — pre-fetch matching IDs
          const usernameMatches = await globalDb
            .select({ id: globalTables.users.id })
            .from(globalTables.users)
            .where(and(
              eq(globalTables.users.environmentId, environmentId),
              ilike(globalTables.users.username, searchPattern),
            ));
          const searchClauses = [
            ilike(tenantTables.userProfiles.firstName, searchPattern),
            ilike(tenantTables.userProfiles.lastName, searchPattern),
            ilike(tenantTables.userProfiles.email, searchPattern),
            ...(usernameMatches.length > 0 ? [inArray(tenantTables.userProfiles.userId, usernameMatches.map((u) => u.id))] : []),
          ];
          const searchClause = or(...searchClauses);
          if (searchClause) whereClauses.push(searchClause);
        }

        if (query.email) {
          const sanitizedEmail = useValidateAndSanitizeString(query.email, 255);
          whereClauses.push(eq(tenantTables.userProfiles.email, sanitizedEmail));
        }

        if (query.username) {
          const sanitizedUsername = useValidateAndSanitizeString(query.username, 100);
          const usernameMatches = await globalDb
            .select({ id: globalTables.users.id })
            .from(globalTables.users)
            .where(eq(globalTables.users.username, sanitizedUsername));
          whereClauses.push(
            usernameMatches.length > 0 ? inArray(tenantTables.userProfiles.userId, usernameMatches.map((u) => u.id)) : sql`1 = 0`,
          );
        }

        if (query.isActive !== undefined) {
          const activeUsers = await globalDb
            .select({ id: globalTables.users.id })
            .from(globalTables.users)
            .where(and(
              eq(globalTables.users.environmentId, environmentId),
              eq(globalTables.users.isActive, query.isActive),
            ));
          whereClauses.push(
            activeUsers.length > 0 ? inArray(tenantTables.userProfiles.userId, activeUsers.map((u) => u.id)) : sql`1 = 0`,
          );
        }

        if (query.isAdmin !== undefined) {
          whereClauses.push(eq(tenantTables.userProfiles.isAdmin, query.isAdmin));
        }

        if (query.permissionGroupId) {
          const sanitizedGroupId = useValidateAndSanitizeString(query.permissionGroupId, 100);
          const usersInGroup = await tenantDb
            .select({ userId: tenantTables.userPermissionGroups.userId })
            .from(tenantTables.userPermissionGroups)
            .where(eq(tenantTables.userPermissionGroups.groupId, sanitizedGroupId));
          const userIdsInGroup = usersInGroup.map((r) => r.userId);
          whereClauses.push(
            userIdsInGroup.length > 0 ? inArray(tenantTables.userProfiles.userId, userIdsInGroup) : sql`1 = 0`,
          );
        }

        if (query.permissionName) {
          const sanitizedPermName = useValidateAndSanitizeString(query.permissionName, 100);

          const [permissionRecord] = await tenantDb
            .select({ id: tenantTables.permissions.id })
            .from(tenantTables.permissions)
            .where(eq(tenantTables.permissions.name, sanitizedPermName))
            .limit(1);

          if (permissionRecord) {
            const permissionId = permissionRecord.id;

            const [usersWithDirectPerm, usersViaGroup] = await Promise.all([
              tenantDb
                .select({ userId: tenantTables.userPermissions.userId })
                .from(tenantTables.userPermissions)
                .where(eq(tenantTables.userPermissions.permissionId, permissionId)),
              tenantDb
                .select({ userId: tenantTables.userPermissionGroups.userId })
                .from(tenantTables.userPermissionGroups)
                .innerJoin(
                  tenantTables.permissionGroupPermissions,
                  eq(tenantTables.userPermissionGroups.groupId, tenantTables.permissionGroupPermissions.groupId),
                )
                .where(eq(tenantTables.permissionGroupPermissions.permissionId, permissionId)),
            ]);

            const eligibleUserIds = [
              ...new Set([
                ...usersWithDirectPerm.map((r) => r.userId),
                ...usersViaGroup.map((r) => r.userId),
              ]),
            ];
            whereClauses.push(
              eligibleUserIds.length > 0 ? inArray(tenantTables.userProfiles.userId, eligibleUserIds) : sql`1 = 0`,
            );
          } else {
            whereClauses.push(sql`1 = 0`);
          }
        }

        // Primary query from tenantDB (environment-scoped by definition)
        const baseProfiles = await tenantDb
          .select({
            id: tenantTables.userProfiles.userId,
            firstName: tenantTables.userProfiles.firstName,
            lastName: tenantTables.userProfiles.lastName,
            email: tenantTables.userProfiles.email,
            isAdmin: tenantTables.userProfiles.isAdmin,
            language: tenantTables.userProfiles.language,
            createdAt: tenantTables.userProfiles.createdAt,
            updatedAt: tenantTables.userProfiles.updatedAt,
          })
          .from(tenantTables.userProfiles)
          .where(whereClauses.length > 0 ? and(...whereClauses) : undefined);

        // Batch fetch global-only fields (username, isActive, isTwoFactorEnabled, lastLoginAt)
        const allProfileIds = baseProfiles.map((p) => p.id);
        const globalUserData = allProfileIds.length > 0
          ? await globalDb
            .select({
              id: globalTables.users.id,
              username: globalTables.users.username,
              isActive: globalTables.users.isActive,
              isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
              lastLoginAt: globalTables.users.lastLoginAt,
            })
            .from(globalTables.users)
            .where(inArray(globalTables.users.id, allProfileIds))
          : [];

        const globalUserMap = new Map(globalUserData.map((u) => [u.id, u]));

        const mergedUsers = baseProfiles.map((profile) => ({
          ...profile,
          username: globalUserMap.get(profile.id)?.username ?? null,
          isActive: globalUserMap.get(profile.id)?.isActive ?? true,
          isTwoFactorEnabled: globalUserMap.get(profile.id)?.isTwoFactorEnabled ?? false,
          lastLoginAt: globalUserMap.get(profile.id)?.lastLoginAt ?? null,
        }));

        const compareValues = (left: unknown, right: unknown): number => {
          const normalize = (value: unknown) => {
            if (typeof value === "boolean") return Number(value);
            if (typeof value === "number") return value;
            return String(value ?? "").toLowerCase();
          };

          const leftValue = normalize(left);
          const rightValue = normalize(right);
          if (leftValue < rightValue) return -1;
          if (leftValue > rightValue) return 1;
          return 0;
        };

        const sortBy = query.sortBy || "createdAt";
        mergedUsers.sort((left, right) => {
          const direction = query.sortOrder === "asc" ? 1 : -1;
          switch (sortBy) {
            case "createdAt":
              return compareValues(left.createdAt ?? 0, right.createdAt ?? 0) * direction;
            case "updatedAt":
              return compareValues(left.updatedAt ?? 0, right.updatedAt ?? 0) * direction;
            case "firstName":
              return compareValues(left.firstName, right.firstName) * direction;
            case "lastName":
              return compareValues(left.lastName, right.lastName) * direction;
            case "lastLoginAt":
              return compareValues(left.lastLoginAt ?? 0, right.lastLoginAt ?? 0) * direction;
            case "isActive":
              return compareValues(left.isActive, right.isActive) * direction;
            case "isAdmin":
              return compareValues(left.isAdmin, right.isAdmin) * direction;
            default:
              return compareValues(left.createdAt ?? 0, right.createdAt ?? 0) * direction;
          }
        });

        const page = query.page;
        const limit = query.limit;
        const total = mergedUsers.length;
        const { offset, pagination } = calculatePagination(page, limit, total);
        const pagedUsers = mergedUsers.slice(offset, offset + limit);
        const pagedUserIds = pagedUsers.map((user) => user.id);

        const [groupAssignments, permissionsMap, passkeyRows] = await Promise.all([
          pagedUserIds.length > 0
            ? tenantDb
              .select({
                userId: tenantTables.userPermissionGroups.userId,
                groupId: tenantTables.userPermissionGroups.groupId,
              })
              .from(tenantTables.userPermissionGroups)
              .where(inArray(tenantTables.userPermissionGroups.userId, pagedUserIds))
            : Promise.resolve([]),
          pagedUserIds.length > 0
            ? this.helperService.getBatchEffectivePermissions(pagedUserIds)
            : Promise.resolve(new Map<string, string[]>()),
          pagedUserIds.length > 0
            ? globalDb
              .select({ userId: globalTables.userPasskeys.userId })
              .from(globalTables.userPasskeys)
              .where(inArray(globalTables.userPasskeys.userId, pagedUserIds))
            : Promise.resolve([]),
        ]);

        const groupMap = new Map<string, string>();
        for (const ga of groupAssignments) {
          groupMap.set(ga.userId, ga.groupId);
        }

        const passkeyUserIds = new Set(passkeyRows.map((row) => row.userId));

        const usersWithPermissions = pagedUsers.map((user) => ({
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          username: user.username,
          language: user.language,
          isActive: user.isActive,
          isSignedUp: true,
          isAdmin: user.isAdmin,
          isTwoFactorEnabled: user.isTwoFactorEnabled,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          lastLoginAt: user.lastLoginAt,
          permissionGroupId: groupMap.get(user.id) ?? null,
          permissions: permissionsMap.get(user.id) ?? [],
          hasPasskey: passkeyUserIds.has(user.id),
        }));

        span.attributes["success"] = true;
        span.attributes["user_count"] = usersWithPermissions.length;

        return {
          data: usersWithPermissions,
          pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: pagination.total,
            totalPages: pagination.totalPages,
          },
        };
      },
      {
        logOverrides: {
          message: "Unexpected error listing environment config users",
          messageKey: "env_config_user.list.unexpected_error",
        },
      },
    );
  }
}
