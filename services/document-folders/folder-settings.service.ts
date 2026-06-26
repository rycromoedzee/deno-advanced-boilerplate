/**
 * @file services/document-folders/folder-settings.service.ts
 * @description Service for folder settings and statistics
 *
 * This service provides comprehensive folder statistics including:
 * - Summary statistics (counts, depths, sharing info)
 * - Root folder statistics (detailed stats for each root folder)
 * - Recursive folder structure with document counts
 */

import { and, count, countDistinct, eq, inArray, isNotNull, isNull, or } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getCache } from "@services/cache/index.ts";
import type {
  IFolderSettingsResponse,
  IFolderSettingsSummary,
  IFolderStructureItem,
  IRootFolderStat,
} from "@models/documents/folder-settings.model.ts";
import { DocumentFolderCrudHelpers } from "./folder-crud.helpers.ts";

export class FolderSettingsService {
  /**
   * Gets comprehensive folder settings and statistics for a user
   *
   * @param userId - User ID to get settings for
   * @param environmentId - Environment ID
   * @returns Promise<IFolderSettingsResponse> - Complete folder settings response
   */
  async getSettings(userId: string, environmentId: string): Promise<IFolderSettingsResponse> {
    return await tracedWithServiceErrorHandling(
      "FolderSettingsService.getSettings",
      {
        service: "FolderSettingsService",
        method: "getSettings",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;

        // Try cache first

        // Execute all queries in parallel for better performance
        const [summary, rootFolderStats, folderStructure] = await Promise.all([
          this.getSummaryStats(userId, environmentId),
          this.getRootFolderStats(userId, environmentId),
          this.buildFolderStructure(userId, environmentId),
        ]);

        const settings: IFolderSettingsResponse = {
          summary,
          rootFolderStats,
          folderStructure,
        };

        // Cache for 5 minutes (settings don't need to be real-time)
        //await cache.set("folder_settings", cacheKey, JSON.stringify(settings), { ttl: 300 });

        span.attributes["root_folders_count"] = rootFolderStats.length;
        span.attributes["structure_folders_count"] = folderStructure.length;
        span.attributes["total_folder_count"] = summary.totalFolderCount;

        return settings;
      },
    );
  }

  /**
   * Gets summary statistics for user's folders
   */
  private async getSummaryStats(userId: string, environmentId: string): Promise<IFolderSettingsSummary> {
    const [folderCountResult, maxDepthResult, sharedUsersResult, sharedFoldersResult] = await Promise.all([
      // Total folder count (owned, non-archived)
      (await getTenantDB(environmentId))
        .select({ count: count() })
        .from(tenantTables.documentFolders)
        .where(
          and(
            eq(tenantTables.documentFolders.ownerId, userId),
          ),
        ),

      // Max folder depth
      this.calculateMaxDepth(userId, environmentId),

      // Users with shared access to owned folders
      (await getTenantDB(environmentId))
        .select({ count: countDistinct(tenantTables.documentFoldersSharedUsers.userId) })
        .from(tenantTables.documentFoldersSharedUsers)
        .innerJoin(
          tenantTables.documentFolders,
          eq(tenantTables.documentFoldersSharedUsers.folderId, tenantTables.documentFolders.id),
        )
        .where(
          and(
            eq(tenantTables.documentFolders.ownerId, userId),
            eq(tenantTables.documentFoldersSharedUsers.isActive, true),
          ),
        ),

      // Folders shared with current user
      (await getTenantDB(environmentId))
        .select({ count: countDistinct(tenantTables.documentFoldersSharedUsers.folderId) })
        .from(tenantTables.documentFoldersSharedUsers)
        .innerJoin(
          tenantTables.documentFolders,
          eq(tenantTables.documentFoldersSharedUsers.folderId, tenantTables.documentFolders.id),
        )
        .where(
          and(
            eq(tenantTables.documentFoldersSharedUsers.userId, userId),
            eq(tenantTables.documentFoldersSharedUsers.isActive, true),
          ),
        ),
    ]);

    return {
      totalFolderCount: folderCountResult[0]?.count || 0,
      maxFolderDepth: maxDepthResult,
      usersWithSharedAccess: sharedUsersResult[0]?.count || 0,
      foldersSharedWithMe: sharedFoldersResult[0]?.count || 0,
    };
  }

  /**
   * Gets detailed statistics for each root folder (optimized with batch queries)
   */
  private async getRootFolderStats(userId: string, environmentId: string): Promise<IRootFolderStat[]> {
    // Get all root folders (parentFolderId IS NULL)
    const rootFolders = await (await getTenantDB(environmentId))
      .select({
        id: tenantTables.documentFolders.id,
        name: tenantTables.documentFolders.name,
        icon: tenantTables.documentFolders.icon,
        color: tenantTables.documentFolders.color,
        isArchived: tenantTables.documentFolders.isArchived,
      })
      .from(tenantTables.documentFolders)
      .where(
        and(
          eq(tenantTables.documentFolders.ownerId, userId),
          isNull(tenantTables.documentFolders.parentFolderId),
        ),
      )
      .orderBy(tenantTables.documentFolders.name);

    if (rootFolders.length === 0) {
      return [];
    }

    const rootFolderIds = rootFolders.map((f: { id: string }) => f.id);

    // Batch query 1: Get all descendants with their root folder mapping
    const descendantCounts = await this.batchGetDescendantCounts(rootFolderIds, userId);

    // Batch query 2: Get document counts for all folder trees
    const documentCounts = await this.batchGetDocumentCountsForFolderTrees(rootFolderIds, userId);

    // Batch query 3: Get shared user counts for all folders
    const sharedUserCounts = await this.batchGetSharedUserCounts(rootFolderIds);

    // Batch query 4: Get max depths for all folder trees
    const maxDepths = await this.batchGetMaxDepths(rootFolderIds);

    // Combine all stats in memory
    return rootFolders.map((folder: { id: string; name: string; icon: string | null; color: string | null; isArchived: boolean }) => ({
      id: folder.id,
      name: folder.name,
      icon: folder.icon,
      color: folder.color || "#3b82f6",
      isArchived: folder.isArchived,
      subFolderCount: descendantCounts.get(folder.id) || 0,
      documentCount: documentCounts.get(folder.id) || 0,
      isShared: (sharedUserCounts.get(folder.id) || 0) > 0,
      sharedUserCount: sharedUserCounts.get(folder.id) || 0,
      maxDepth: maxDepths.get(folder.id) || 0,
    }));
  }

  /**
   * Batch get descendant counts for multiple root folders
   * Returns a map of root folder ID -> descendant count
   * Uses iterative approach since Drizzle ORM doesn't support WITH RECURSIVE
   */
  private async batchGetDescendantCounts(
    rootFolderIds: string[],
    userId: string,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    // Initialize all roots with 0
    for (const id of rootFolderIds) {
      counts.set(id, 0);
    }

    // Build a map of folder -> root by traversing iteratively
    const folderToRoot = new Map<string, string>();
    const visited = new Set<string>();

    // Start with direct children of root folders
    let currentLevel = await (await getTenantDB())
      .select({
        id: tenantTables.documentFolders.id,
        parentFolderId: tenantTables.documentFolders.parentFolderId,
      })
      .from(tenantTables.documentFolders)
      .where(
        and(
          inArray(tenantTables.documentFolders.parentFolderId, rootFolderIds),
          eq(tenantTables.documentFolders.ownerId, userId),
          eq(tenantTables.documentFolders.isArchived, false),
        ),
      );

    // Map first level children to their root parents
    for (const folder of currentLevel) {
      const rootId = folder.parentFolderId;
      if (rootId && rootFolderIds.includes(rootId)) {
        folderToRoot.set(folder.id, rootId);
        visited.add(folder.id);
      }
    }

    // Iteratively find deeper levels
    while (currentLevel.length > 0) {
      const currentIds = currentLevel.map((f: { id: string }) => f.id);

      // Get children of current level
      const children = await (await getTenantDB())
        .select({
          id: tenantTables.documentFolders.id,
          parentFolderId: tenantTables.documentFolders.parentFolderId,
        })
        .from(tenantTables.documentFolders)
        .where(
          and(
            inArray(tenantTables.documentFolders.parentFolderId, currentIds),
            eq(tenantTables.documentFolders.ownerId, userId),
            eq(tenantTables.documentFolders.isArchived, false),
          ),
        );

      // Map children to their root ancestors
      const newChildren: typeof currentLevel = [];
      for (const child of children) {
        if (!visited.has(child.id) && child.parentFolderId) {
          const parentRoot = folderToRoot.get(child.parentFolderId);
          if (parentRoot) {
            folderToRoot.set(child.id, parentRoot);
            visited.add(child.id);
            newChildren.push(child);
          }
        }
      }

      currentLevel = newChildren;
    }

    // Count descendants per root
    for (const rootId of folderToRoot.values()) {
      counts.set(rootId, (counts.get(rootId) || 0) + 1);
    }

    return counts;
  }

  /**
   * Batch get document counts for all folder trees
   * Returns a map of root folder ID -> total document count in that tree
   * Uses iterative approach since Drizzle ORM doesn't support WITH RECURSIVE
   */
  private async batchGetDocumentCountsForFolderTrees(
    rootFolderIds: string[],
    userId: string,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const id of rootFolderIds) {
      counts.set(id, 0);
    }

    // Build a map of all folders to their root ancestor iteratively
    const folderToRoot = new Map<string, string>();

    // Root folders map to themselves
    for (const rootId of rootFolderIds) {
      folderToRoot.set(rootId, rootId);
    }

    // Get all folders owned by user in one query
    const allFolders = await (await getTenantDB())
      .select({
        id: tenantTables.documentFolders.id,
        parentFolderId: tenantTables.documentFolders.parentFolderId,
      })
      .from(tenantTables.documentFolders)
      .where(
        and(
          eq(tenantTables.documentFolders.ownerId, userId),
          eq(tenantTables.documentFolders.isArchived, false),
        ),
      );

    // Build parent-child map
    const parentMap = new Map<string, string | null>();
    for (const folder of allFolders) {
      parentMap.set(folder.id, folder.parentFolderId);
    }

    // Resolve root for each folder using iterative approach
    const resolveRoot = (folderId: string, visited: Set<string> = new Set()): string | null => {
      if (folderToRoot.has(folderId)) {
        return folderToRoot.get(folderId)!;
      }

      if (visited.has(folderId)) {
        return null; // Circular reference
      }
      visited.add(folderId);

      const parentId = parentMap.get(folderId);
      if (!parentId) {
        return null;
      }

      // Check if parent is a root folder
      if (rootFolderIds.includes(parentId)) {
        folderToRoot.set(folderId, parentId);
        return parentId;
      }

      // Recursively resolve parent's root
      const root = resolveRoot(parentId, visited);
      if (root) {
        folderToRoot.set(folderId, root);
      }
      return root;
    };

    // Resolve roots for all folders
    for (const folder of allFolders) {
      resolveRoot(folder.id);
    }

    // Get all document counts by folder
    const folderIds = Array.from(folderToRoot.keys());
    if (folderIds.length === 0) {
      return counts;
    }

    const docCounts = await (await getTenantDB())
      .select({
        folderId: tenantTables.documents.folderId,
        docCount: count(),
      })
      .from(tenantTables.documents)
      .where(
        and(
          inArray(tenantTables.documents.folderId, folderIds),
          eq(tenantTables.documents.ownerId, userId),
          eq(tenantTables.documents.isArchived, false),
        ),
      )
      .groupBy(tenantTables.documents.folderId);

    // Aggregate document counts by root
    for (const row of docCounts) {
      if (row.folderId) {
        const rootId = folderToRoot.get(row.folderId);
        if (rootId) {
          counts.set(rootId, (counts.get(rootId) || 0) + row.docCount);
        }
      }
    }

    return counts;
  }

  /**
   * Batch get shared user counts for multiple folders
   * Returns a map of folder ID -> shared user count
   */
  private async batchGetSharedUserCounts(
    folderIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const id of folderIds) {
      counts.set(id, 0);
    }

    const results = await (await getTenantDB())
      .select({
        folderId: tenantTables.documentFoldersSharedUsers.folderId,
        count: count(),
      })
      .from(tenantTables.documentFoldersSharedUsers)
      .where(
        and(
          inArray(tenantTables.documentFoldersSharedUsers.folderId, folderIds),
          eq(tenantTables.documentFoldersSharedUsers.isActive, true),
        ),
      )
      .groupBy(tenantTables.documentFoldersSharedUsers.folderId);

    for (const row of results) {
      counts.set(row.folderId, row.count);
    }

    return counts;
  }

  /**
   * Batch get max depths for multiple folder trees
   * Returns a map of root folder ID -> max depth
   * Uses iterative approach since Drizzle ORM doesn't support WITH RECURSIVE
   */
  private async batchGetMaxDepths(
    rootFolderIds: string[],
  ): Promise<Map<string, number>> {
    const depths = new Map<string, number>();
    for (const id of rootFolderIds) {
      depths.set(id, 0);
    }

    // Build maps of folder -> root and folder -> depth by traversing iteratively
    const folderToRoot = new Map<string, string>();
    const folderDepths = new Map<string, number>();
    const visited = new Set<string>();

    // Root folders at depth 0
    for (const rootId of rootFolderIds) {
      folderToRoot.set(rootId, rootId);
      folderDepths.set(rootId, 0);
      visited.add(rootId);
    }

    // Start with direct children of root folders
    let currentLevel = await (await getTenantDB())
      .select({
        id: tenantTables.documentFolders.id,
        parentFolderId: tenantTables.documentFolders.parentFolderId,
      })
      .from(tenantTables.documentFolders)
      .where(
        and(
          inArray(tenantTables.documentFolders.parentFolderId, rootFolderIds),
          eq(tenantTables.documentFolders.isArchived, false),
        ),
      );

    // Map first level children to their root parents at depth 1
    for (const folder of currentLevel) {
      const rootId = folder.parentFolderId;
      if (rootId && rootFolderIds.includes(rootId)) {
        folderToRoot.set(folder.id, rootId);
        folderDepths.set(folder.id, 1);
        visited.add(folder.id);
      }
    }

    // Iteratively find deeper levels
    while (currentLevel.length > 0) {
      const currentIds = currentLevel.map((f: { id: string }) => f.id);

      // Get children of current level
      const children = await (await getTenantDB())
        .select({
          id: tenantTables.documentFolders.id,
          parentFolderId: tenantTables.documentFolders.parentFolderId,
        })
        .from(tenantTables.documentFolders)
        .where(
          and(
            inArray(tenantTables.documentFolders.parentFolderId, currentIds),
            eq(tenantTables.documentFolders.isArchived, false),
          ),
        );

      // Map children to their root ancestors and track depth
      const newChildren: typeof currentLevel = [];
      for (const child of children) {
        if (!visited.has(child.id) && child.parentFolderId) {
          const parentRoot = folderToRoot.get(child.parentFolderId);
          const parentDepth = folderDepths.get(child.parentFolderId);
          if (parentRoot && parentDepth !== undefined) {
            folderToRoot.set(child.id, parentRoot);
            folderDepths.set(child.id, parentDepth + 1);
            visited.add(child.id);
            newChildren.push(child);
          }
        }
      }

      currentLevel = newChildren;
    }

    // Calculate max depth per root
    for (const [folderId, rootId] of folderToRoot) {
      const folderDepth = folderDepths.get(folderId) || 0;
      const currentMax = depths.get(rootId) || 0;
      if (folderDepth > currentMax) {
        depths.set(rootId, folderDepth);
      }
    }

    return depths;
  }

  /**
   * Builds the recursive folder structure with document counts
   */
  private async buildFolderStructure(userId: string, environmentId: string): Promise<IFolderStructureItem[]> {
    // Get all folders accessible to user (owned + shared)
    const folders = await (await getTenantDB(environmentId))
      .select({
        id: tenantTables.documentFolders.id,
        name: tenantTables.documentFolders.name,
        icon: tenantTables.documentFolders.icon,
        color: tenantTables.documentFolders.color,
        parentFolderId: tenantTables.documentFolders.parentFolderId,
        ownerId: tenantTables.documentFolders.ownerId,
        isArchived: tenantTables.documentFolders.isArchived,
      })
      .from(tenantTables.documentFolders)
      .leftJoin(
        tenantTables.documentFoldersSharedUsers,
        and(
          eq(tenantTables.documentFoldersSharedUsers.folderId, tenantTables.documentFolders.id),
          eq(tenantTables.documentFoldersSharedUsers.userId, userId),
          eq(tenantTables.documentFoldersSharedUsers.isActive, true),
        ),
      )
      .where(
        and(
          or(
            eq(tenantTables.documentFolders.ownerId, userId),
            isNotNull(tenantTables.documentFoldersSharedUsers.userId),
          ),
        ),
      )
      .orderBy(tenantTables.documentFolders.name);

    // Get document counts for all folders
    const folderIds = folders.map((f: { id: string }) => f.id);
    const documentCounts = await this.getDocumentCountsForFolders(folderIds, userId);

    // Build folder map for easy lookup
    const folderMap = new Map<string, IFolderStructureItem>();
    const rootFolders: IFolderStructureItem[] = [];

    // Create all folder nodes
    for (const folder of folders) {
      const folderNode: IFolderStructureItem = {
        id: folder.id,
        name: folder.name,
        icon: folder.icon,
        color: folder.color || "#3b82f6", // Default color if null
        documentCount: documentCounts.get(folder.id) || 0,
        children: null,
        isArchived: folder.isArchived,
      };
      folderMap.set(folder.id, folderNode);
    }

    // Build hierarchy
    for (const folder of folders) {
      const folderNode = folderMap.get(folder.id)!;

      if (folder.parentFolderId) {
        const parent = folderMap.get(folder.parentFolderId);
        if (parent) {
          if (!parent.children) {
            parent.children = [];
          }
          parent.children.push(folderNode);
        }
      } else {
        rootFolders.push(folderNode);
      }
    }

    return rootFolders;
  }

  /**
   * Calculates the maximum depth of the user's folder hierarchy
   * Uses iterative approach since Drizzle ORM doesn't support WITH RECURSIVE
   */
  private async calculateMaxDepth(userId: string, environmentId: string): Promise<number> {
    // Get all root folders (depth 1)
    const rootFolders = await (await getTenantDB(environmentId))
      .select({ id: tenantTables.documentFolders.id })
      .from(tenantTables.documentFolders)
      .where(
        and(
          eq(tenantTables.documentFolders.ownerId, userId),
          isNull(tenantTables.documentFolders.parentFolderId),
          eq(tenantTables.documentFolders.isArchived, false),
        ),
      );

    if (rootFolders.length === 0) {
      return 0;
    }

    // Iteratively find max depth using BFS
    let maxDepth = 0;
    let currentLevel = rootFolders.map((f: { id: string }) => f.id);
    const visited = new Set<string>();

    while (currentLevel.length > 0) {
      maxDepth++;

      // Mark current level as visited
      for (const id of currentLevel) {
        visited.add(id);
      }

      // Get all children of current level in one batch query
      const children = await (await getTenantDB(environmentId))
        .select({ id: tenantTables.documentFolders.id })
        .from(tenantTables.documentFolders)
        .where(
          and(
            inArray(tenantTables.documentFolders.parentFolderId, currentLevel),
            eq(tenantTables.documentFolders.ownerId, userId),
            eq(tenantTables.documentFolders.isArchived, false),
          ),
        );

      // Filter out any already visited (prevent infinite loops from circular refs)
      currentLevel = children
        .map((f: { id: string }) => f.id)
        .filter((id: string) => !visited.has(id));
    }

    return maxDepth;
  }

  /**
   * Counts total documents in a folder tree (recursive)
   */
  private async countDocumentsInFolderTree(folderId: string, userId: string): Promise<number> {
    const descendantIds = await DocumentFolderCrudHelpers.getDescendantFolderIds(folderId, userId);
    const allFolderIds = [folderId, ...descendantIds];

    const result = await (await getTenantDB())
      .select({ count: count() })
      .from(tenantTables.documents)
      .where(
        and(
          inArray(tenantTables.documents.folderId, allFolderIds),
          eq(tenantTables.documents.ownerId, userId),
          eq(tenantTables.documents.isArchived, false),
        ),
      );

    return result[0]?.count || 0;
  }

  /**
   * Counts active shared users for a folder
   */
  private async countSharedUsersForFolder(folderId: string): Promise<number> {
    const result = await (await getTenantDB())
      .select({ count: count() })
      .from(tenantTables.documentFoldersSharedUsers)
      .where(
        and(
          eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
          eq(tenantTables.documentFoldersSharedUsers.isActive, true),
        ),
      );

    return result[0]?.count || 0;
  }

  /**
   * Gets maximum depth from a specific folder
   */
  private async getMaxDepthFromFolder(folderId: string): Promise<number> {
    return await DocumentFolderCrudHelpers.getMaxDescendantDepth(folderId);
  }

  /**
   * Gets document counts for multiple folders in a single query
   */
  private async getDocumentCountsForFolders(folderIds: string[], userId: string): Promise<Map<string, number>> {
    if (folderIds.length === 0) {
      return new Map();
    }

    const results = await (await getTenantDB())
      .select({
        folderId: tenantTables.documents.folderId,
        count: count(),
      })
      .from(tenantTables.documents)
      .where(
        and(
          inArray(tenantTables.documents.folderId, folderIds),
          eq(tenantTables.documents.ownerId, userId),
          eq(tenantTables.documents.isArchived, false),
        ),
      )
      .groupBy(tenantTables.documents.folderId);

    const counts = new Map<string, number>();
    for (const result of results) {
      if (result.folderId) {
        counts.set(result.folderId, result.count);
      }
    }

    return counts;
  }

  /**
   * Invalidates the folder settings cache for a user
   * Should be called when folders are created, deleted, moved, or sharing changes
   */
  async invalidateCache(userId: string, environmentId: string): Promise<void> {
    try {
      const cache = await getCache();
      await cache.delete("folder_settings", `folder_settings:${userId}:${environmentId}`);
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Failed to invalidate folder settings cache",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        messageKey: "folder_settings.cache.invalidate_error",
        details: { userId, environmentId, error },
      });
    }
  }
}
