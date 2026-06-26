/**
 * @file services/documents-archive/document-archive.service.ts
 * @description Service for document archive/restore operations (single & bulk)
 *
 * This service handles document archiving and restoration with:
 * - Permission checking
 * - Transaction support for bulk operations
 * - Cache invalidation
 * - Access logging
 *
 * Consolidates single and bulk archive/restore operations to eliminate duplication.
 */

import { and, eq, inArray } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import { DocumentAccessLogService } from "@services/documents-stats/unified-access-log.service.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getDocumentPermissionService } from "@services/documents-permission/singletons.ts";
import { getDocumentAccessLogService } from "@services/documents-stats/singletons.ts";
import { BULK_OPERATION_CONSTRAINTS } from "@constants/documents/bulk-operations.ts";

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
 * Document Archive Service
 *
 * Provides document archiving and restoration functionality for both single and bulk operations:
 * - Single document archive/restore with permission checking
 * - Bulk document archive/restore with transaction support
 * - Cache invalidation
 * - Access logging
 *
 * All operations enforce permission checking and use database transactions
 * to ensure atomicity and data consistency.
 */
export class DocumentArchiveService {
  private permissionService: DocumentPermissionService;
  private accessLogService: DocumentAccessLogService;

  constructor(
    permissionService?: DocumentPermissionService,
    accessLogService?: DocumentAccessLogService,
  ) {
    // Use injected dependencies or create new instances
    this.permissionService = permissionService ||
      getDocumentPermissionService();
    this.accessLogService = accessLogService || getDocumentAccessLogService();
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
   * Archives a document by setting isArchived flag
   *
   * @param id - Document ID
   * @param userId - ID of the user archiving the document
   * @param environmentId - ID of the environment
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new DocumentArchiveService();
   * await service.archive('doc_123', 'user_456', 'env_789');
   * ```
   */
  async archive(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentArchiveService.archive",
      {
        service: "DocumentArchiveService",
        method: "archive",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId: id, userId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = id;
        span.attributes["user_id"] = userId;

        // Use bulk archive with single ID
        const result = await this.bulkArchive([id], userId, environmentId);

        if (result.failedCount > 0) {
          const error = result.errors[0];
          if (error.error.includes("Access denied") || error.error.includes("insufficient permissions")) {
            throwHttpError("DOCUMENT.ACCESS_DENIED");
          }
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Restores a document by clearing isArchived flags
   *
   * @param id - Document ID
   * @param userId - ID of the user restoring the document
   * @param environmentId - ID of the environment
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new DocumentArchiveService();
   * await service.restore('doc_123', 'user_456', 'env_789');
   * ```
   */
  async restore(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentArchiveService.restore",
      {
        service: "DocumentArchiveService",
        method: "restore",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId: id, userId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = id;
        span.attributes["user_id"] = userId;

        // Use bulk restore with single ID
        const result = await this.bulkRestore([id], userId, environmentId);

        if (result.failedCount > 0) {
          const error = result.errors[0];
          if (error.error.includes("Access denied") || error.error.includes("insufficient permissions")) {
            throwHttpError("DOCUMENT.ACCESS_DENIED");
          }
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Performs bulk archive operation
   *
   * @param documentIds - Array of document IDs to archive
   * @param userId - ID of the user performing the archive
   * @param environmentId - ID of the environment
   * @returns Promise<IBulkOperationResult> - Result of the bulk operation
   */
  async bulkArchive(
    documentIds: string[],
    userId: string,
    environmentId: string,
  ): Promise<IBulkOperationResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentArchiveService.bulkArchive",
      {
        service: "DocumentArchiveService",
        method: "bulkArchive",
        section: loggerAppSections.DOCUMENTS,
        details: { documentIds, userId, environmentId },
      },
      "DOCUMENT.BULK_ARCHIVE_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["document_count"] = documentIds.length;

        this.validateBulkOperationLimits(documentIds);

        const permissionMap = await this.checkBulkPermissions(
          documentIds,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
        );

        const allowedIds: string[] = [];
        const errors: Array<{ documentId: string; error: string }> = [];

        for (const [documentId, hasAccess] of permissionMap.entries()) {
          if (hasAccess) {
            allowedIds.push(documentId);
          } else {
            errors.push({
              documentId,
              error: "Access denied: insufficient permissions to archive document",
            });
          }
        }

        let _processedCount = 0;
        if (allowedIds.length > 0) {
          const now = getTimeNowForStorage();

          await (await getTenantDB(environmentId)).transaction(async (tx) => {
            const result = await tx
              .update(tenantTables.documents)
              .set({
                isArchived: true,
                archivedAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  inArray(tenantTables.documents.id, allowedIds),
                  eq(tenantTables.documents.ownerId, userId),
                ),
              )
              .returning({ id: tenantTables.documents.id });

            _processedCount = result.length;
          });
        }

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
   * Performs bulk restore operation
   *
   * @param documentIds - Array of document IDs to restore
   * @param userId - ID of the user performing the restore
   * @param environmentId - ID of the environment
   * @returns Promise<IBulkOperationResult> - Result of the bulk operation
   */
  async bulkRestore(
    documentIds: string[],
    userId: string,
    environmentId: string,
  ): Promise<IBulkOperationResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentArchiveService.bulkRestore",
      {
        service: "DocumentArchiveService",
        method: "bulkRestore",
        section: loggerAppSections.DOCUMENTS,
        details: { documentIds, userId, environmentId },
      },
      "DOCUMENT.BULK_RESTORE_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["document_count"] = documentIds.length;

        this.validateBulkOperationLimits(documentIds);

        const permissionMap = await this.checkBulkPermissions(
          documentIds,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
        );

        const allowedIds: string[] = [];
        const errors: Array<{ documentId: string; error: string }> = [];

        for (const [documentId, hasAccess] of permissionMap.entries()) {
          if (hasAccess) {
            allowedIds.push(documentId);
          } else {
            errors.push({
              documentId,
              error: "Access denied: insufficient permissions to restore document",
            });
          }
        }

        let _processedCount = 0;
        if (allowedIds.length > 0) {
          const now = getTimeNowForStorage();

          await (await getTenantDB(environmentId)).transaction(async (tx) => {
            const result = await tx
              .update(tenantTables.documents)
              .set({
                archivedAt: null,
                isArchived: false,
                updatedAt: now,
              })
              .where(
                and(
                  inArray(tenantTables.documents.id, allowedIds),
                  eq(tenantTables.documents.ownerId, userId),
                ),
              )
              .returning({ id: tenantTables.documents.id });

            _processedCount = result.length;
          });

          // Log restore access for all restored documents (non-blocking)
          await Promise.allSettled(
            allowedIds.map((id) => this.accessLogService.logDocumentAccess(id, userId, "restore", "direct")),
          );
        }

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
