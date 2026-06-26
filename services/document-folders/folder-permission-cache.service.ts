/**
 * @file services/document-folders/folder-permission-cache.service.ts
 * @description Cache service for folder permissions
 *
 * This service provides caching functionality for folder permission checks
 * to improve performance. It uses the existing multi-tier cache service
 * with a 5-minute TTL for permission data.
 */

import { GlobalCacheService } from "@services/cache/cache.service.ts";
import { loggerAppSections, useLogger } from "@logger/logger.ts";
import { LoggerLevels } from "@logger/types.ts";
import { CacheStatistics } from "@interfaces/cache.ts";

/**
 * Document Folder Permission Cache Service
 *
 * Provides caching for folder permission checks:
 * - Caches permission check results with folder-specific keys
 * - Supports cache invalidation for folders and users
 * - Uses 5-minute TTL for cached permissions
 * - Integrates with existing multi-tier cache service
 */
export class DocumentFolderPermissionCacheService {
  private cacheService: GlobalCacheService;
  private readonly CACHE_NAMESPACE = "folder_permissions";
  private readonly CACHE_TTL = 300; // 5 minutes in seconds

  constructor(cacheService: GlobalCacheService) {
    this.cacheService = cacheService;
  }

  /**
   * Gets cached permission level for a user on a folder
   *
   * Note: Permission caching is always enabled regardless of enableHighFrequencyCache
   * because permission checks are security-critical and frequently accessed.
   *
   * @param folderId - Folder ID
   * @param userId - User ID
   * @returns Promise<number | null> - Cached permission level or null if not cached
   */
  async getCachedPermission(
    folderId: string,
    userId: string,
  ): Promise<string | number | null> {
    // Always cache permissions - they're security-critical and frequently accessed
    try {
      const cacheKey = this.buildPermissionCacheKey(folderId, userId);
      const cached = await this.cacheService.get<string | number>(
        this.CACHE_NAMESPACE,
        cacheKey,
      );

      if (cached !== null) {
        await useLogger(LoggerLevels.debug, {
          message: "Folder permission cache hit",
          section: loggerAppSections.DEBUG,
          messageKey: "folder_permission_cache_hit",
          details: { folderId, userId, permission: cached },
        });
      }

      return cached;
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Failed to get cached permission",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_permission_cache_get_error",
        details: { folderId, userId, error },
      });
      // Return null on error to fall back to database query
      return null;
    }
  }

  /**
   * Caches a permission level for a user on a folder
   *
   * Note: Permission caching is always enabled regardless of enableHighFrequencyCache
   * because permission checks are security-critical and frequently accessed.
   *
   * @param folderId - Folder ID
   * @param userId - User ID
   * @param permissionLevel - Permission level to cache
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const cache = new FolderPermissionCacheService(cacheService);
   * await cache.cachePermission('folder_123', 'user_456', DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE);
   * ```
   */
  async cachePermission(
    folderId: string,
    userId: string,
    permissionLevel: string | number,
  ): Promise<void> {
    // Always cache permissions - they're security-critical and frequently accessed
    try {
      const cacheKey = this.buildPermissionCacheKey(folderId, userId);
      await this.cacheService.set(
        this.CACHE_NAMESPACE,
        cacheKey,
        permissionLevel,
        { ttl: this.CACHE_TTL },
      );

      await useLogger(LoggerLevels.debug, {
        message: "Folder permission cached",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_permission_cached",
        details: { folderId, userId, permissionLevel, ttl: this.CACHE_TTL },
      });
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Failed to cache permission",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_permission_cache_set_error",
        details: { folderId, userId, permissionLevel, error },
      });
      // Don't throw - caching errors should not break the application
    }
  }

  /**
   * Invalidates all cached permissions for a specific folder
   *
   * Note: Permission caching is always enabled regardless of enableHighFrequencyCache
   * because permission checks are security-critical and frequently accessed.
   *
   * @param folderId - Folder ID
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const cache = new FolderPermissionCacheService(cacheService);
   * // Invalidate when folder sharing configuration changes
   * await cache.invalidateFolderPermissions('folder_123');
   * ```
   */
  async invalidateFolderPermissions(folderId: string): Promise<void> {
    // Always invalidate permissions - they're security-critical
    try {
      // Delete all cache entries matching the folder pattern
      const pattern = `folder:${folderId}:*`;
      await this.cacheService.deletePattern(this.CACHE_NAMESPACE, pattern);

      await useLogger(LoggerLevels.debug, {
        message: "Folder permissions cache invalidated",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_permission_cache_invalidated",
        details: { folderId, pattern },
      });
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Failed to invalidate folder permissions cache",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_permission_cache_invalidate_error",
        details: { folderId, error },
      });
      // Don't throw - cache invalidation errors should not break the application
    }
  }

  /**
   * Invalidates all cached permissions for a specific user
   *
   * Note: Permission caching is always enabled regardless of enableHighFrequencyCache
   * because permission checks are security-critical and frequently accessed.
   *
   * @param userId - User ID
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const cache = new FolderPermissionCacheService(cacheService);
   * // Invalidate when user's permissions change across multiple folders
   * await cache.invalidateUserPermissions('user_456');
   * ```
   */
  async invalidateUserPermissions(userId: string): Promise<void> {
    // Always invalidate permissions - they're security-critical
    try {
      // Delete all cache entries matching the user pattern
      const pattern = `*:user:${userId}`;
      await this.cacheService.deletePattern(this.CACHE_NAMESPACE, pattern);

      await useLogger(LoggerLevels.debug, {
        message: "User permissions cache invalidated",
        section: loggerAppSections.DEBUG,
        messageKey: "user_permission_cache_invalidated",
        details: { userId, pattern },
      });
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Failed to invalidate user permissions cache",
        section: loggerAppSections.DEBUG,
        messageKey: "user_permission_cache_invalidate_error",
        details: { userId, error },
      });
      // Don't throw - cache invalidation errors should not break the application
    }
  }

  /**
   * Invalidates a specific permission cache entry
   *
   * Note: Permission caching is always enabled regardless of enableHighFrequencyCache
   * because permission checks are security-critical and frequently accessed.
   *
   * @param folderId - Folder ID
   * @param userId - User ID
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const cache = new FolderPermissionCacheService(cacheService);
   * await cache.invalidatePermission('folder_123', 'user_456');
   * ```
   */
  async invalidatePermission(folderId: string, userId: string): Promise<void> {
    // Always invalidate permissions - they're security-critical
    try {
      const cacheKey = this.buildPermissionCacheKey(folderId, userId);
      await this.cacheService.delete(this.CACHE_NAMESPACE, cacheKey);

      await useLogger(LoggerLevels.debug, {
        message: "Permission cache entry invalidated",
        section: loggerAppSections.DEBUG,
        messageKey: "permission_cache_entry_invalidated",
        details: { folderId, userId },
      });
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Failed to invalidate permission cache entry",
        section: loggerAppSections.DEBUG,
        messageKey: "permission_cache_entry_invalidate_error",
        details: { folderId, userId, error },
      });
      // Don't throw - cache invalidation errors should not break the application
    }
  }

  /**
   * Builds a cache key for a folder-user permission
   *
   * @param folderId - Folder ID
   * @param userId - User ID
   * @returns string - Cache key in format "folder:{folderId}:user:{userId}"
   *
   * @private
   */
  private buildPermissionCacheKey(folderId: string, userId: string): string {
    return `folder:${folderId}:user:${userId}`;
  }

  /**
   * Gets cache statistics for the folder permissions namespace
   *
   * @returns Promise<CacheStatistics | null> - Cache statistics, or null on error
   */
  async getCacheStats(): Promise<CacheStatistics | null> {
    try {
      return await this.cacheService.getStats(this.CACHE_NAMESPACE);
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Failed to get cache statistics",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_permission_cache_stats_error",
        details: { error },
      });
      return null;
    }
  }
}
