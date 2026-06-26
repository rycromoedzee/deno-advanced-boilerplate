/**
 * @file services/documents/document-delete.service.ts
 * @description Service for document deletion operations (single & bulk)
 *
 * This service handles document deletion with:
 * - Permission checking
 * - Storage cleanup
 * - Database transaction handling
 * - Cache invalidation
 *
 * Consolidates single and bulk delete operations to eliminate duplication.
 */

import { and, eq, inArray, sql } from "@deps";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import { DocumentStatsService } from "@services/documents-stats/document-stats.service.ts";
import { DocumentAccessLogService } from "@services/documents-stats/unified-access-log.service.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getStorage } from "@services/storage/index.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { fireAndForgetOperation } from "@utils/shared/index.ts";
import { getDocumentPermissionService } from "@services/documents-permission/singletons.ts";
import { getDocumentAccessLogService, getDocumentStatsService } from "@services/documents-stats/singletons.ts";
import { BULK_OPERATION_CONSTRAINTS } from "@constants/documents/bulk-operations.ts";
import { buildBackupTombstoneRows } from "@services/object-backup/tombstone.ts";

/**
 * Result of a bulk operation
 */
export interface IBulkOperationResult {
  success: boolean;
  failedCount: number;
  errors: Array<{
    documentId: string;
    error: string;
  }>;
}

/**
 * Document Delete Service
 *
 * Provides document deletion functionality for both single and bulk operations:
 * - Single document deletion with permission checking
 * - Bulk document deletion with transaction support
 * - Storage cleanup
 * - Database record cleanup
 * - Cache invalidation
 *
 * All operations enforce permission checking and use database transactions
 * to ensure atomicity and data consistency.
 */
export class DocumentDeleteService {
  private permissionService: DocumentPermissionService;
  private accessLogService: DocumentAccessLogService;
  private statsService: DocumentStatsService;

  constructor(
    permissionService?: DocumentPermissionService,
    accessLogService?: DocumentAccessLogService,
    statsService?: DocumentStatsService,
  ) {
    // Use injected dependencies or create new instances
    this.permissionService = permissionService ||
      getDocumentPermissionService();
    this.accessLogService = accessLogService || getDocumentAccessLogService();
    this.statsService = statsService || getDocumentStatsService();
  }

  /**
   * Validates bulk operation limits
   *
   * @param documentIds - Array of document IDs
   * @throws Error if limits are exceeded
   *
   * @private
   */
  private validateBulkOperationLimits(
    documentIds: string[],
  ): void {
    if (documentIds.length === 0) {
      throwHttpError("DOCUMENT.BULK_OPERATION_BAD_REQUEST");
    }

    if (
      documentIds.length > BULK_OPERATION_CONSTRAINTS.MAX_DOCUMENTS
    ) {
      throwHttpError("DOCUMENT.BULK_OPERATION_BAD_REQUEST");
    }

    const uniqueIds = new Set(documentIds);
    if (uniqueIds.size !== documentIds.length) {
      throwHttpError("DOCUMENT.BULK_OPERATION_BAD_REQUEST");
    }
  }

  /**
   * Checks permissions for multiple documents using batch operation
   *
   * @param documentIds - Array of document IDs
   * @param userId - ID of the user performing the operation
   * @param requiredPermission - Required permission level
   * @returns Promise<Map<string, boolean>> - Map of document ID to permission status
   *
   * @private
   */
  private async checkBulkPermissions(
    documentIds: string[],
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<Map<string, boolean>> {
    try {
      // Use batch check for efficiency (single DB query for uncached resources)
      return await this.permissionService.batchCheckAccess(
        documentIds,
        userId,
        requiredPermission,
      );
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Error in batch permission check for bulk operation",
        section: loggerAppSections.DEBUG,
        messageKey: "bulk_permission_check_error",
        details: { documentCount: documentIds.length, userId, error },
      });
      // Return all false on error
      const permissionMap = new Map<string, boolean>();
      documentIds.forEach((id) => permissionMap.set(id, false));
      return permissionMap;
    }
  }

  /**
   * Fetches documents with their storage metadata
   *
   * @param documentIds - Array of document IDs
   * @param environmentId - Environment ID
   * @returns Promise with documents and storage metadata
   *
   * @private
   */
  private async fetchDocumentsWithStorage(
    documentIds: string[],
    environmentId: string,
  ) {
    return await traced("fetchDocumentsWithStorage", "db.query", async (dbSpan) => {
      const result = await (await getTenantDB(environmentId))
        .select({
          document: tenantTables.documents,
          storage: tenantTables.storageMetadata,
        })
        .from(tenantTables.documents)
        .innerJoin(
          tenantTables.storageMetadata,
          eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
        )
        .where(
          and(
            inArray(tenantTables.documents.id, documentIds),
          ),
        );

      dbSpan.attributes["documents_fetched"] = result.length;
      return result;
    });
  }

  /**
   * Deletes physical files from storage
   *
   * @param documentsWithStorage - Documents with storage metadata
   * @returns Promise with list of document IDs that failed to delete
   *
   * @private
   */
  private async deletePhysicalFiles(
    documentsWithStorage: Array<{
      document: typeof tenantTables.documents.$inferSelect;
      storage: typeof tenantTables.storageMetadata.$inferSelect;
    }>,
  ): Promise<string[]> {
    return await traced("deletePhysicalFiles", "storage", async (storageSpan) => {
      const storage = getStorage();
      const CONCURRENCY = 5; // Process up to 5 deletions concurrently
      const failedIds: string[] = [];

      // Process files in batches with concurrency control
      for (let i = 0; i < documentsWithStorage.length; i += CONCURRENCY) {
        const batch = documentsWithStorage.slice(i, i + CONCURRENCY);

        const results = await Promise.allSettled(
          batch.map(async (doc) => {
            try {
              // Delete main document file
              await storage.deleteFile(doc.storage.folderPath);

              // Delete thumbnail if it exists
              if (doc.storage.thumbnailPath) {
                await storage.deleteFile(doc.storage.thumbnailPath);
              }

              return { success: true, documentId: doc.document.id };
            } catch (error) {
              return { success: false, documentId: doc.document.id, error };
            }
          }),
        );

        // Process results
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const doc = batch[j];

          if (result.status === "fulfilled" && result.value.success) {
            // Success
          } else {
            const error = result.status === "fulfilled" ? result.value.error : result.reason;

            await useLogger(LoggerLevels.warn, {
              message: "Failed to delete physical file from storage, continuing with database cleanup",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "document_delete.storage_delete_failed",
              details: {
                documentId: doc.document.id,
                filePath: doc.storage.folderPath,
                error,
              },
            });
            failedIds.push(doc.document.id);
          }
        }
      }

      storageSpan.attributes["files_deleted"] = documentsWithStorage.length - failedIds.length;
      storageSpan.attributes["files_failed"] = failedIds.length;
      storageSpan.attributes["concurrency"] = CONCURRENCY;
      return failedIds;
    });
  }

  /**
   * Logs deletion for audit trail
   *
   * @param documentsWithStorage - Documents being deleted with storage metadata
   * @param userId - User performing the deletion
   * @returns Promise<void>
   *
   * @private
   */
  private async logDeletion(
    documentsWithStorage: Array<{
      document: typeof tenantTables.documents.$inferSelect;
      storage: typeof tenantTables.storageMetadata.$inferSelect;
    }>,
    userId: string,
  ): Promise<void> {
    // Log deletions (non-blocking)
    const logPromises = documentsWithStorage.map((doc) => {
      return this.accessLogService.logDocumentAccess(
        doc.document.id,
        userId,
        "delete",
        "direct",
      ).catch((err) => {
        useLogger(LoggerLevels.warn, {
          message: "Failed to log document deletion",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "document_delete_log_failed",
          details: { documentId: doc.document.id, userId },
          raw: err,
        });
      });
    });

    await Promise.allSettled(logPromises);
  }

  /**
   * Deletes database records in a transaction
   *
   * @param documentIds - Array of document IDs to delete
   * @param storageMetadataIds - Array of storage metadata IDs to delete
   * @param environmentId - Environment ID
   * @returns Promise<number> - Number of documents deleted
   *
   * @private
   */
  private async deleteDatabaseRecords(
    documentIds: string[],
    storageMetadataIds: string[],
    environmentId: string,
    tombstoneKeys: string[],
  ): Promise<number> {
    return await traced("deleteDatabaseRecords", "db.transaction", async (txSpan) => {
      let processedCount = 0;

      await (await getTenantDB(environmentId)).transaction(async (tx) => {
        // Delete document data keys
        await tx
          .delete(tenantTables.documentsDataKeys)
          .where(inArray(tenantTables.documentsDataKeys.documentId, documentIds));

        // Delete access logs
        await tx
          .delete(tenantTables.documentAccessLogs)
          .where(inArray(tenantTables.documentAccessLogs.documentId, documentIds));

        // Delete tag assignments
        await tx
          .delete(tenantTables.documentTagAssignments)
          .where(inArray(tenantTables.documentTagAssignments.documentId, documentIds));

        // Delete comments
        await tx
          .delete(tenantTables.documentComments)
          .where(inArray(tenantTables.documentComments.documentId, documentIds));

        // Delete favorites
        await tx
          .delete(tenantTables.documentFavorites)
          .where(inArray(tenantTables.documentFavorites.documentId, documentIds));

        // Delete documents
        const deletedDocs = await tx
          .delete(tenantTables.documents)
          .where(
            and(
              inArray(tenantTables.documents.id, documentIds),
            ),
          )
          .returning({ id: tenantTables.documents.id });

        processedCount = deletedDocs.length;

        // Delete storage metadata
        await tx
          .delete(tenantTables.storageMetadata)
          .where(inArray(tenantTables.storageMetadata.id, storageMetadataIds));

        // Enqueue backup-purge tombstones (DD4) in the same tx as the row
        // delete: catalog rows are hard-deleted, so the deferred backup purge
        // must be captured here. One row per key (document + thumbnail).
        if (tombstoneKeys.length > 0) {
          await tx
            .insert(tenantTables.backupDeletionQueue)
            .values(buildBackupTombstoneRows(tombstoneKeys, Math.floor(Date.now() / 1000)));
        }
      });

      txSpan.attributes["deleted_data_keys"] = true;
      txSpan.attributes["deleted_access_logs"] = true;
      txSpan.attributes["deleted_documents"] = processedCount;
      txSpan.attributes["deleted_storage_metadata"] = storageMetadataIds.length;
      return processedCount;
    });
  }

  /**
   * Hard deletes a document permanently, removing all data and files
   * Only the document owner or users with Admin rights on shared documents can perform this operation
   *
   * SECURITY IMPLEMENTATION:
   * - 404 error if document not found OR user has no permission to view/access
   * - 401 error if user has access but lacks delete permission
   * - Timing attack protection for all permission checks
   *
   * @param id - Document ID
   * @param userId - ID of the user deleting the document
   * @param environmentId - ID of the environment
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new DocumentDeleteService();
   * await service.hardDelete('doc_123', 'user_456', 'env_789');
   * ```
   */
  async hardDelete(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentDeleteService.hardDelete",
      {
        service: "DocumentDeleteService",
        method: "hardDelete",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId: id, userId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = id;
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;

        const startTime = performance.now();

        // Use bulk delete with single ID
        const result = await this.bulkHardDelete([id], userId, environmentId);

        if (result.failedCount > 0) {
          const error = result.errors[0];
          if (error.error.includes("Access denied") || error.error.includes("insufficient permissions")) {
            await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.STANDARD);
            throwHttpError("DOCUMENT.ACCESS_DENIED");
          }
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.STANDARD);
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.STANDARD);

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Performs bulk hard delete operation - permanently removes documents from database and storage
   * Only the document owner or users with Admin rights on shared documents can perform this operation
   *
   * SECURITY IMPLEMENTATION:
   * - Validates bulk operation limits
   * - Checks admin-level permissions for each document
   * - Removes physical files from storage
   * - Deletes all related database records in a transaction
   *
   * @param documentIds - Array of document IDs to delete
   * @param userId - ID of the user performing the deletion
   * @param environmentId - ID of the environment
   * @returns Promise<IBulkOperationResult> - Result of the bulk operation with success/failure details
   */
  async bulkHardDelete(
    documentIds: string[],
    userId: string,
    environmentId: string,
  ): Promise<IBulkOperationResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentDeleteService.bulkHardDelete",
      {
        service: "DocumentDeleteService",
        method: "bulkHardDelete",
        section: loggerAppSections.DOCUMENTS,
        details: { documentIds, userId, environmentId },
      },
      "DOCUMENT.BULK_DELETE_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["document_count"] = documentIds.length;
        span.attributes["document_ids"] = documentIds.join(",");

        const startTime = performance.now();

        this.validateBulkOperationLimits(documentIds);
        span.attributes["validation_passed"] = true;

        const permissionMap = await traced("bulkHardDelete.checkPermissions", "service", async (permSpan) => {
          const map = await this.checkBulkPermissions(
            documentIds,
            userId,
            DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
          );
          permSpan.attributes["permissions_checked"] = documentIds.length;
          return map;
        });

        const allowedIds: string[] = [];
        const errors: Array<{ documentId: string; error: string }> = [];

        for (const [documentId, hasAccess] of permissionMap.entries()) {
          if (hasAccess) {
            allowedIds.push(documentId);
          } else {
            errors.push({
              documentId,
              error: "Access denied: insufficient permissions to delete document",
            });
          }
        }

        span.attributes["allowed_count"] = allowedIds.length;
        span.attributes["denied_count"] = errors.length;

        let _processedCount = 0;

        if (allowedIds.length > 0) {
          // Fetch documents with storage metadata
          const documentsWithStorage = await this.fetchDocumentsWithStorage(
            allowedIds,
            environmentId,
          );

          span.attributes["documents_fetched"] = documentsWithStorage.length;

          await this.logDeletion(documentsWithStorage, userId);

          // Delete physical files
          await this.deletePhysicalFiles(documentsWithStorage);

          const totalFileSizeKb = documentsWithStorage.reduce(
            (sum: number, d: { storage: { encryptedFileSize?: number } }) => sum + Math.ceil((d.storage.encryptedFileSize ?? 0) / 1024),
            0,
          );
          fireAndForgetOperation("update-storage-quota-delete", async () => {
            try {
              const gdb = getGlobalDB();
              await gdb
                .update(globalTables.environmentQuotas)
                .set({
                  currentStorageKb: sql`MAX(0, current_storage_kb - ${totalFileSizeKb})`,
                  updatedAt: Math.floor(Date.now() / 1000),
                })
                .where(eq(globalTables.environmentQuotas.id, environmentId));
            } catch (error) {
              useLogger(LoggerLevels.error, {
                message: "Failed to update storage quota after delete",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "storage_quota_update_failed",
                details: { environmentId, deltaKb: totalFileSizeKb, error: String(error) },
              });
            }
          });

          // Delete database records in transaction
          const storageMetadataIds = documentsWithStorage.map((d: { document: { storageMetadataId: string } }) =>
            d.document.storageMetadataId
          );
          // Capture the exact object keys for backup-purge tombstones (DD4).
          const tombstoneKeys: string[] = [];
          for (const d of documentsWithStorage) {
            tombstoneKeys.push(d.storage.folderPath);
            if (d.storage.thumbnailPath) tombstoneKeys.push(d.storage.thumbnailPath);
          }
          _processedCount = await this.deleteDatabaseRecords(
            allowedIds,
            storageMetadataIds,
            environmentId,
            tombstoneKeys,
          );
        }

        const duration = performance.now() - startTime;
        span.attributes["execution_duration_ms"] = Math.round(duration);
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
