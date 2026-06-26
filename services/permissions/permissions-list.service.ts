/**
 * @file services/permissions/permissions-list.service.ts
 * @description List operations for permissions and permission groups
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { count, ilike, inArray, sql } from "@deps";

import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { calculatePagination } from "@utils/shared/index.ts";

/**
 * Permissions list service.
 */
export class PermissionsListService {
  /**
   * List all system permissions.
   * @returns Array of permission name/description pairs.
   */
  async listPermissions(): Promise<
    Array<{ name: string; description: string | null; level: number | null; group: string | null }>
  > {
    return await tracedWithServiceErrorHandling(
      "PermissionListService.listPermissions",
      {
        service: "PermissionListService",
        method: "listPermissions",
        section: loggerAppSections.AUTH,
        details: {},
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const db = await getTenantDB();
        span.attributes["order_by"] = "groupKey,primary-prefix,level,name";

        const rows = await db
          .select({
            name: tenantTables.permissions.name,
            description: tenantTables.permissions.description,
            level: tenantTables.permissions.level,
            groupKey: tenantTables.permissions.groupKey,
          })
          .from(tenantTables.permissions);

        span.attributes["permission_count"] = rows.length;

        // Group by groupKey, then within each group put the "primary" prefix
        // (the one exposing a `<prefix>.list` action) before sub-resource
        // prefixes, then order by level, then name.
        const prefixOf = (name: string) => name.split(".")[0];
        const byGroup = new Map<string, typeof rows>();
        for (const row of rows) {
          const key = row.groupKey ?? "";
          const bucket = byGroup.get(key) ?? [];
          bucket.push(row);
          byGroup.set(key, bucket);
        }

        const sorted: typeof rows = [];
        for (const groupKey of [...byGroup.keys()].sort()) {
          const items = byGroup.get(groupKey)!;
          const primaryPrefix = [...new Set(items.map((i) => prefixOf(i.name)))]
            .find((p) => items.some((i) => i.name === `${p}.list`));
          items.sort((a, b) => {
            const pa = prefixOf(a.name);
            const pb = prefixOf(b.name);
            const ra = pa === primaryPrefix ? 0 : 1;
            const rb = pb === primaryPrefix ? 0 : 1;
            if (ra !== rb) return ra - rb;
            if (pa !== pb) return pa.localeCompare(pb);
            const la = a.level ?? Number.MAX_SAFE_INTEGER;
            const lb = b.level ?? Number.MAX_SAFE_INTEGER;
            if (la !== lb) return la - lb;
            return a.name.localeCompare(b.name);
          });
          sorted.push(...items);
        }

        return sorted.map(({ groupKey, ...permission }) => ({
          ...permission,
          group: groupKey,
        }));
      },
      {
        logOverrides: {
          message: "Unexpected error listing permissions",
          messageKey: "permissions.list_permissions.unexpected_error",
        },
      },
    );
  }

  /**
   * List permission groups for an environment (includes system groups).
   * @param environmentId - Environment ID to filter groups for
   * @param page - Page number (1-indexed)
   * @param limit - Number of items per page
   * @param search - Optional search string to filter group names
   * @returns Paginated list of groups with permission and member counts
   */
  async listGroups(
    environmentId: string,
    page: number,
    limit: number,
    search?: string,
  ) {
    return await tracedWithServiceErrorHandling(
      "PermissionsListService.listGroups",
      {
        service: "PermissionsListService",
        method: "listGroups",
        section: loggerAppSections.AUTH,
        details: { environmentId, page, limit, search: search ?? "" },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;
        span.attributes["page"] = page;
        span.attributes["limit"] = limit;
        span.attributes["has_search"] = !!search;

        const db = await getTenantDB();
        const { offset } = calculatePagination(page, limit, 0);

        // Build where condition: all groups in this tenant
        // Note: permissionGroups table doesn't have environmentId field - all groups belong to the tenant
        const whereCondition = search ? ilike(tenantTables.permissionGroups.name, `%${search}%`) : undefined;

        // Single query: fetch groups with window function for total count
        const groupRows = await traced(
          "PermissionsListService.listGroups",
          "db.query",
          () => {
            return db
              .select({
                id: tenantTables.permissionGroups.id,
                name: tenantTables.permissionGroups.name,
                description: tenantTables.permissionGroups.description,
                isSystem: tenantTables.permissionGroups.isSystem,
                total: sql<number>`cast(count(*) over() as integer)`,
              })
              .from(tenantTables.permissionGroups)
              .where(whereCondition!)
              .orderBy(tenantTables.permissionGroups.name)
              .limit(limit)
              .offset(offset);
          },
        );

        const total = groupRows[0]?.total ?? 0;
        const { pagination } = calculatePagination(page, limit, total);
        const groupIds = groupRows.map((g) => g.id);

        span.attributes["groups_count"] = groupRows.length;
        span.attributes["total_count"] = total;

        // Batch fetch permission counts and member counts for the fetched groups
        const permCountMap = new Map<string, number>();
        const memberCountMap = new Map<string, number>();

        if (groupIds.length > 0) {
          const [permCounts, memberCounts] = await traced(
            "PermissionsListService.listGroups.counts",
            "db.query",
            () => {
              return Promise.all([
                db
                  .select({
                    groupId: tenantTables.permissionGroupPermissions.groupId,
                    count: count(),
                  })
                  .from(tenantTables.permissionGroupPermissions)
                  .where(inArray(tenantTables.permissionGroupPermissions.groupId, groupIds))
                  .groupBy(tenantTables.permissionGroupPermissions.groupId),
                db
                  .select({
                    groupId: tenantTables.userPermissionGroups.groupId,
                    count: count(),
                  })
                  .from(tenantTables.userPermissionGroups)
                  .where(inArray(tenantTables.userPermissionGroups.groupId, groupIds))
                  .groupBy(tenantTables.userPermissionGroups.groupId),
              ]);
            },
          );

          for (const row of permCounts) {
            permCountMap.set(row.groupId, row.count);
          }

          for (const row of memberCounts) {
            memberCountMap.set(row.groupId, row.count);
          }
        }

        span.attributes["success"] = true;

        return {
          groups: groupRows.map((g) => ({
            id: g.id,
            name: g.name,
            description: g.description,
            isSystem: g.isSystem,
            permissionCount: permCountMap.get(g.id) ?? 0,
            memberCount: memberCountMap.get(g.id) ?? 0,
          })),
          pagination: {
            total: pagination.total,
            page: pagination.page,
            limit: pagination.limit,
          },
        };
      },
      {
        logOverrides: {
          message: "Unexpected error listing permission groups",
          messageKey: "permissions.list_groups.unexpected_error",
        },
      },
    );
  }
}
