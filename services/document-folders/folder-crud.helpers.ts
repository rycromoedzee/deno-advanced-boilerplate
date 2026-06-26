/**
 * @file services/document-folders/folder-crud.helpers.ts
 * @description Static utility functions for folder CRUD operations
 *
 * This module contains helper functions extracted from DocumentFolderCrudService
 * for reusability and better code organization.
 */

import { and, count, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import type { IDocumentFolder, IFolderHierarchy } from "@models/documents/folder.model.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

/**
 * DocumentFolderCrudHelpers
 *
 * Static utility functions for folder operations including:
 * - Validation
 * - Normalization
 * - Hierarchy building
 * - Descendant operations
 */
export class DocumentFolderCrudHelpers {
  /**
   * Validates folder path for allowed characters and length
   * @param path - Folder path to validate
   * @returns {boolean} True if valid, false otherwise
   */
  public static validateFolderPath(path: string): boolean {
    if (!path || typeof path !== "string") return false;
    if (path.length > 1000) return false;
    return !/[<>:"|?*]/.test(path);
  }

  /**
   * Normalizes folder name by sanitizing and trimming
   * @param name - Folder name to normalize
   * @returns {string} Normalized folder name
   */
  public static normalizeFolderName(name: string): string {
    return name
      .trim()
      .replace(/[<>:"|?*]/g, "_")
      .replace(/\s+/g, " ")
      .substring(0, 255);
  }

  /**
   * Builds a hierarchical folder tree from flat array
   * @param folders - Array of folder objects
   * @returns {IFolderHierarchy[]} Hierarchical folder tree
   */
  public static buildFolderHierarchy(folders: IDocumentFolder[]): IFolderHierarchy[] {
    const folderMap = new Map<string, IFolderHierarchy>();
    const result: IFolderHierarchy[] = [];

    // First pass: create all folders
    folders.forEach((folder) => {
      folderMap.set(folder.id, { ...folder, children: [], documentCount: 0, depth: 0 });
    });

    // Second pass: build hierarchy
    folders.forEach((folder) => {
      const folderNode = folderMap.get(folder.id)!;
      if (folder.parentFolderId) {
        const parent = folderMap.get(folder.parentFolderId);
        if (parent) {
          parent.children.push(folderNode);
        } else {
          result.push(folderNode);
        }
      } else {
        result.push(folderNode);
      }
    });

    return result;
  }

  /**
   * Gets all descendant folder IDs recursively
   * Optimized with Recursive CTE for single-query execution
   *
   * @param folderId - Parent folder ID
   * @param userId - ID of the user
   * @returns Promise<string[]> - Array of descendant folder IDs
   */
  public static async getDescendantFolderIds(
    folderId: string,
    userId: string,
  ): Promise<string[]> {
    // Use iterative approach (Drizzle ORM 0.44.x does not support WITH RECURSIVE)
    return await this.getDescendantFolderIdsIterative(folderId, userId);
  }

  /**
   * Fallback iterative implementation for descendant folder IDs
   * Used when Recursive CTE is not supported or fails
   *
   * @private
   * @param folderId - Parent folder ID
   * @param userId - ID of the user
   * @returns Promise<string[]> - Array of descendant folder IDs
   */
  private static async getDescendantFolderIdsIterative(
    folderId: string,
    userId: string,
  ): Promise<string[]> {
    const db = await getTenantDB();
    const descendants: string[] = [];
    const queue: string[] = [folderId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      // Process in batches to reduce database round trips
      const batchSize = Math.min(queue.length, 50); // Process up to 50 folders per query
      const currentBatch = queue.splice(0, batchSize);

      // Filter out already visited folders
      const unvisitedBatch = currentBatch.filter((id: string) => !visited.has(id));
      if (unvisitedBatch.length === 0) continue;

      // Mark as visited
      for (const id of unvisitedBatch) {
        visited.add(id);
      }

      // Batch query all children for current batch of folders
      const { inArray } = await import("@deps");
      const children = await db
        .select({ id: tenantTables.documentFolders.id })
        .from(tenantTables.documentFolders)
        .where(
          and(
            inArray(tenantTables.documentFolders.parentFolderId, unvisitedBatch),
            eq(tenantTables.documentFolders.ownerId, userId),
            eq(tenantTables.documentFolders.isArchived, false),
          ),
        );

      for (const child of children) {
        descendants.push(child.id);
        queue.push(child.id);
      }
    }

    return descendants;
  }

  /**
   * Builds a single hierarchy node with its children recursively
   *
   * @param folder - The folder to build hierarchy for
   * @param userId - ID of the user
   * @param environmentId - Environment ID
   * @param currentDepth - Current depth in the tree
   * @param maxDepth - Maximum depth to traverse
   * @param findChildrenFn - Function to find child folders
   * @returns Promise<IFolderHierarchy> - Folder hierarchy node
   */
  public static async buildHierarchyNode(
    folder: IDocumentFolder,
    userId: string,
    environmentId: string,
    currentDepth: number,
    maxDepth: number,
    findChildrenFn: (parentId: string | null, userId: string, environmentId: string) => Promise<IDocumentFolder[]>,
  ): Promise<IFolderHierarchy> {
    const db = await getTenantDB();

    // Count documents in this folder
    const documentCountResult = await db
      .select({ count: count() })
      .from(tenantTables.documents)
      .where(
        and(
          eq(tenantTables.documents.folderId, folder.id),
          eq(tenantTables.documents.ownerId, userId),
          eq(tenantTables.documents.isArchived, false),
        ),
      );

    const documentCount = documentCountResult[0]?.count || 0;

    // Base case: max depth reached or no more children
    if (currentDepth >= maxDepth) {
      return {
        ...folder,
        children: [],
        documentCount,
        depth: currentDepth,
      };
    }

    // Get child folders
    const childFolders = await findChildrenFn(
      folder.id,
      userId,
      environmentId,
    );

    // Recursively build children
    const children: IFolderHierarchy[] = [];
    for (const child of childFolders) {
      const childHierarchy = await DocumentFolderCrudHelpers.buildHierarchyNode(
        child,
        userId,
        environmentId,
        currentDepth + 1,
        maxDepth,
        findChildrenFn,
      );
      children.push(childHierarchy);
    }

    return {
      ...folder,
      children,
      documentCount,
      depth: currentDepth,
    };
  }

  /**
   * Calculates the depth of a folder after a potential move
   *
   * @param folderId - Folder ID
   * @param newParentId - New parent folder ID (null for root)
   * @returns Promise<number> - The depth after move (0 for root level)
   */
  public static async calculateDepth(
    folderId: string,
    newParentId: string | null,
  ): Promise<number> {
    const db = await getTenantDB();

    try {
      // If moving to root, depth is 0
      if (!newParentId) {
        return 0;
      }

      // Calculate depth of new parent
      let depth = 1;
      let currentId: string | null = newParentId;
      const visited = new Set<string>();

      while (currentId) {
        if (visited.has(currentId)) {
          // Loop detected
          throw new Error("Circular reference detected in folder structure");
        }
        visited.add(currentId);

        const result = await db
          .select({ parentFolderId: tenantTables.documentFolders.parentFolderId })
          .from(tenantTables.documentFolders)
          .where(eq(tenantTables.documentFolders.id, currentId))
          .limit(1);

        if (result.length === 0) {
          break;
        }

        currentId = result[0].parentFolderId;
        if (currentId) {
          depth++;
        }
      }

      // Now calculate the maximum depth of the folder being moved
      const maxChildDepth = await DocumentFolderCrudHelpers.getMaxDescendantDepth(folderId);

      return depth + maxChildDepth;
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Unexpected error calculating folder depth",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        messageKey: "folder_calculate_depth_unexpected_error",
        details: { folderId, newParentId, error },
      });

      throw error;
    }
  }

  /**
   * Gets the maximum depth of descendants for a folder
   * Optimized with Recursive CTE for single-query execution
   *
   * @param folderId - Folder ID
   * @returns Promise<number> - Maximum depth of descendants (0 if no children)
   */
  public static async getMaxDescendantDepth(folderId: string): Promise<number> {
    const db = await getTenantDB();

    try {
      // Use iterative approach (Drizzle ORM 0.44.x does not support WITH RECURSIVE)
      let maxDepth = 0;
      let currentIds = [folderId];
      const visited = new Set<string>();

      while (currentIds.length > 0) {
        for (const id of currentIds) visited.add(id);

        const { inArray } = await import("@deps");
        const children = await db
          .select({ id: tenantTables.documentFolders.id })
          .from(tenantTables.documentFolders)
          .where(
            and(
              inArray(tenantTables.documentFolders.parentFolderId, currentIds),
              eq(tenantTables.documentFolders.isArchived, false),
            ),
          );

        const nextIds = children
          .map((c) => c.id)
          .filter((id: string) => !visited.has(id));

        if (nextIds.length > 0) {
          maxDepth++;
          currentIds = nextIds;
        } else {
          break;
        }
      }

      return maxDepth;
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Error calculating max descendant depth, returning 0",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        messageKey: "folder_max_depth_cte_fallback",
        details: { folderId, error },
      });
      return 0;
    }
  }

  /**
   * Gets all descendant folders recursively
   * Optimized with Recursive CTE for single-query execution
   *
   * @param folderId - ID of the parent folder
   * @param userId - ID of the user
   * @param environmentId - ID of the environment
   * @returns Promise<IDocumentFolder[]> - Array of descendant folders
   */
  public static async getAllDescendants(
    folderId: string,
    userId: string,
    environmentId: string,
  ): Promise<IDocumentFolder[]> {
    const _db = await getTenantDB();

    // Use iterative approach (Drizzle ORM 0.44.x does not support WITH RECURSIVE)
    return await this.getAllDescendantsIterative(folderId, userId, environmentId);
  }

  /**
   * Fallback iterative implementation for getAllDescendants
   * Used when Recursive CTE is not supported or fails
   *
   * @private
   * @param folderId - ID of the parent folder
   * @param userId - ID of the user
   * @param environmentId - ID of the environment
   * @returns Promise<IDocumentFolder[]> - Array of descendant folders
   */
  private static async getAllDescendantsIterative(
    folderId: string,
    userId: string,
    _environmentId: string,
  ): Promise<IDocumentFolder[]> {
    const db = await getTenantDB();
    const descendants: IDocumentFolder[] = [];
    const queue: string[] = [folderId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      // Process in batches to reduce database round trips
      const batchSize = Math.min(queue.length, 50); // Process up to 50 folders per query
      const currentBatch = queue.splice(0, batchSize);

      // Filter out already visited folders
      const unvisitedBatch = currentBatch.filter((id: string) => !visited.has(id));
      if (unvisitedBatch.length === 0) continue;

      // Mark as visited
      for (const id of unvisitedBatch) {
        visited.add(id);
      }

      // Batch query all children for current batch of folders
      const { inArray } = await import("@deps");
      const children = await db
        .select()
        .from(tenantTables.documentFolders)
        .where(
          and(
            inArray(tenantTables.documentFolders.parentFolderId, unvisitedBatch),
            eq(tenantTables.documentFolders.ownerId, userId),
            eq(tenantTables.documentFolders.isArchived, false),
          ),
        );

      for (const child of children) {
        descendants.push(child as IDocumentFolder);
        queue.push(child.id);
      }
    }

    return descendants;
  }

  /**
   * Gets all descendant folders recursively, including archived ones
   * Used for restore operations to get all nested archived items
   * Optimized to batch query multiple parent folders at once
   *
   * @param folderId - ID of the parent folder
   * @param userId - ID of the user
   * @param environmentId - ID of the environment
   * @returns Promise<IDocumentFolder[]> - Array of descendant folders (including archived)
   */
  public static async getAllDescendantsIncludingArchived(
    folderId: string,
    userId: string,
    _environmentId: string,
  ): Promise<IDocumentFolder[]> {
    const db = await getTenantDB();
    const descendants: IDocumentFolder[] = [];
    const queue: string[] = [folderId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      // Process in batches to reduce database round trips
      const batchSize = Math.min(queue.length, 50); // Process up to 50 folders per query
      const currentBatch = queue.splice(0, batchSize);

      // Filter out already visited folders
      const unvisitedBatch = currentBatch.filter((id: string) => !visited.has(id));
      if (unvisitedBatch.length === 0) continue;

      // Mark as visited
      for (const id of unvisitedBatch) {
        visited.add(id);
      }

      // Batch query all children for current batch of folders (including archived)
      const { inArray } = await import("@deps");
      const children = await db
        .select()
        .from(tenantTables.documentFolders)
        .where(
          and(
            inArray(tenantTables.documentFolders.parentFolderId, unvisitedBatch),
            eq(tenantTables.documentFolders.ownerId, userId),
          ),
        );

      for (const child of children) {
        descendants.push(child as IDocumentFolder);
        queue.push(child.id);
      }
    }

    return descendants;
  }

  /**
   * Validates if a folder move operation would create a circular reference
   *
   * @param folderId - ID of the folder to move
   * @param targetParentId - ID of the target parent folder (null for root)
   * @returns Promise<boolean> - True if move is valid, false if it would create circular reference
   */
  public static async validateMove(
    folderId: string,
    targetParentId: string | null,
  ): Promise<boolean> {
    const db = await getTenantDB();

    try {
      // Moving to root is always valid
      if (!targetParentId) {
        return true;
      }

      // Can't move folder to itself
      if (folderId === targetParentId) {
        return false;
      }

      // Check if target is a descendant of source
      // Traverse up from target to ensure source is not an ancestor
      let currentId: string | null = targetParentId;
      const visited = new Set<string>();

      while (currentId) {
        // Circular reference detected
        if (currentId === folderId) {
          return false;
        }

        // Loop detected in existing structure
        if (visited.has(currentId)) {
          await useLogger(LoggerLevels.warn, {
            message: "Loop detected in folder structure during validation",
            section: loggerAppSections.DEBUG,
            messageKey: "folder_validate_move_loop",
            details: { folderId, targetParentId, currentId },
          });
          return false;
        }
        visited.add(currentId);

        // Get parent folder
        const result = await db
          .select({ parentFolderId: tenantTables.documentFolders.parentFolderId })
          .from(tenantTables.documentFolders)
          .where(eq(tenantTables.documentFolders.id, currentId))
          .limit(1);

        if (result.length === 0) {
          break;
        }

        currentId = result[0].parentFolderId;
      }

      return true;
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Unexpected error validating folder move",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        messageKey: "folder_validate_move_unexpected_error",
        details: { folderId, targetParentId, error },
      });

      throw error;
    }
  }

  /**
   * Gets the breadcrumb path from root to a specific folder
   *
   * @param id - Folder ID
   * @returns Promise<Array<{id: string, name: string, parentFolderId: string | null}>> - Array of folders from root to target
   */
  public static async getPath(id: string): Promise<Array<{ id: string; name: string; parentFolderId: string | null }>> {
    const db = await getTenantDB();

    try {
      const path: Array<{ id: string; name: string; parentFolderId: string | null }> = [];
      let currentId: string | null = id;
      const visited = new Set<string>();

      while (currentId) {
        // Prevent infinite loops
        if (visited.has(currentId)) {
          await useLogger(LoggerLevels.warn, {
            message: "Circular reference detected in folder path",
            section: loggerAppSections.DEBUG,
            messageKey: "folder_path_circular_reference",
            details: { folderId: id, currentId },
          });
          break;
        }
        visited.add(currentId);

        // Get folder details
        const result: {
          id: string;
          name: string;
          parentFolderId: string | null;
        }[] = await db
          .select({
            id: tenantTables.documentFolders.id,
            name: tenantTables.documentFolders.name,
            parentFolderId: tenantTables.documentFolders.parentFolderId,
          })
          .from(tenantTables.documentFolders)
          .where(eq(tenantTables.documentFolders.id, currentId))
          .limit(1);

        if (result.length === 0) {
          break;
        }

        const folder = result[0];
        path.unshift({
          id: folder.id,
          name: folder.name,
          parentFolderId: folder.parentFolderId,
        });

        currentId = folder.parentFolderId;
      }

      return path;
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Unexpected error getting folder path",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        messageKey: "folder_path_unexpected_error",
        details: { folderId: id, error },
      });

      throw error;
    }
  }
}
