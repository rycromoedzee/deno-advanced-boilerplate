/**
 * @file services/document-folders/folder-delete.service.ts
 * @description Service for folder deletion operations (single & bulk)
 *
 * This service handles folder deletion with:
 * - Permission checking
 * - Cascade deletion of descendant folders and documents
 * - Storage cleanup
 * - Database transaction handling
 * - Cache invalidation
 *
 * Consolidates single and bulk delete operations to eliminate duplication.
 */

import { and, eq, inArray } from "@deps";

import { DocumentFolderPermissionService } from "./folder-permission.service.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getStorage } from "@services/storage/index.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { getDocumentFolderPermissionService } from "./singletons.ts";
import { DocumentFolderCrudHelpers } from "./folder-crud.helpers.ts";
import { BULK_OPERATION_CONSTRAINTS } from "@constants/documents/bulk-operations.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { buildBackupTombstoneRows } from "@services/object-backup/tombstone.ts";

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
 * Folder Delete Service
 *
 * Provides folder deletion functionality for both single and bulk operations:
 * - Single folder deletion with cascade support
 * - Bulk folder deletion with transaction support
 * - Storage cleanup for all nested documents
 * - Database record cleanup
 * - Cache invalidation
 *
 * All operations enforce permission checking and use database transactions
 * to ensure atomicity and data consistency.
 */
export class FolderDeleteService {
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
      throwHttpError("DOCUMENT_FOLDER.BULK_DELETE_BAD_REQUEST");
    }

    if (
      folderIds.length > BULK_OPERATION_CONSTRAINTS.MAX_FOLDERS
    ) {
      throwHttpError("DOCUMENT_FOLDER.BULK_DELETE_BAD_REQUEST");
    }

    const uniqueIds = new Set(folderIds);
    if (uniqueIds.size !== folderIds.length) {
      throwHttpError("DOCUMENT_FOLDER.BULK_DELETE_BAD_REQUEST");
    }
  }

  /**
   * Checks permissions for multiple folders
   *
   * @param folderIds - Array of folder IDs
   * @param userId - ID of the user performing the operation
   * @param environmentId - Environment ID
   * @returns Promise<Map<string, {hasAccess: boolean, isOwner: boolean}>> - Map of folder ID to permission status
   *
   * @private
   */
  private async checkBulkPermissions(
    folderIds: string[],
    userId: string,
    environmentId: string,
  ): Promise<Map<string, { hasAccess: boolean; isOwner: boolean }>> {
    const permissionMap = new Map<string, { hasAccess: boolean; isOwner: boolean }>();

    // Batch fetch folder ownership info
    const folderResults = await (await getTenantDB(environmentId))
      .select({
        id: tenantTables.documentFolders.id,
        ownerId: tenantTables.documentFolders.ownerId,
      })
      .from(tenantTables.documentFolders)
      .where(
        and(
          inArray(tenantTables.documentFolders.id, folderIds),
        ),
      );

    const folderMap = new Map(folderResults.map((f) => [f.id, f]));

    // Check permissions for each folder
    await Promise.all(
      folderIds.map(async (folderId) => {
        try {
          const folder = folderMap.get(folderId);
          if (!folder) {
            permissionMap.set(folderId, { hasAccess: false, isOwner: false });
            return;
          }

          const isOwner = folder.ownerId === userId;
          let hasAccess = false;

          if (isOwner) {
            hasAccess = true;
          } else {
            const permissionLevel = await this.permissionService
              .getEffectivePermission(folderId, userId);
            hasAccess = permissionLevel !== -1 &&
              permissionLevelMeets(permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN);
          }

          permissionMap.set(folderId, { hasAccess, isOwner });
        } catch (error) {
          await useLogger(LoggerLevels.warn, {
            message: "Error checking permission for folder in bulk operation",
            section: loggerAppSections.DEBUG,
            messageKey: "bulk_permission_check_error",
            details: { folderId, userId, error },
          });
          permissionMap.set(folderId, { hasAccess: false, isOwner: false });
        }
      }),
    );

    return permissionMap;
  }

  /**
   * Deletes a single folder and all its descendants
   *
   * @param id - Folder ID
   * @param userId - ID of the user deleting the folder
   * @param environmentId - ID of the environment
   * @returns Promise<void>
   *
   * @private
   */
  private async deleteSingleFolder(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<void> {
    // Check if folder exists
    const folderResult = await (await getTenantDB(environmentId))
      .select({
        id: tenantTables.documentFolders.id,
        ownerId: tenantTables.documentFolders.ownerId,
      })
      .from(tenantTables.documentFolders)
      .where(
        and(
          eq(tenantTables.documentFolders.id, id),
        ),
      )
      .limit(1);

    if (folderResult.length === 0) {
      throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
    }

    const folder = folderResult[0];
    const isOwner = folder.ownerId === userId;

    if (!isOwner) {
      const permissionLevel = await this.permissionService
        .getEffectivePermission(id, userId);
      if (
        permissionLevel === -1 ||
        !permissionLevelMeets(permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)
      ) {
        throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
      }
    }

    // Get all descendant folder IDs
    const descendantIds = await DocumentFolderCrudHelpers.getDescendantFolderIds(
      id,
      folder.ownerId,
    );
    const allFolderIds = [id, ...descendantIds];

    // Get all documents in these folders
    const documentsWithStorage = await (await getTenantDB(environmentId))
      .select({
        documentId: tenantTables.documents.id,
        storageId: tenantTables.documents.storageMetadataId,
        folderPath: tenantTables.storageMetadata.folderPath,
        thumbnailPath: tenantTables.storageMetadata.thumbnailPath,
      })
      .from(tenantTables.documents)
      .innerJoin(
        tenantTables.storageMetadata,
        eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
      )
      .where(inArray(tenantTables.documents.folderId, allFolderIds));

    // Delete physical files from storage (main object + thumbnail — the latter
    // fixes a pre-existing orphan-thumbnail bug where folder delete only
    // removed the main file).
    const storage = getStorage();
    for (const doc of documentsWithStorage) {
      try {
        await storage.deleteFile(doc.folderPath);
        if (doc.thumbnailPath) {
          await storage.deleteFile(doc.thumbnailPath);
        }
      } catch (storageError) {
        await useLogger(LoggerLevels.warn, {
          message: "Failed to delete physical file from storage, continuing with database cleanup",
          section: loggerAppSections.DOCUMENTS_FOLDERS,
          messageKey: "folder_storage_delete_failed",
          details: {
            folderId: id,
            documentId: doc.documentId,
            filePath: doc.folderPath,
            error: storageError,
          },
        });
      }
    }

    // Delete database records in transaction
    // IMPORTANT: Delete order matters due to foreign key constraints:
    // 1. documentsDataKeys (references documents)
    // 2. documents (references storage_metadata)
    // 3. storageMetadata (can now be safely deleted)
    // 4. documentFoldersSharedUsers (references document_folders)
    // 5. documentFolders (can now be safely deleted)
    await (await getTenantDB()).transaction(async (tx) => {
      // Enqueue backup-purge tombstones (DD4) for every document's main +
      // thumbnail key, in the same tx as the row deletes (transactional outbox).
      if (documentsWithStorage.length > 0) {
        const tombstoneKeys: string[] = [];
        for (const d of documentsWithStorage) {
          tombstoneKeys.push(d.folderPath);
          if (d.thumbnailPath) tombstoneKeys.push(d.thumbnailPath);
        }
        await tx
          .insert(tenantTables.backupDeletionQueue)
          .values(buildBackupTombstoneRows(tombstoneKeys, Math.floor(Date.now() / 1000)));
      }

      if (documentsWithStorage.length > 0) {
        const documentIds = documentsWithStorage.map((d: { documentId: string }) => d.documentId);
        await tx
          .delete(tenantTables.documentsDataKeys)
          .where(inArray(tenantTables.documentsDataKeys.documentId, documentIds));
      }

      // Delete documents BEFORE storageMetadata to avoid FK constraint violation
      await tx
        .delete(tenantTables.documents)
        .where(inArray(tenantTables.documents.folderId, allFolderIds));

      if (documentsWithStorage.length > 0) {
        const storageIds = documentsWithStorage.map((d: { storageId: string }) => d.storageId);
        await tx
          .delete(tenantTables.storageMetadata)
          .where(inArray(tenantTables.storageMetadata.id, storageIds));
      }

      await tx
        .delete(tenantTables.documentFoldersSharedUsers)
        .where(inArray(tenantTables.documentFoldersSharedUsers.folderId, allFolderIds));

      await tx
        .delete(tenantTables.documentFolders)
        .where(
          and(
            inArray(tenantTables.documentFolders.id, allFolderIds),
          ),
        );
    });
  }

  /**
   * Hard deletes a folder permanently, removing all data and files
   * Only the folder owner or users with Admin rights on shared folders can perform this operation
   *
   * SECURITY IMPLEMENTATION:
   * - 404 error if folder not found OR user has no permission to view/access
   * - 401 error if user has access but lacks delete permission
   * - Timing attack protection for all permission checks
   * - Cascades to all descendant folders and documents
   *
   * @param id - Folder ID
   * @param userId - ID of the user deleting the folder
   * @param environmentId - ID of the environment
   * @returns Promise<void>
   */
  async hardDelete(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<void> {
    const startTime = performance.now();

    return await tracedWithServiceErrorHandling(
      "FolderDeleteService.hardDelete",
      {
        service: "FolderDeleteService",
        method: "hardDelete",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId: id, userId, environmentId },
      },
      "DOCUMENT_FOLDER.DELETE_FAILED",
      async (span) => {
        span.attributes["folder_id"] = id;
        span.attributes["user_id"] = userId;

        // Use bulk delete with single ID
        const result = await this.bulkHardDelete([id], userId, environmentId);

        if (result.failedCount > 0) {
          const error = result.errors[0];
          if (error.error.includes("Access denied") || error.error.includes("insufficient permissions")) {
            await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.STANDARD);
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.STANDARD);
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.STANDARD);

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Performs bulk hard delete operation - permanently removes folders from database and storage
   * Only the folder owner or users with Admin rights on shared folders can perform this operation
   *
   * SECURITY IMPLEMENTATION:
   * - Validates bulk operation limits
   * - Checks admin-level permissions for each folder
   * - Removes physical files from storage for all nested documents
   * - Deletes all related database records in transactions
   *
   * @param folderIds - Array of folder IDs to delete
   * @param userId - ID of the user performing the deletion
   * @param environmentId - ID of the environment
   * @returns Promise<IBulkOperationResult> - Result of the bulk operation with success/failure details
   */
  async bulkHardDelete(
    folderIds: string[],
    userId: string,
    environmentId: string,
  ): Promise<IBulkOperationResult> {
    return await tracedWithServiceErrorHandling(
      "FolderDeleteService.bulkHardDelete",
      {
        service: "FolderDeleteService",
        method: "bulkHardDelete",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { userId, environmentId, folderCount: folderIds.length },
      },
      "DOCUMENT_FOLDER.BULK_DELETE_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["folder_count"] = folderIds.length;

        this.validateBulkOperationLimits(folderIds);
        span.attributes["validation_passed"] = true;

        const permissionMap = await this.checkBulkPermissions(
          folderIds,
          userId,
          environmentId,
        );

        const allowedIds: string[] = [];
        const errors: Array<{ folderId: string; error: string }> = [];

        for (const [folderId, { hasAccess }] of permissionMap.entries()) {
          if (hasAccess) {
            allowedIds.push(folderId);
          } else {
            errors.push({
              folderId,
              error: "Access denied: insufficient permissions to delete folder",
            });
          }
        }

        span.attributes["allowed_count"] = allowedIds.length;
        span.attributes["denied_count"] = errors.length;

        let processedCount = 0;

        // Process each folder deletion
        for (const folderId of allowedIds) {
          try {
            await this.deleteSingleFolder(folderId, userId, environmentId);
            processedCount++;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Log the error for debugging/monitoring
            await useLogger(LoggerLevels.error, {
              message: "Failed to delete folder in bulk operation",
              section: loggerAppSections.DOCUMENTS_FOLDERS,
              messageKey: "bulk_folder_delete_failed",
              details: { folderId, userId, environmentId, error: errorMessage },
            });

            // Record error in span for tracing
            span.attributes[`error.folder_${folderId}`] = errorMessage;

            errors.push({
              folderId,
              error: errorMessage,
            });
          }
        }

        span.attributes["processed_count"] = processedCount;
        span.attributes["success"] = errors.length === 0;
        span.attributes["error_count"] = errors.length;

        return {
          success: errors.length === 0,
          failedCount: errors.length,
          errors,
        };
      },
    );
  }
}
