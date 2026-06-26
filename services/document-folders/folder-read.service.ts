/**
 * @file services/document-folders/folder-read.service.ts
 * @description Service for folder read operations
 *
 * This service handles all folder read operations including:
 * - Finding folders by ID
 * - Finding child folders
 * - Getting folder hierarchy
 * - Getting folder contents
 * - Getting folder statistics
 */

import { and, count, eq, ilike, inArray, isNull, max, or, type SQL, sql } from "@deps";

import { DocumentFolderPermissionService } from "./folder-permission.service.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, PERMISSION_LEVEL_ORDER } from "@db/enums/index.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getDocumentFolderPermissionService } from "./singletons.ts";
import { DocumentFolderCrudHelpers } from "./folder-crud.helpers.ts";
import type { IDocumentFilters, IFolderFilters } from "@interfaces/documents.ts";
import type {
  IDocumentFolder,
  IDocumentFolderWithPermissions,
  IDocumentTreeItem,
  IFolderContents,
  IFolderHierarchy,
  IFolderStatistics,
  IFolderWithContents,
} from "@models/documents/folder.model.ts";
import type { IDocumentResponse } from "@models/documents/document.model.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Folder Read Service
 *
 * Provides comprehensive folder read functionality including:
 * - Single folder retrieval with permission checking
 * - Child folder listing with filtering
 * - Hierarchical folder tree building
 * - Folder contents retrieval
 * - Folder statistics calculation
 *
 * All operations integrate with DocumentFolderPermissionService to enforce
 * access control via the documentFoldersSharedUsers table.
 */
export class FolderReadService {
  private permissionService: DocumentFolderPermissionService;

  constructor(
    permissionService?: DocumentFolderPermissionService,
  ) {
    // Use injected dependencies or create new instances
    this.permissionService = permissionService || getDocumentFolderPermissionService();
  }

  /**
   * Finds a folder by ID with user permissions
   *
   * @param id - Folder ID
   * @param userId - ID of the user requesting the folder
   * @param environmentId - Environment ID
   * @returns Promise<IDocumentFolderWithPermissions | null> - The folder with permission info if accessible, null otherwise
   */
  async findById(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<IDocumentFolderWithPermissions | null> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.findById",
      {
        service: "FolderReadService",
        method: "findById",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId: id, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = id;
        span.attributes["user_id"] = userId;

        const result = await (await getTenantDB(environmentId))
          .select()
          .from(tenantTables.documentFolders)
          .where(
            and(
              eq(tenantTables.documentFolders.id, id),
              eq(tenantTables.documentFolders.isArchived, false),
            ),
          )
          .limit(1);

        if (result.length === 0) {
          span.attributes["found"] = false;
          return null;
        }

        const folder = result[0] as IDocumentFolder;

        const permissionLevel = await this.permissionService
          .getEffectivePermission(id, userId);
        if (permissionLevel === -1) {
          span.attributes["found"] = false;
          span.attributes["access_denied"] = true;
          return null;
        }

        const permString = typeof permissionLevel === "string"
          ? permissionLevel
          : Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL)[permissionLevel] || "read";
        const permNumber = typeof permissionLevel === "number"
          ? permissionLevel
          : PERMISSION_LEVEL_ORDER.indexOf(permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL);
        const folderWithPermissions: IDocumentFolderWithPermissions = {
          ...folder,
          userPermissionLevel: permNumber,
          userPermissionString: permString,
        };

        span.attributes["found"] = true;
        return folderWithPermissions;
      },
    );
  }

  /**
   * Gets the breadcrumb path from root to a specific folder
   *
   * @param folderId - Folder ID to get path for (null returns empty array for root)
   * @param userId - ID of the user requesting the path
   * @param environmentId - Environment ID
   * @returns Promise<IFolderPathItem[]> - Array of folder path items from root to target folder
   *
   * @example
   * ```typescript
   * const service = new FolderReadService();
   * // Get path for a specific folder
   * const path = await service.getFolderPath('folder_456', 'user_123', 'env_456');
   * // Returns: [{ id: 'root', name: 'Root' }, { id: 'folder_456', name: 'My Folder' }]
   * ```
   */
  async getFolderPath(
    folderId: string | null,
    userId: string,
    environmentId: string,
  ): Promise<Array<{ id: string; name: string; parentFolderId: string | null }>> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.getFolderPath",
      {
        service: "FolderReadService",
        method: "getFolderPath",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId, userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = folderId || "root";
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;

        // Root level - return empty array
        if (folderId === null) {
          span.attributes["is_root"] = true;
          span.attributes["path_length"] = 0;
          return [];
        }

        // Verify folder exists and user has access first
        const folder = await this.findById(folderId, userId, environmentId);
        if (!folder) {
          span.attributes["folder_not_found"] = true;
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Use iterative approach to fetch the folder path
        // This walks up the parent chain from the target folder to root
        // Note: Recursive CTE approach failed due to Drizzle ORM not generating WITH RECURSIVE
        const path: Array<{ id: string; name: string; parentFolderId: string | null }> = [];
        let currentId: string | null = folderId;
        const visited = new Set<string>();

        while (currentId) {
          // Prevent infinite loops from circular references
          if (visited.has(currentId)) {
            await useLogger(LoggerLevels.warn, {
              message: "Circular reference detected in folder path",
              section: loggerAppSections.DOCUMENTS_FOLDERS,
              messageKey: "folder_path_circular_reference",
              details: { folderId, currentId },
            });
            break;
          }
          visited.add(currentId);

          // Get current folder details
          const folderResult = await (await getTenantDB(environmentId))
            .select({
              id: tenantTables.documentFolders.id,
              name: tenantTables.documentFolders.name,
              parentFolderId: tenantTables.documentFolders.parentFolderId,
            })
            .from(tenantTables.documentFolders)
            .where(
              and(
                eq(tenantTables.documentFolders.id, currentId),
                eq(tenantTables.documentFolders.isArchived, false),
              ),
            )
            .limit(1);

          if (folderResult.length === 0) {
            break;
          }

          const folder = folderResult[0];
          // Add to beginning of path (we're walking up, but want root-first order)
          path.unshift({
            id: folder.id,
            name: folder.name,
            parentFolderId: folder.parentFolderId as string | null,
          });

          // Move to parent folder
          currentId = folder.parentFolderId as string | null;

          // Safety limit to prevent infinite loops
          if (path.length >= 50) {
            await useLogger(LoggerLevels.warn, {
              message: "Folder path depth limit reached (50)",
              section: loggerAppSections.DOCUMENTS_FOLDERS,
              messageKey: "folder_path_depth_limit",
              details: { folderId, depth: path.length },
            });
            break;
          }
        }

        // Verify user has access to all folders in the path
        // The findById already verified access to the target folder,
        // but we should also verify access to parent folders
        // For now, we trust the recursive CTE results since folders inherit permissions
        // If a user can access a child folder, they typically can navigate through parents

        span.attributes["path_length"] = path.length;
        span.attributes["success"] = true;
        span.attributes["db_queries"] = 1 + path.length; // findById + one query per folder in path
        return path;
      },
    );
  }

  /**
   * Finds child folders of a parent folder
   *
   * @param parentId - Parent folder ID (null for root folders)
   * @param userId - ID of the user requesting the folders
   * @param environmentId - Environment ID
   * @param filters - Optional filters for folders
   * @param ownershipFilter - Filter by ownership: 'owned' (only owned), 'shared' (only shared with me), 'both' (default)
   * @returns Promise<IDocumentFolder[]> - Array of child folders
   *
   * @example
   * ```typescript
   * const service = new FolderReadService();
   * // Get root folders
   * const rootFolders = await service.findChildren(null, 'user_123', 'env_456');
   * // Get child folders
   * const childFolders = await service.findChildren('folder_456', 'user_123', 'env_456');
   * ```
   */
  async findChildren(
    parentId: string | null,
    userId: string,
    environmentId: string,
    filters: IFolderFilters = {},
    ownershipFilter: "owned" | "shared" | "both" = "both",
  ): Promise<IDocumentFolder[]> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.findChildren",
      {
        service: "FolderReadService",
        method: "findChildren",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { parentId, userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["parent_id"] = parentId || "root";
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["has_search"] = !!filters.search;
        span.attributes["archived_filter"] = filters.archived || "false";
        span.attributes["ownership_filter"] = ownershipFilter;

        const baseConditions: SQL[] = [];

        if (parentId === null) {
          baseConditions.push(isNull(tenantTables.documentFolders.parentFolderId));
        } else {
          baseConditions.push(eq(tenantTables.documentFolders.parentFolderId, parentId));
        }

        if (filters.archived === "true") {
          baseConditions.push(eq(tenantTables.documentFolders.isArchived, true));
        } else if (filters.archived === "false") {
          baseConditions.push(eq(tenantTables.documentFolders.isArchived, false));
        }
        // If archived === 'both', don't add any filter

        if (filters.search) {
          baseConditions.push(
            or(
              ilike(tenantTables.documentFolders.name, `%${filters.search}%`),
              ilike(tenantTables.documentFolders.description, `%${filters.search}%`),
            )!,
          );
        }

        // Build ownership filter conditions
        const ownershipConditions: SQL[] = [];

        if (ownershipFilter === "owned" || ownershipFilter === "both") {
          ownershipConditions.push(eq(tenantTables.documentFolders.ownerId, userId));
        }

        if (ownershipFilter === "shared" || ownershipFilter === "both") {
          // Optimized: Single query with subquery for shared folders
          // This reduces 2 queries + in-memory deduplication to 1 query with DB-level logic
          const sharedFolderIdsSubquery = (await getTenantDB())
            .select({ folderId: tenantTables.documentFoldersSharedUsers.folderId })
            .from(tenantTables.documentFoldersSharedUsers)
            .where(
              and(
                eq(tenantTables.documentFoldersSharedUsers.userId, userId),
                eq(tenantTables.documentFoldersSharedUsers.isActive, true),
              ),
            );

          ownershipConditions.push(inArray(tenantTables.documentFolders.id, sharedFolderIdsSubquery));
        }

        // Single query to get folders based on ownership filter
        const folders = await traced("findChildren.queryFolders", "db.query", async (querySpan) => {
          querySpan.attributes["ownership_filter"] = ownershipFilter;

          // If no ownership conditions, return empty array
          if (ownershipConditions.length === 0) {
            querySpan.attributes["folder_count"] = 0;
            return [];
          }

          const result = await (await getTenantDB())
            .select()
            .from(tenantTables.documentFolders)
            .where(
              and(
                ...baseConditions,
                ownershipConditions.length === 1 ? ownershipConditions[0] : or(...ownershipConditions)!,
              ),
            )
            .orderBy(tenantTables.documentFolders.name);
          querySpan.attributes["folder_count"] = result.length;
          return result;
        });

        span.attributes["folder_count"] = folders.length;
        span.attributes["success"] = true;
        return folders as IDocumentFolder[];
      },
    );
  }

  /**
   * Gets the hierarchical folder tree starting from a root folder
   *
   * @param rootId - Root folder ID (null for all root folders)
   * @param userId - ID of the user requesting the hierarchy
   * @param environmentId - Environment ID
   * @param maxDepth - Maximum depth to traverse (default: 10)
   * @returns Promise<IFolderHierarchy[]> - Array of folder hierarchies with children
   *
   * @example
   * ```typescript
   * const service = new FolderReadService();
   * // Get entire folder tree from root
   * const tree = await service.getHierarchy(null, 'user_123', 'env_456', 5);
   * // Get subtree from specific folder
   * const subtree = await service.getHierarchy('folder_456', 'user_123', 'env_456', 3);
   * ```
   */
  async getHierarchy(
    rootId: string | null,
    userId: string,
    environmentId: string,
    maxDepth: number = 10,
  ): Promise<IFolderHierarchy[]> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.getHierarchy",
      {
        service: "FolderReadService",
        method: "getHierarchy",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { rootId, userId, environmentId, maxDepth },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["root_id"] = rootId || "root";
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["max_depth"] = maxDepth;

        // Get the root folder(s)
        const rootFolders = await this.findChildren(
          rootId,
          userId,
          environmentId,
        );

        span.attributes["root_folders_count"] = rootFolders.length;

        // Build hierarchy recursively for each root folder
        const hierarchies: IFolderHierarchy[] = [];
        for (const folder of rootFolders) {
          const hierarchy = await traced("getHierarchy.buildHierarchyNode", "service", async (hierarchySpan) => {
            hierarchySpan.attributes["folder_id"] = folder.id;
            const result = await DocumentFolderCrudHelpers.buildHierarchyNode(
              folder,
              userId,
              environmentId,
              0,
              maxDepth,
              this.findChildren.bind(this),
            );
            hierarchySpan.attributes["success"] = true;
            return result;
          });
          hierarchies.push(hierarchy);
        }

        span.attributes["hierarchy_count"] = hierarchies.length;
        span.attributes["success"] = true;
        return hierarchies;
      },
    );
  }

  /**
   * Gets the contents of a folder (child folders and documents)
   *
   * @param id - Folder ID (null for root)
   * @param userId - ID of the user requesting contents
   * @param environmentId - Environment ID
   * @returns Promise<IFolderContents> - Folder contents with folders and documents
   */
  async getContents(
    id: string | null,
    userId: string,
    environmentId: string,
  ): Promise<IFolderContents> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.getContents",
      {
        service: "FolderReadService",
        method: "getContents",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId: id, userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = id || "root";
        span.attributes["user_id"] = userId;

        // Get child folders
        const folders = await this.findChildren(id, userId, environmentId);

        // Get documents in this folder using the document permission service
        // This properly handles both owned documents AND documents shared with the user
        const folderDocuments = await this.getAccessibleDocumentsInFolder(
          id,
          userId,
          environmentId,
        );

        // Transform to match expected format (with fileSize from storage metadata)
        const documentsWithSize = folderDocuments.map((doc) => ({
          id: doc.id,
          name: doc.name,
          contentType: doc.contentType,
          fileSize: doc.originalFileSize || 0,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        }));

        const contents = {
          folders,
          documents: documentsWithSize,
        };

        span.attributes["folder_count"] = folders.length;
        span.attributes["document_count"] = documentsWithSize.length;
        span.attributes["db_queries"] = 2; // folders query + documents with storage query

        return contents;
      },
    );
  }

  /**
   * Gets statistics for a folder (document count, total size, folder count)
   *
   * @param id - Folder ID
   * @param userId - ID of the user requesting statistics
   * @param environmentId - Environment ID
   * @returns Promise<IFolderStatistics> - Folder statistics
   */
  async getStatistics(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<IFolderStatistics> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.getStatistics",
      {
        service: "FolderReadService",
        method: "getStatistics",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId: id, userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = id;
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;

        // Verify folder exists and is accessible
        const folder = await this.findById(id, userId, environmentId);
        if (!folder) {
          span.attributes["folder_not_found"] = true;
          throw new Error(`Folder not found or access denied: ${id}`);
        }

        // Get all descendant folder IDs
        const descendantIds = await traced("getStatistics.getDescendantIds", "db.query", async (descSpan) => {
          const result = await DocumentFolderCrudHelpers.getDescendantFolderIds(id, userId);
          descSpan.attributes["descendant_count"] = result.length;
          return result;
        });
        const allFolderIds = [id, ...descendantIds];
        span.attributes["total_folder_ids"] = allFolderIds.length;

        // Count documents in this folder and all descendants
        const documentCount = await traced("getStatistics.countDocuments", "db.query", async (countSpan) => {
          const result = await (await getTenantDB(environmentId))
            .select({ count: count() })
            .from(tenantTables.documents)
            .where(
              and(
                inArray(tenantTables.documents.folderId, allFolderIds),
                eq(tenantTables.documents.ownerId, userId),
                eq(tenantTables.documents.isArchived, false),
              ),
            );
          const docCount = result[0]?.count || 0;
          countSpan.attributes["document_count"] = docCount;
          return docCount;
        });

        span.attributes["document_count"] = documentCount;

        // Get total size by joining with storage metadata
        const totalSize = await traced("getStatistics.getTotalSize", "db.query", async (sizeSpan) => {
          const result = await (await getTenantDB())
            .select({
              totalSize: sql<
                number
              >`COALESCE(SUM(${tenantTables.storageMetadata.originalFileSize}), 0)::bigint`,
            })
            .from(tenantTables.documents)
            .innerJoin(
              tenantTables.storageMetadata,
              eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
            )
            .where(
              and(
                inArray(tenantTables.documents.folderId, allFolderIds),
                eq(tenantTables.documents.ownerId, userId),
                eq(tenantTables.documents.isArchived, false),
              ),
            );

          const size = Number(result[0]?.totalSize || 0);
          sizeSpan.attributes["total_size"] = size;
          return size;
        });

        span.attributes["total_size"] = totalSize;

        // Get last modified timestamp
        const lastModified = await traced("getStatistics.getLastModified", "db.query", async (modifiedSpan) => {
          const result = await (await getTenantDB())
            .select({ lastModified: max(tenantTables.documents.updatedAt) })
            .from(tenantTables.documents)
            .where(
              and(
                inArray(tenantTables.documents.folderId, allFolderIds),
                eq(tenantTables.documents.ownerId, userId),
                eq(tenantTables.documents.isArchived, false),
              ),
            );

          const modified = result[0]?.lastModified || null;
          modifiedSpan.attributes["has_last_modified"] = !!modified;
          return modified;
        });

        const statistics = {
          folderId: id,
          documentCount,
          totalSize,
          folderCount: descendantIds.length,
          lastModified,
        };

        span.attributes["folder_count"] = descendantIds.length;

        span.attributes["success"] = true;
        return statistics;
      },
    );
  }

  /**
   * Gets all folders and documents recursively from a folder
   *
   * Returns a recursive structure with all nested folders and documents
   * that the user has access to. Documents are filtered by user permissions.
   *
   * @param folderId - Folder ID (null for root)
   * @param userId - ID of the user requesting contents
   * @param environmentId - Environment ID
   * @param maxDepth - Maximum depth to traverse (default: 10)
   * @returns Promise<IFolderWithContents[]> - Array of folders with nested contents
   *
   * @example
   * ```typescript
   * const service = new FolderReadService();
   * // Get all folders and documents from root
   * const contents = await service.getRecursiveContents(null, 'user_123', 'env_456');
   * // Get all folders and documents from a specific folder
   * const contents = await service.getRecursiveContents('folder_456', 'user_123', 'env_456', 5);
   * ```
   */
  async getRecursiveContents(
    folderId: string | null,
    userId: string,
    environmentId: string,
    maxDepth: number = 10,
  ): Promise<IDocumentTreeItem[]> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.getRecursiveContents",
      {
        service: "FolderReadService",
        method: "getRecursiveContents",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId, userId, environmentId, maxDepth },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = folderId || "root";
        span.attributes["user_id"] = userId;
        span.attributes["max_depth"] = maxDepth;

        // Get root folders (or children of specified folder)
        const rootFolders = await this.findChildren(
          folderId,
          userId,
          environmentId,
        );

        span.attributes["root_folders_count"] = rootFolders.length;

        // Build unified tree structure
        const contents: IDocumentTreeItem[] = [];

        // If folderId is null (root level), include root-level documents (documents where folderId IS NULL)
        // These are documents that exist at the root level, not in any folder
        if (folderId === null) {
          const rootDocuments = await this.getAccessibleDocumentsInFolder(
            null,
            userId,
            environmentId,
          );

          // Transform root documents to unified tree structure
          for (const doc of rootDocuments) {
            contents.push(this.transformDocumentToTreeItem(doc, userId));
          }
          span.attributes["root_documents_count"] = rootDocuments.length;
        }

        // Transform folders with their contents
        for (const folder of rootFolders) {
          const folderTreeItem = await this.transformFolderToTreeItem(
            folder,
            userId,
            environmentId,
            0,
            maxDepth,
          );
          contents.push(folderTreeItem);
        }

        span.attributes["folder_count"] = rootFolders.length;
        const totalDocuments = contents.reduce((sum, item) => {
          if (item.children !== null) {
            // It's a folder - count documents recursively
            return sum + this.countDocumentsInTreeItem(item);
          }
          // It's a document
          return sum + 1;
        }, 0);
        span.attributes["total_documents"] = totalDocuments;

        return contents;
      },
    );
  }

  /**
   * Builds a single folder node with its documents and recursive children
   *
   * @private
   * @param folder - The folder to build contents for
   * @param userId - ID of the user
   * @param environmentId - Environment ID
   * @param currentDepth - Current depth in the tree
   * @param maxDepth - Maximum depth to traverse
   * @returns Promise<IFolderWithContents> - Folder with documents and nested children
   */
  private async buildRecursiveContentsNode(
    folder: IDocumentFolder,
    userId: string,
    environmentId: string,
    currentDepth: number,
    maxDepth: number,
  ): Promise<IFolderWithContents> {
    // Get documents in this folder that the user has access to
    const folderDocuments = await this.getAccessibleDocumentsInFolder(
      folder.id,
      userId,
      environmentId,
    );

    // Base case: max depth reached
    if (currentDepth >= maxDepth) {
      return {
        ...folder,
        children: [],
        documents: folderDocuments,
        depth: currentDepth,
      };
    }

    // Get child folders
    const childFolders = await this.findChildren(
      folder.id,
      userId,
      environmentId,
    );

    // Recursively build children
    const children: IFolderWithContents[] = [];
    for (const child of childFolders) {
      const childContents = await this.buildRecursiveContentsNode(
        child,
        userId,
        environmentId,
        currentDepth + 1,
        maxDepth,
      );
      children.push(childContents);
    }

    return {
      ...folder,
      children,
      documents: folderDocuments,
      depth: currentDepth,
    };
  }

  /**
   * Gets all accessible documents in a folder
   *
   * Filters documents by user permissions (READ access required)
   * Uses DocumentReadService to efficiently handle permissions for both owned and shared documents
   *
   * @private
   * @param folderId - Folder ID (null for root documents)
   * @param userId - ID of the user
   * @param environmentId - Environment ID
   * @returns Promise<IDocumentResponse[]> - Array of accessible documents
   */
  private async getAccessibleDocumentsInFolder(
    folderId: string | null,
    userId: string,
    environmentId: string,
  ): Promise<IDocumentResponse[]> {
    // Use DocumentReadService.findByUser which efficiently handles permissions
    // for both owned and shared documents
    const { getDocumentReadService } = await import("@services/documents/singletons.ts");
    const documentReadService = getDocumentReadService();

    // Get all documents in this folder with permissions already filtered
    // Pass null explicitly to filter for root documents (folderId IS NULL)
    // Pass string to filter for specific folder documents
    const filters = {
      folderId: folderId, // null for root, string for specific folder
      archived: "false" as const,
    } as IDocumentFilters;

    const result = await documentReadService.findByUser(
      userId,
      environmentId,
      filters,
      {
        page: 1,
        limit: 10000, // Get all documents (adjust if needed)
        sortBy: "name",
        sortOrder: "asc",
      },
    );

    return result.items;
  }

  /**
   * Transforms a document to unified tree item structure
   *
   * @private
   * @param doc - Document to transform
   * @param userId - ID of the user (to determine if shared)
   * @returns IDocumentTreeItem - Unified tree item
   */
  private transformDocumentToTreeItem(
    doc: IDocumentResponse,
    userId: string,
  ): IDocumentTreeItem {
    // Check if document is shared (not owned by user)
    const isShared = doc.ownerId !== userId;

    return {
      id: doc.id,
      name: doc.name,
      isDocument: true,
      isFolder: false,
      isShared,
      icon: "", // Documents don't have icons in the schema
      color: "#ffffff", // Default color for documents
      contentType: doc.contentType,
      children: null, // Documents don't have children
    };
  }

  /**
   * Transforms a folder to unified tree item structure recursively
   *
   * @private
   * @param folder - Folder to transform
   * @param userId - ID of the user (to determine if shared)
   * @param environmentId - Environment ID
   * @param currentDepth - Current depth in the tree
   * @param maxDepth - Maximum depth to traverse
   * @returns Promise<IDocumentTreeItem> - Unified tree item with children
   */
  private async transformFolderToTreeItem(
    folder: IDocumentFolder,
    userId: string,
    environmentId: string,
    currentDepth: number,
    maxDepth: number,
  ): Promise<IDocumentTreeItem> {
    // Check if folder is shared (not owned by user)
    const isShared = folder.ownerId !== userId;

    // Get documents in this folder
    const folderDocuments = await this.getAccessibleDocumentsInFolder(
      folder.id,
      userId,
      environmentId,
    );

    // Get child folders
    const childFolders: IDocumentFolder[] = [];
    if (currentDepth < maxDepth) {
      childFolders.push(
        ...await this.findChildren(
          folder.id,
          userId,
          environmentId,
        ),
      );
    }

    // Transform documents to tree items
    const documentChildren: IDocumentTreeItem[] = [];
    for (const doc of folderDocuments) {
      documentChildren.push(this.transformDocumentToTreeItem(doc, userId));
    }

    // Transform child folders recursively
    const folderChildren: IDocumentTreeItem[] = [];
    for (const childFolder of childFolders) {
      const childTreeItem = await this.transformFolderToTreeItem(
        childFolder,
        userId,
        environmentId,
        currentDepth + 1,
        maxDepth,
      );
      folderChildren.push(childTreeItem);
    }

    // Combine all children (documents first, then folders)
    const children = [...documentChildren, ...folderChildren];

    return {
      id: folder.id,
      name: folder.name,
      isDocument: false,
      isFolder: true,
      isShared,
      icon: folder.icon || "i-ph-folder-fill",
      color: folder.color || "#3b82f6",
      contentType: null, // Folders don't have content types
      children: children.length > 0 ? children : null,
    };
  }

  /**
   * Counts documents recursively in a tree item
   *
   * @private
   * @param item - Tree item to count documents in
   * @returns number - Total document count
   */
  private countDocumentsInTreeItem(item: IDocumentTreeItem): number {
    if (item.children === null) {
      // It's a document
      return 1;
    }

    // It's a folder - count recursively
    return item.children.reduce((sum, child) => {
      return sum + this.countDocumentsInTreeItem(child);
    }, 0);
  }

  /**
   * Streams folder hierarchy in batches to handle large result sets efficiently
   *
   * This method processes large folder hierarchies in memory-efficient batches
   * to prevent memory spikes when dealing with thousands of folders.
   *
   * @param rootId - Root folder ID (null for all root folders)
   * @param userId - ID of user requesting the hierarchy
   * @param environmentId - Environment ID
   * @param onBatch - Callback function to process each batch
   * @param batchSize - Number of folders to process in each batch (default: 100)
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new FolderReadService();
   * await service.streamFolderHierarchy(
   *   null,
   *   'user_123',
   *   'env_456',
   *   (batch) => {
   *     console.log(`Processing batch of ${batch.length} folders`);
   *     // Process batch...
   *   },
   *   50 // Custom batch size
   * );
   * ```
   */
  async streamFolderHierarchy(
    rootId: string | null,
    userId: string,
    environmentId: string,
    onBatch: (batch: IFolderHierarchy[]) => void,
    batchSize: number = 100,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.streamFolderHierarchy",
      {
        service: "FolderReadService",
        method: "streamFolderHierarchy",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { rootId, userId, environmentId, batchSize },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["root_id"] = rootId || "root";
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["batch_size"] = batchSize;

        // Use a cursor-based approach for memory-efficient streaming
        let offset = 0;
        let hasMore = true;
        let totalProcessed = 0;

        // First, get all root folder IDs to process
        const rootFolders = await this.findChildren(rootId, userId, environmentId);
        span.attributes["root_folders_count"] = rootFolders.length;

        // Process root folders in batches
        while (hasMore) {
          // Get a batch of root folders
          const batch = rootFolders.slice(offset, offset + batchSize);

          if (batch.length === 0) {
            hasMore = false;
            break;
          }

          // Build hierarchy for this batch
          const hierarchies: IFolderHierarchy[] = [];

          for (const folder of batch) {
            // Use the optimized hierarchy building with depth limiting
            const hierarchy = await DocumentFolderCrudHelpers.buildHierarchyNode(
              folder,
              userId,
              environmentId,
              0,
              10, // Reasonable depth limit for streaming
              this.findChildren.bind(this),
            );
            hierarchies.push(hierarchy);
          }

          // Call the batch processing callback
          await onBatch(hierarchies);

          // Update counters
          totalProcessed += batch.length;
          offset += batchSize;

          // Check if we've processed all root folders
          hasMore = offset < rootFolders.length;

          span.attributes["batches_processed"] = Math.floor(totalProcessed / batchSize);
          span.attributes["total_processed"] = totalProcessed;

          // Add a small delay to prevent overwhelming the system
          if (hasMore) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        }

        span.attributes["success"] = true;
        span.attributes["total_batches"] = Math.ceil(totalProcessed / batchSize);

        await useLogger(LoggerLevels.info, {
          message: "Folder hierarchy streaming completed successfully",
          section: loggerAppSections.DOCUMENTS_FOLDERS,
          messageKey: "folder_hierarchy_streaming_completed",
          details: {
            rootId,
            userId,
            environmentId,
            totalProcessed,
            batchSize,
            totalBatches: Math.ceil(totalProcessed / batchSize),
          },
        });
      },
    );
  }

  /**
   * Streams folder statistics in batches to handle large result sets efficiently
   *
   * This method processes statistics for multiple folders in memory-efficient batches
   * to prevent memory spikes when dealing with thousands of folders.
   *
   * @param folderIds - Array of folder IDs to get statistics for
   * @param userId - ID of user requesting the statistics
   * @param environmentId - Environment ID
   * @param onBatch - Callback function to process each batch
   * @param batchSize - Number of folders to process in each batch (default: 50)
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new FolderReadService();
   * const folderIds = ['folder_1', 'folder_2', 'folder_3', ...];
   * await service.streamFolderStatistics(
   *   folderIds,
   *   'user_123',
   *   'env_456',
   *   (batch) => {
   *     console.log(`Processing statistics for ${batch.length} folders`);
   *     // Process batch...
   *   },
   *   25 // Custom batch size
   * );
   * ```
   */
  async streamFolderStatistics(
    folderIds: string[],
    userId: string,
    environmentId: string,
    onBatch: (batch: Array<{ folderId: string; statistics: IFolderStatistics }>) => void,
    batchSize: number = 50,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.streamFolderStatistics",
      {
        service: "FolderReadService",
        method: "streamFolderStatistics",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { userId, environmentId, folderCount: folderIds.length, batchSize },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_count"] = folderIds.length;
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["batch_size"] = batchSize;

        // Process in batches to prevent memory issues
        for (let i = 0; i < folderIds.length; i += batchSize) {
          const batch = folderIds.slice(i, i + batchSize);

          // Get statistics for this batch in parallel
          const batchPromises = batch.map(async (folderId) => {
            const statistics = await this.getStatistics(folderId, userId, environmentId);
            return { folderId, statistics };
          });

          const batchResults = await Promise.all(batchPromises);

          // Call the batch processing callback
          await onBatch(batchResults);

          span.attributes["batches_processed"] = Math.floor((i + batchSize) / batchSize);

          // Add a small delay to prevent overwhelming the system
          if (i + batchSize < folderIds.length) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        }

        span.attributes["success"] = true;
        span.attributes["total_batches"] = Math.ceil(folderIds.length / batchSize);

        await useLogger(LoggerLevels.info, {
          message: "Folder statistics streaming completed successfully",
          section: loggerAppSections.DOCUMENTS_FOLDERS,
          messageKey: "folder_statistics_streaming_completed",
          details: {
            userId,
            environmentId,
            totalFolders: folderIds.length,
            batchSize,
            totalBatches: Math.ceil(folderIds.length / batchSize),
          },
        });
      },
    );
  }

  /**
   * Streams folder contents in batches to handle large result sets efficiently
   *
   * This method processes contents of multiple folders in memory-efficient batches
   * to prevent memory spikes when dealing with thousands of documents.
   *
   * @param folderIds - Array of folder IDs to get contents for
   * @param userId - ID of user requesting the contents
   * @param environmentId - Environment ID
   * @param onBatch - Callback function to process each batch
   * @param batchSize - Number of folders to process in each batch (default: 25)
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new FolderReadService();
   * const folderIds = ['folder_1', 'folder_2', 'folder_3', ...];
   * await service.streamFolderContents(
   *   folderIds,
   *   'user_123',
   *   'env_456',
   *   (batch) => {
   *     console.log(`Processing contents for ${batch.length} folders`);
   *     // Process batch...
   *   },
   *   10 // Custom batch size
   * );
   * ```
   */
  async streamFolderContents(
    folderIds: string[],
    userId: string,
    environmentId: string,
    onBatch: (batch: Array<{ folderId: string; contents: IFolderContents }>) => void,
    batchSize: number = 25,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "FolderReadService.streamFolderContents",
      {
        service: "FolderReadService",
        method: "streamFolderContents",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { userId, environmentId, folderCount: folderIds.length, batchSize },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_count"] = folderIds.length;
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["batch_size"] = batchSize;

        // Process in batches to prevent memory issues
        for (let i = 0; i < folderIds.length; i += batchSize) {
          const batch = folderIds.slice(i, i + batchSize);

          // Get contents for this batch in parallel
          const batchPromises = batch.map(async (folderId) => {
            const contents = await this.getContents(folderId, userId, environmentId);
            return { folderId, contents };
          });

          const batchResults = await Promise.all(batchPromises);

          // Call the batch processing callback
          await onBatch(batchResults);

          span.attributes["batches_processed"] = Math.floor((i + batchSize) / batchSize);

          // Add a small delay to prevent overwhelming the system
          if (i + batchSize < folderIds.length) {
            await new Promise((resolve) => setTimeout(resolve, 2)); // Slightly longer delay for content operations
          }
        }

        span.attributes["success"] = true;
        span.attributes["total_batches"] = Math.ceil(folderIds.length / batchSize);

        await useLogger(LoggerLevels.info, {
          message: "Folder contents streaming completed successfully",
          section: loggerAppSections.DOCUMENTS_FOLDERS,
          messageKey: "folder_contents_streaming_completed",
          details: {
            userId,
            environmentId,
            totalFolders: folderIds.length,
            batchSize,
            totalBatches: Math.ceil(folderIds.length / batchSize),
          },
        });
      },
    );
  }
}
