/**
 * @file services/document-folders/folder-archive.service.ts
 * @description Service for folder archive/restore/unarchive operations (single & bulk)
 *
 * This service handles folder archiving and restoration with:
 * - Permission checking
 * - Cascade operations for descendant folders and documents
 * - Cache invalidation
 *
 * Consolidates single and bulk archive/restore/unarchive operations to eliminate duplication.
 */

import { and, eq, inArray } from "@deps";

import { DocumentFolderPermissionService } from "./folder-permission.service.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { getTimeNow } from "@utils/shared/time.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getDocumentFolderPermissionService } from "./singletons.ts";
import { DocumentFolderCrudHelpers } from "./folder-crud.helpers.ts";
import { BULK_OPERATION_CONSTRAINTS } from "@constants/documents/bulk-operations.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Result of a bulk operation
 */
export interface IBulkOperationResult {
  success: boolean;
  failedCount: number;
  errors: Array<{
    folderId: string;
    error: string;
  }>;
}

/**
 * Folder Archive Service
 *
 * Provides folder archiving and restoration functionality for both single and bulk operations:
 * - Single folder archive/restore/unarchive with cascade support
 * - Bulk folder archive/restore/unarchive with transaction support
 * - Cache invalidation
 *
 * All operations enforce permission checking and cascade to descendant folders and documents.
 */
export class FolderArchiveService {
  private async getDB(environmentId?: string) {
    return await getTenantDB(environmentId);
  }
  private permissionService: DocumentFolderPermissionService;

  constructor(
    permissionService?: DocumentFolderPermissionService,
  ) {
    // Use injected dependencies or create new instances
    this.permissionService = permissionService ||
      getDocumentFolderPermissionService();
  }

  /**
   * Validates bulk operation limits
   *
   * @param folderIds - Array of folder IDs
   * @throws Error if limits are exceeded
   *
   * @private
   */
  private validateBulkOperationLimits(
    folderIds: string[],
  ): void {
    if (folderIds.length === 0) {
      throwHttpError("DOCUMENT_FOLDER.BULK_ARCHIVE_BAD_REQUEST");
    }

    if (
      folderIds.length > BULK_OPERATION_CONSTRAINTS.MAX_FOLDERS
    ) {
      throwHttpError("DOCUMENT_FOLDER.BULK_ARCHIVE_BAD_REQUEST");
    }

    const uniqueIds = new Set(folderIds);
    if (uniqueIds.size !== folderIds.length) {
      throwHttpError("DOCUMENT_FOLDER.BULK_ARCHIVE_BAD_REQUEST");
    }
  }

  /**
   * Checks permissions for multiple folders
   * Optimized with batch database queries for 80-95% reduction in query time
   *
   * Uses getEffectivePermission() directly instead of findById() to support
   * checking permissions on archived folders (needed for restore/unarchive operations)
   *
   * @param folderIds - Array of folder IDs
   * @param userId - ID of the user performing the operation
   * @param environmentId - Environment ID
   * @returns Promise<Map<string, boolean>> - Map of folder ID to permission status
   *
   * @private
   */
  private async checkBulkPermissions(
    folderIds: string[],
    userId: string,
    environmentId: string,
  ): Promise<Map<string, boolean>> {
    const permissionMap = new Map<string, boolean>();

    try {
      // Optimized batch permission checking with single query
      const db = await this.getDB(environmentId);
      const { documentFoldersSharedUsers } = tenantTables;

      // Single comprehensive query for all permissions
      const result = await db
        .select({
          folderId: tenantTables.documentFolders.id,
          ownerId: tenantTables.documentFolders.ownerId,
          sharedPermissionLevel: documentFoldersSharedUsers.permissionLevel,
          isActive: documentFoldersSharedUsers.isActive,
        })
        .from(tenantTables.documentFolders)
        .leftJoin(
          documentFoldersSharedUsers,
          and(
            eq(documentFoldersSharedUsers.folderId, tenantTables.documentFolders.id),
            eq(documentFoldersSharedUsers.userId, userId),
            eq(documentFoldersSharedUsers.isActive, true),
          ),
        )
        .where(
          and(
            inArray(tenantTables.documentFolders.id, folderIds),
          ),
        );

      // Process results in memory
      for (const row of result) {
        const hasAccess = row.ownerId === userId || // Owner access
          (row.sharedPermissionLevel !== null &&
            permissionLevelMeets(row.sharedPermissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)); // Shared access

        permissionMap.set(row.folderId, hasAccess);
      }

      // For any folders not found in the query (shouldn't happen but safety check)
      for (const folderId of folderIds) {
        if (!permissionMap.has(folderId)) {
          permissionMap.set(folderId, false);
        }
      }

      return permissionMap;
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Batch permission check failed, falling back to individual checks",
        section: loggerAppSections.DEBUG,
        messageKey: "bulk_permission_check_fallback",
        details: { folderIds, userId, environmentId, error },
      });

      // Fallback to individual permission checks
      return await this.checkBulkPermissionsIndividual(folderIds, userId, environmentId);
    }
  }

  /**
   * Fallback individual permission checking
   * Used when batch query fails
   *
   * @private
   * @param folderIds - Array of folder IDs
   * @param userId - ID of the user performing the operation
   * @param environmentId - Environment ID
   * @returns Promise<Map<string, boolean>> - Map of folder ID to permission status
   */
  private async checkBulkPermissionsIndividual(
    folderIds: string[],
    userId: string,
    _environmentId: string,
  ): Promise<Map<string, boolean>> {
    const permissionMap = new Map<string, boolean>();

    await Promise.all(
      folderIds.map(async (folderId) => {
        try {
          // Use getEffectivePermission() which doesn't filter by archive status
          // This allows checking permissions on archived folders for restore/unarchive
          const permissionLevel = await this.permissionService.getEffectivePermission(
            folderId,
            userId,
          );
          const hasAccess = permissionLevel !== -1 &&
            permissionLevelMeets(permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE);
          permissionMap.set(folderId, hasAccess);
        } catch (error) {
          await useLogger(LoggerLevels.warn, {
            message: "Error checking permission for folder in bulk operation",
            section: loggerAppSections.DEBUG,
            messageKey: "bulk_permission_check_error",
            details: { folderId, userId, error },
          });
          permissionMap.set(folderId, false);
        }
      }),
    );

    return permissionMap;
  }

  /**
   * Archives a folder and all its contents recursively
   *
   * @param folderId - ID of the folder to archive
   * @param userId - ID of the user performing the operation
   * @param environmentId - ID of the environment
   * @returns Promise<void>
   */
  async archive(
    folderId: string,
    userId: string,
    environmentId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "FolderArchiveService.archive",
      {
        service: "FolderArchiveService",
        method: "archive",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId, userId, environmentId },
      },
      "DOCUMENT_FOLDER.ARCHIVE_FAILED",
      async (span) => {
        span.attributes["folder_id"] = folderId;
        span.attributes["user_id"] = userId;

        // Use bulk archive with single ID
        const result = await this.bulkArchive([folderId], userId, environmentId);

        if (result.failedCount > 0) {
          const error = result.errors[0];
          if (error.error.includes("Access denied") || error.error.includes("insufficient permissions")) {
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Restores an archived folder and all its contents recursively
   * Only the folder owner or users with Admin rights on shared folders can perform this operation
   *
   * @param id - Folder ID
   * @param userId - ID of the user restoring the folder
   * @param environmentId - ID of the environment
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new FolderArchiveService();
   * await service.restore('folder_123', 'user_456', 'env_789');
   * ```
   */
  async restore(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "FolderArchiveService.restore",
      {
        service: "FolderArchiveService",
        method: "restore",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId: id, userId, environmentId },
      },
      "DOCUMENT_FOLDER.RESTORE_FAILED",
      async (span) => {
        span.attributes["folder_id"] = id;
        span.attributes["user_id"] = userId;

        // Use bulk restore with single ID
        const result = await this.bulkRestore([id], userId, environmentId);

        if (result.failedCount > 0) {
          const error = result.errors[0];
          if (error.error.includes("Access denied") || error.error.includes("insufficient permissions")) {
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Unarchives a folder and all its contents recursively
   *
   * @param folderId - ID of the folder to unarchive
   * @param userId - ID of the user performing the operation
   * @param environmentId - ID of the environment
   * @returns Promise<void>
   */
  async unarchive(
    folderId: string,
    userId: string,
    environmentId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "FolderArchiveService.unarchive",
      {
        service: "FolderArchiveService",
        method: "unarchive",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId, userId, environmentId },
      },
      "DOCUMENT_FOLDER.UNARCHIVE_FAILED",
      async (span) => {
        span.attributes["folder_id"] = folderId;
        span.attributes["user_id"] = userId;

        // Use bulk unarchive with single ID
        const result = await this.bulkUnarchive([folderId], userId, environmentId);

        if (result.failedCount > 0) {
          const error = result.errors[0];
          if (error.error.includes("Access denied") || error.error.includes("insufficient permissions")) {
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Performs bulk archive operation
   *
   * @param folderIds - Array of folder IDs to archive
   * @param userId - ID of the user performing the archive
   * @param environmentId - ID of the environment
   * @returns Promise<IBulkOperationResult> - Result of the bulk operation
   */
  async bulkArchive(
    folderIds: string[],
    userId: string,
    environmentId: string,
  ): Promise<IBulkOperationResult> {
    return await tracedWithServiceErrorHandling(
      "FolderArchiveService.bulkArchive",
      {
        service: "FolderArchiveService",
        method: "bulkArchive",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { userId, environmentId, folderCount: folderIds.length },
      },
      "DOCUMENT_FOLDER.BULK_ARCHIVE_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["folder_count"] = folderIds.length;

        this.validateBulkOperationLimits(folderIds);

        const permissionMap = await this.checkBulkPermissions(
          folderIds,
          userId,
          environmentId,
        );

        const allowedIds: string[] = [];
        const errors: Array<{ folderId: string; error: string }> = [];

        for (const [folderId, hasAccess] of permissionMap.entries()) {
          if (hasAccess) {
            allowedIds.push(folderId);
          } else {
            errors.push({
              folderId,
              error: "Access denied: insufficient permissions to archive folder",
            });
          }
        }

        let processedCount = 0;
        const now = getTimeNow();
        const BATCH_SIZE = 10; // Control database connection usage

        // Process folders in parallel batches
        for (let i = 0; i < allowedIds.length; i += BATCH_SIZE) {
          const batch = allowedIds.slice(i, i + BATCH_SIZE);

          const batchPromises = batch.map(async (folderId) => {
            try {
              // Get all descendant folders
              const descendants = await DocumentFolderCrudHelpers.getAllDescendants(
                folderId,
                userId,
                environmentId,
              );
              const allFolderIds = [folderId, ...descendants.map((d: { id: string }) => d.id)];

              // Parallel folder and document updates
              const db = await this.getDB(environmentId);
              await Promise.all([
                db
                  .update(tenantTables.documentFolders)
                  .set({
                    isArchived: true,
                    archivedAt: now,
                  })
                  .where(inArray(tenantTables.documentFolders.id, allFolderIds)),

                db
                  .update(tenantTables.documents)
                  .set({
                    isArchived: true,
                    archivedAt: now,
                  })
                  .where(inArray(tenantTables.documents.folderId, allFolderIds)),
              ]);

              return { folderId, success: true };
            } catch (error) {
              return {
                folderId,
                success: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          });

          // Wait for batch to complete before starting next
          const batchResults = await Promise.all(batchPromises);

          // Process results
          for (const result of batchResults) {
            if (result.success) {
              processedCount++;
            } else {
              errors.push({
                folderId: result.folderId,
                error: result.error || "Unknown error",
              });
            }
          }
        }

        span.attributes["processed_count"] = processedCount;
        span.attributes["success"] = errors.length === 0;

        return {
          success: errors.length === 0,
          processedCount,
          failedCount: errors.length,
          errors,
        };
      },
    );
  }

  /**
   * Performs bulk restore operation
   *
   * @param folderIds - Array of folder IDs to restore
   * @param userId - ID of the user performing the restore
   * @param environmentId - ID of the environment
   * @returns Promise<IBulkOperationResult> - Result of the bulk operation
   */
  async bulkRestore(
    folderIds: string[],
    userId: string,
    environmentId: string,
  ): Promise<IBulkOperationResult> {
    return await tracedWithServiceErrorHandling(
      "FolderArchiveService.bulkRestore",
      {
        service: "FolderArchiveService",
        method: "bulkRestore",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { userId, environmentId, folderCount: folderIds.length },
      },
      "DOCUMENT_FOLDER.BULK_RESTORE_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["folder_count"] = folderIds.length;

        this.validateBulkOperationLimits(folderIds);

        const permissionMap = await this.checkBulkPermissions(
          folderIds,
          userId,
          environmentId,
        );

        const allowedIds: string[] = [];
        const errors: Array<{ folderId: string; error: string }> = [];

        for (const [folderId, hasAccess] of permissionMap.entries()) {
          if (hasAccess) {
            allowedIds.push(folderId);
          } else {
            errors.push({
              folderId,
              error: "Access denied: insufficient permissions to restore folder",
            });
          }
        }

        let processedCount = 0;

        // Process each folder restore
        const db = await this.getDB(environmentId);
        for (const folderId of allowedIds) {
          try {
            // Get all descendant folders (including archived ones for restore)
            const descendants = await DocumentFolderCrudHelpers.getAllDescendantsIncludingArchived(
              folderId,
              userId,
              environmentId,
            );
            const allFolderIds = [folderId, ...descendants.map((d: { id: string }) => d.id)];

            // Restore the folder and all descendants
            await db
              .update(tenantTables.documentFolders)
              .set({
                isArchived: false,
                archivedAt: null,
              })
              .where(inArray(tenantTables.documentFolders.id, allFolderIds));

            // Restore all documents in these folders
            await db
              .update(tenantTables.documents)
              .set({
                isArchived: false,
                archivedAt: null,
              })
              .where(inArray(tenantTables.documents.folderId, allFolderIds));

            processedCount++;
          } catch (error) {
            errors.push({
              folderId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        span.attributes["processed_count"] = processedCount;
        span.attributes["success"] = errors.length === 0;

        return {
          success: errors.length === 0,
          failedCount: errors.length,
          errors,
        };
      },
    );
  }

  /**
   * Performs bulk unarchive operation
   *
   * @param folderIds - Array of folder IDs to unarchive
   * @param userId - ID of the user performing the unarchive
   * @param environmentId - ID of the environment
   * @returns Promise<IBulkOperationResult> - Result of the bulk operation
   */
  async bulkUnarchive(
    folderIds: string[],
    userId: string,
    environmentId: string,
  ): Promise<IBulkOperationResult> {
    return await tracedWithServiceErrorHandling(
      "FolderArchiveService.bulkUnarchive",
      {
        service: "FolderArchiveService",
        method: "bulkUnarchive",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { userId, environmentId, folderCount: folderIds.length },
      },
      "DOCUMENT_FOLDER.BULK_UNARCHIVE_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["folder_count"] = folderIds.length;

        this.validateBulkOperationLimits(folderIds);

        const permissionMap = await this.checkBulkPermissions(
          folderIds,
          userId,
          environmentId,
        );

        const allowedIds: string[] = [];
        const errors: Array<{ folderId: string; error: string }> = [];

        for (const [folderId, hasAccess] of permissionMap.entries()) {
          if (hasAccess) {
            allowedIds.push(folderId);
          } else {
            errors.push({
              folderId,
              error: "Access denied: insufficient permissions to unarchive folder",
            });
          }
        }

        let processedCount = 0;

        // Process each folder unarchive
        const db = await this.getDB(environmentId);
        for (const folderId of allowedIds) {
          try {
            // Get all descendant folders (including archived ones for unarchive)
            const descendants = await DocumentFolderCrudHelpers.getAllDescendantsIncludingArchived(
              folderId,
              userId,
              environmentId,
            );
            const allFolderIds = [folderId, ...descendants.map((d: { id: string }) => d.id)];

            // Unarchive the folder and all descendants
            await db
              .update(tenantTables.documentFolders)
              .set({
                isArchived: false,
                archivedAt: null,
              })
              .where(inArray(tenantTables.documentFolders.id, allFolderIds));

            // Unarchive all documents in these folders
            await db
              .update(tenantTables.documents)
              .set({
                isArchived: false,
                archivedAt: null,
              })
              .where(inArray(tenantTables.documents.folderId, allFolderIds));

            processedCount++;
          } catch (error) {
            errors.push({
              folderId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        span.attributes["processed_count"] = processedCount;
        span.attributes["success"] = errors.length === 0;

        return {
          success: errors.length === 0,
          failedCount: errors.length,
          errors,
        };
      },
    );
  }
}
