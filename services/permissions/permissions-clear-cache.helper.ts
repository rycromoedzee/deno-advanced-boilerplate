/**
 * @file services/permissions/permissions-clear-cache.helper.ts
 * @description
 * Cache invalidation helpers for permission-related caches.
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq } from "@deps";

import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";

/**
 * Clear all permission-related caches.
 */
export async function permissionsCacheClearAll(): Promise<void> {
  const cache = await getCache();
  await cache.clearNamespace(CACHE_NAMESPACES.PERMISSIONS.ALL);
  await cache.clearNamespace(CACHE_NAMESPACES.PERMISSIONS.GROUPS);
  await cache.clearNamespace(CACHE_NAMESPACES.PERMISSIONS.USER);
  await cache.clearNamespace(CACHE_NAMESPACES.PERMISSIONS.API_KEY);
  await cache.clearNamespace(CACHE_NAMESPACES.PERMISSIONS.ADMIN);
}

/**
 * Invalidate all cached permissions for a specific user.
 * Call this after changing user permissions or group memberships.
 */
export async function permissionsCacheClearUserPermissions(
  userId: string,
): Promise<void> {
  const cache = await getCache();
  await cache.deletePattern(CACHE_NAMESPACES.PERMISSIONS.USER, `^${userId}:`);
}

/**
 * Invalidate cached admin status for a specific user.
 */
export async function permissionsCacheClearUserAdminStatus(
  userId: string,
  environmentId?: string,
): Promise<void> {
  const cache = await getCache();
  if (environmentId) {
    await cache.delete(CACHE_NAMESPACES.PERMISSIONS.ADMIN, `${environmentId}:${userId}`);
    return;
  }

  await cache.deletePattern(CACHE_NAMESPACES.PERMISSIONS.ADMIN, `^.*:${userId}$`);
}

/**
 * Invalidate all cached permissions for a specific API key.
 * Call this after changing API key permissions or group memberships.
 */
export async function permissionsCacheClearApiKeyPermissions(
  apiKeyId: string,
): Promise<void> {
  const cache = await getCache();
  await cache.deletePattern(
    CACHE_NAMESPACES.PERMISSIONS.API_KEY,
    `^${apiKeyId}:`,
  );
}

/**
 * Invalidate all cached permissions for users and API keys in a specific group.
 * Call this after changing group permissions or membership.
 */
export async function permissionsCacheClearPermissionGroup(
  groupId: string,
): Promise<void> {
  return await tracedWithServiceErrorHandling(
    "PermissionHelper.cacheClearPermissionGroup",
    {
      service: "PermissionHelper",
      method: "cacheClearPermissionGroup",
      section: loggerAppSections.AUTH,
      details: { groupId },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async () => {
      try {
        const db = await getTenantDB();
        const usersInGroup = await db
          .select({ userId: tenantTables.userPermissionGroups.userId })
          .from(tenantTables.userPermissionGroups)
          .where(eq(tenantTables.userPermissionGroups.groupId, groupId));

        const apiKeysInGroup = await db
          .select({ apiKeyId: tenantTables.apiKeyPermissionGroups.apiKeyId })
          .from(tenantTables.apiKeyPermissionGroups)
          .where(eq(tenantTables.apiKeyPermissionGroups.groupId, groupId));

        const cache = await getCache();
        await cache.delete(CACHE_NAMESPACES.PERMISSIONS.GROUPS, groupId);

        // Clear user and API key caches in parallel for better performance
        const userIds = usersInGroup.map((u) => u.userId);
        const apiKeyIds = apiKeysInGroup.map((k) => k.apiKeyId);

        await Promise.all([
          ...userIds.map((id) => permissionsCacheClearUserPermissions(id)),
          ...userIds.map((id) => permissionsCacheClearUserAdminStatus(id)),
          ...apiKeyIds.map((id) => permissionsCacheClearApiKeyPermissions(id)),
        ]);
      } catch (error) {
        try {
          await permissionsCacheClearAll();
        } catch {
          // Ignore cache clear errors to preserve original failure
        }
        throw error;
      }
    },
    {
      logOverrides: {
        message: "Unexpected error invalidating permission group cache",
        messageKey: "permissions.cache.invalidate_group.unexpected_error",
      },
    },
  );
}
