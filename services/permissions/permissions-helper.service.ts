/**
 * @file services/permissions/permissions-helper.service.ts
 * @description
 * Core permission helpers for checking permissions and reading permission context.
 * Uses global cache service with Redis in production and Map in development.
 *
 * Output/Side Effects:
 *   - Performs PostgreSQL queries via Drizzle ORM.
 *   - Caches permission lookups using global cache service.
 *   - Logs errors to the console on query failures.
 *
 * Deno Permissions:
 *   --allow-net (for DB and Redis access)
 *   --allow-env (for environment variables)
 */

import { getTenantDB, requestContext, tenantTables } from "@db/index.ts";
import type { PermissionName } from "@db/seed/permissions.ts";
import { and, eq } from "@deps";

import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { envConfig } from "@config/env.ts";
import { loggerAppSections } from "@logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";

// ============================================================================
// Types
// ============================================================================

export type PermissionGroupWithPermissions = typeof tenantTables.permissionGroups.$inferSelect & {
  permissions: string[];
};

export interface PermissionContext {
  isAdmin: boolean;
  source: "admin" | "direct" | "group" | "mixed" | "none";
  group?: PermissionGroupWithPermissions;
  directPermissions?: string[];
  effectivePermissions: string[];
}

export interface PermissionLookupOptions {
  entityType?: "user" | "apiKey";
  environmentId?: string;
}

interface PermissionAssignmentResult {
  hasPermission: boolean;
  source: "direct" | "group" | "none";
  groupId?: string;
  groupIsSystem?: boolean;
}

// ============================================================================
// Cache Configuration
// ============================================================================

const CACHE_CONFIG = {
  // System/default data - cached almost forever
  PERMISSION_ID_TTL: 30 * 24 * 60 * 60, // 30 days (system permissions)
  SYSTEM_GROUP_TTL: 7 * 24 * 60 * 60, // 7 days (default groups)

  // Custom/user-created data - workday-based TTL
  CUSTOM_GROUP_TTL: 10 * 60 * 60, // 10 hours (custom roles/groups)
  USER_PERMISSION_TTL: 8 * 60 * 60, // 8 hours (user-specific permissions)

  MAX_CACHE_SIZE: 10000,
};

function resolveEnvironmentId(environmentId?: string): string | undefined {
  return environmentId ?? requestContext.getStore()?.environmentId;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get a permission group and its permissions, with caching.
 */
export async function getPermissionGroup(
  groupId: string,
): Promise<PermissionGroupWithPermissions | null> {
  return await tracedWithServiceErrorHandling(
    "PermissionHelper.getPermissionGroup",
    {
      service: "PermissionHelper",
      method: "getPermissionGroup",
      section: loggerAppSections.AUTH,
      details: { groupId },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async () => {
      const cache = await getCache();
      const cached = await cache.get<PermissionGroupWithPermissions>(
        CACHE_NAMESPACES.PERMISSIONS.GROUPS,
        groupId,
      );

      if (cached !== null) {
        return cached;
      }

      const db = await getTenantDB();
      const [group] = await db
        .select()
        .from(tenantTables.permissionGroups)
        .where(eq(tenantTables.permissionGroups.id, groupId))
        .limit(1);

      if (!group) {
        return null;
      }

      const groupPerms = await db
        .select({ name: tenantTables.permissions.name })
        .from(tenantTables.permissionGroupPermissions)
        .innerJoin(
          tenantTables.permissions,
          eq(tenantTables.permissionGroupPermissions.permissionId, tenantTables.permissions.id),
        )
        .where(eq(tenantTables.permissionGroupPermissions.groupId, groupId));

      const result: PermissionGroupWithPermissions = {
        ...group,
        permissions: groupPerms.map((p) => p.name),
      };

      const ttl = group.isSystem ? CACHE_CONFIG.SYSTEM_GROUP_TTL : CACHE_CONFIG.CUSTOM_GROUP_TTL;

      await cache.set(
        CACHE_NAMESPACES.PERMISSIONS.GROUPS,
        groupId,
        result,
        { ttl, maxSize: CACHE_CONFIG.MAX_CACHE_SIZE },
      );

      return result;
    },
    {
      logOverrides: {
        message: "Unexpected error getting permission group",
        messageKey: "permissions.get_group.unexpected_error",
      },
    },
  );
}

/**
 * Resolve tenant-scoped admin status for a user with cache fallback to the tenant DB.
 */
export async function getCachedUserAdminStatus(
  userId: string,
  environmentId?: string,
): Promise<boolean> {
  const resolvedEnvironmentId = resolveEnvironmentId(environmentId);
  if (!resolvedEnvironmentId) {
    throw new Error("getCachedUserAdminStatus: environmentId is required and could not be resolved from request context");
  }
  if (!userId) {
    return false;
  }

  const cache = await getCache();
  const cacheKey = `${resolvedEnvironmentId}:${userId}`;
  const cached = await cache.get<boolean>(CACHE_NAMESPACES.PERMISSIONS.ADMIN, cacheKey);
  if (cached !== null) {
    return cached;
  }

  const db = await getTenantDB(resolvedEnvironmentId);
  const [profile] = await db
    .select({ isAdmin: tenantTables.userProfiles.isAdmin })
    .from(tenantTables.userProfiles)
    .where(eq(tenantTables.userProfiles.userId, userId))
    .limit(1);

  const isAdmin = profile?.isAdmin ?? false;
  await cache.set(CACHE_NAMESPACES.PERMISSIONS.ADMIN, cacheKey, isAdmin, {
    ttl: CACHE_CONFIG.USER_PERMISSION_TTL,
    maxSize: CACHE_CONFIG.MAX_CACHE_SIZE,
  });

  return isAdmin;
}

/**
 * Get permission context for a user or API key.
 */
export async function getCurrentPermissions(
  isUserAdmin: boolean,
  entityId: string,
  options?: PermissionLookupOptions,
): Promise<PermissionContext> {
  return await tracedWithServiceErrorHandling(
    "PermissionHelper.getCurrentPermissions",
    {
      service: "PermissionHelper",
      method: "getCurrentPermissions",
      section: loggerAppSections.AUTH,
      details: { entityId },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async (span) => {
      const entityType = resolveEntityType(entityId, options);
      span.attributes["entity_type"] = entityType;

      if (!entityId) {
        return {
          isAdmin: false,
          source: "none",
          effectivePermissions: [],
          directPermissions: [],
        };
      }

      if (entityType === "user" && isUserAdmin) {
        return {
          isAdmin: true,
          source: "admin",
          effectivePermissions: [],
          directPermissions: [],
        };
      }

      const db = await getTenantDB(resolveEnvironmentId(options?.environmentId));

      const directTable = entityType === "user" ? tenantTables.userPermissions : tenantTables.apiKeyPermissions;
      const directEntityIdColumn = entityType === "user" ? tenantTables.userPermissions.userId : tenantTables.apiKeyPermissions.apiKeyId;

      const directPermissionsResult = await db
        .select({ name: tenantTables.permissions.name })
        .from(directTable)
        .innerJoin(tenantTables.permissions, eq(directTable.permissionId, tenantTables.permissions.id))
        .where(eq(directEntityIdColumn, entityId));

      const directPermissions = directPermissionsResult.map((p) => p.name);

      const groupTable = entityType === "user" ? tenantTables.userPermissionGroups : tenantTables.apiKeyPermissionGroups;
      const groupEntityIdColumn = entityType === "user"
        ? tenantTables.userPermissionGroups.userId
        : tenantTables.apiKeyPermissionGroups.apiKeyId;

      const groupAssignments = await db
        .select({ groupId: groupTable.groupId })
        .from(groupTable)
        .where(eq(groupEntityIdColumn, entityId));

      const groupResults = await Promise.all(
        groupAssignments.map(async (assignment) => {
          return await getPermissionGroup(assignment.groupId);
        }),
      );

      const groups = groupResults.filter((g): g is PermissionGroupWithPermissions => g !== null);
      const groupPermissions = groups.flatMap((g) => g.permissions);

      const effectivePermissionsSet = new Set([
        ...directPermissions,
        ...groupPermissions,
      ]);

      const effectivePermissions = [...effectivePermissionsSet];

      let source: PermissionContext["source"] = "none";
      if (directPermissions.length > 0 && groupPermissions.length > 0) {
        source = "mixed";
      } else if (directPermissions.length > 0) {
        source = "direct";
      } else if (groupPermissions.length > 0) {
        source = "group";
      }

      span.attributes["permission_count"] = effectivePermissions.length;

      return {
        isAdmin: false,
        source,
        group: groups.length === 1 ? groups[0] : undefined,
        directPermissions,
        effectivePermissions,
      };
    },
    {
      logOverrides: {
        message: "Unexpected error getting current permissions",
        messageKey: "permissions.get_current_permissions.unexpected_error",
      },
    },
  );
}

/**
 * Check if a user or API key has a specific permission.
 */
export async function hasPermission(
  isUserAdmin: boolean,
  entityId: string,
  permissionName: PermissionName,
  options?: PermissionLookupOptions,
): Promise<boolean> {
  return await tracedWithServiceErrorHandling(
    "PermissionsHelper.hasPermission",
    {
      service: "PermissionsHelper",
      method: "hasPermission",
      section: loggerAppSections.AUTH,
      details: { entityId, permission: permissionName },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async (span) => {
      const entityType = resolveEntityType(entityId, options);
      span.attributes["entity_type"] = entityType;
      span.attributes["permission_name"] = permissionName;

      if (!entityId || !permissionName) {
        span.attributes["has_permission"] = false;
        return false;
      }

      const resolvedEnvId = resolveEnvironmentId(options?.environmentId);
      if (!resolvedEnvId) {
        throw new Error("hasPermission: environmentId is required and could not be resolved from request context");
      }

      const cache = await getCache();
      const cacheNamespace = entityType === "user" ? CACHE_NAMESPACES.PERMISSIONS.USER : CACHE_NAMESPACES.PERMISSIONS.API_KEY;
      const cacheKey = `${resolvedEnvId}:${entityId}:${permissionName}`;

      const cached = await cache.get<boolean>(cacheNamespace, cacheKey);
      if (cached !== null) {
        span.attributes["has_permission"] = cached;
        span.attributes["cache_hit"] = true;
        return cached;
      }

      if (entityType === "user" && isUserAdmin) {
        await cache.set(cacheNamespace, cacheKey, true, {
          maxSize: CACHE_CONFIG.MAX_CACHE_SIZE,
          ttl: CACHE_CONFIG.USER_PERMISSION_TTL,
        });
        span.attributes["has_permission"] = true;
        span.attributes["permission_source"] = "admin";
        return true;
      }

      const permissionId = await getPermissionId(permissionName, resolvedEnvId);
      if (!permissionId) {
        await cache.set(cacheNamespace, cacheKey, false, {
          maxSize: CACHE_CONFIG.MAX_CACHE_SIZE,
          ttl: CACHE_CONFIG.USER_PERMISSION_TTL,
        });
        span.attributes["has_permission"] = false;
        span.attributes["permission_not_found"] = true;
        return false;
      }

      const assignment = await queryPermissionAssignment(
        entityType,
        entityId,
        permissionId,
        resolvedEnvId,
      );

      const ttl = assignment.hasPermission && assignment.source === "group" &&
          assignment.groupIsSystem
        ? CACHE_CONFIG.SYSTEM_GROUP_TTL
        : CACHE_CONFIG.USER_PERMISSION_TTL;

      await cache.set(cacheNamespace, cacheKey, assignment.hasPermission, {
        ttl,
        maxSize: CACHE_CONFIG.MAX_CACHE_SIZE,
      });

      span.attributes["has_permission"] = assignment.hasPermission;
      span.attributes["permission_source"] = assignment.source;

      return assignment.hasPermission;
    },
    {
      logOverrides: {
        message: "Unexpected error checking permission",
        messageKey: "permissions.has_permission.unexpected_error",
      },
    },
  );
}

// ============================================================================
// Internal Helpers
// ============================================================================

function resolveEntityType(
  entityId: string,
  options?: PermissionLookupOptions,
): "user" | "apiKey" {
  if (options?.entityType) {
    return options.entityType;
  }

  const apiKeyPrefix = envConfig.auth.apiKeyPrefix;
  if (apiKeyPrefix && entityId.startsWith(`${apiKeyPrefix}-`)) {
    return "apiKey";
  }

  return "user";
}

async function getPermissionId(permissionName: string, environmentId?: string): Promise<string | null> {
  const resolvedEnvId = resolveEnvironmentId(environmentId);
  if (!resolvedEnvId) {
    throw new Error("getPermissionId: environmentId is required and could not be resolved from request context");
  }

  const cache = await getCache();
  const cached = await cache.get<string>(
    CACHE_NAMESPACES.PERMISSIONS.ALL,
    `${resolvedEnvId}:${permissionName}`,
  );
  if (cached !== null) {
    return cached;
  }

  const db = await getTenantDB(resolvedEnvId);
  const perm = await db
    .select({ id: tenantTables.permissions.id })
    .from(tenantTables.permissions)
    .where(eq(tenantTables.permissions.name, permissionName));

  if (perm && perm[0]) {
    await cache.set(
      CACHE_NAMESPACES.PERMISSIONS.ALL,
      `${resolvedEnvId}:${permissionName}`,
      perm[0].id,
      { ttl: CACHE_CONFIG.PERMISSION_ID_TTL },
    );
    return perm[0].id;
  }

  return null;
}

async function queryPermissionAssignment(
  entityType: "user" | "apiKey",
  entityId: string,
  permissionId: string,
  environmentId?: string,
): Promise<PermissionAssignmentResult> {
  return await tracedWithServiceErrorHandling(
    "PermissionHelper.queryPermissionAssignment",
    {
      service: "PermissionHelper",
      method: "queryPermissionAssignment",
      section: loggerAppSections.AUTH,
      details: { entityType, permissionId },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async (span) => {
      span.attributes["entity_type"] = entityType;
      span.attributes["permission_id"] = permissionId;

      const db = await getTenantDB(resolveEnvironmentId(environmentId));

      const directTable = entityType === "user" ? tenantTables.userPermissions : tenantTables.apiKeyPermissions;
      const directEntityIdColumn = entityType === "user" ? tenantTables.userPermissions.userId : tenantTables.apiKeyPermissions.apiKeyId;

      const direct = await db
        .select({ permissionId: directTable.permissionId })
        .from(directTable)
        .where(
          and(
            eq(directEntityIdColumn, entityId),
            eq(directTable.permissionId, permissionId),
          ),
        )
        .limit(1);

      if (direct.length > 0) {
        return { hasPermission: true, source: "direct" };
      }

      const groupTable = entityType === "user" ? tenantTables.userPermissionGroups : tenantTables.apiKeyPermissionGroups;
      const groupEntityIdColumn = entityType === "user"
        ? tenantTables.userPermissionGroups.userId
        : tenantTables.apiKeyPermissionGroups.apiKeyId;

      const group = await db
        .select({ groupId: tenantTables.permissionGroups.id, isSystem: tenantTables.permissionGroups.isSystem })
        .from(tenantTables.permissionGroups)
        .innerJoin(
          groupTable,
          eq(groupTable.groupId, tenantTables.permissionGroups.id),
        )
        .innerJoin(
          tenantTables.permissionGroupPermissions,
          eq(tenantTables.permissionGroupPermissions.groupId, tenantTables.permissionGroups.id),
        )
        .where(
          and(
            eq(groupEntityIdColumn, entityId),
            eq(tenantTables.permissionGroupPermissions.permissionId, permissionId),
          ),
        )
        .limit(1);

      if (group.length > 0) {
        return {
          hasPermission: true,
          source: "group",
          groupId: group[0].groupId,
          groupIsSystem: group[0].isSystem,
        };
      }

      return { hasPermission: false, source: "none" };
    },
    {
      logOverrides: {
        message: `Unexpected error checking ${entityType} permission`,
        messageKey: "permissions.check.unexpected_error",
      },
    },
  );
}
