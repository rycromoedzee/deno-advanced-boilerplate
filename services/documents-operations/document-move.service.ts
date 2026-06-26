/**
 * @file services/documents-operations/document-move.service.ts
 * @description Service for document move operations (single & bulk)
 *
 * This service handles document movement with:
 * - Permission checking
 * - Target folder validation
 * - Cache invalidation
 * - Change tracking for moves
 *
 * Consolidates single and bulk move operations to eliminate duplication.
 */

import { and, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import { DocumentFolderPermissionService } from "@services/document-folders/folder-permission.service.ts";
import { DocumentAccessLogService } from "@services/documents-stats/unified-access-log.service.ts";
import { ChangeTrackingService } from "./change-tracking.helpers.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { getDocumentPermissionInheritanceService, getDocumentPermissionService } from "@services/documents-permission/singletons.ts";
import { getDocumentFolderPermissionService } from "@services/document-folders/singletons.ts";
import { getDocumentAccessLogService } from "@services/documents-stats/singletons.ts";
import { getChangeTrackingService } from "./change-tracking.helpers.ts";
import { DocumentCrudHelpers } from "@services/documents/document-crud.helpers.ts";
import { BULK_OPERATION_CONSTRAINTS } from "@constants/documents/bulk-operations.ts";
import { getMoveOperationService } from "./move-operation.service.ts";
import type { InitiateMoveOperationResult } from "@interfaces/move-operations.ts";

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
 * Document Move Service
 *
 * Provides document movement functionality for both single and bulk operations:
 * - Single document move with validation
 * - Bulk document move with transaction support
 * - Permission checking
 * - Target folder validation
 * - Cache invalidation
 *
 * All operations enforce permission checking and validate target folders
 * to ensure data integrity.
 */
export class DocumentMoveService {
  private permissionService: DocumentPermissionService;
  private folderPermissionService: DocumentFolderPermissionService;
  private accessLogService: DocumentAccessLogService;
  private changeTrackingService: ChangeTrackingService;

  constructor(
    permissionService?: DocumentPermissionService,
    folderPermissionService?: DocumentFolderPermissionService,
    accessLogService?: DocumentAccessLogService,
    changeTrackingService?: ChangeTrackingService,
  ) {
    // Use injected dependencies or create new instances
    this.permissionService = permissionService ||
      getDocumentPermissionService();
    this.folderPermissionService = folderPermissionService ||
      getDocumentFolderPermissionService();
    this.accessLogService = accessLogService || getDocumentAccessLogService();
    this.changeTrackingService = changeTrackingService || getChangeTrackingService();
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
   * @param environmentId - Environment ID (unused but kept for API consistency)
   * @returns Promise<Map<string, boolean>> - Map of document ID to permission status
   *
   * @private
   */
  private async checkBulkPermissions(
    documentIds: string[],
    userId: string,
    _environmentId: string,
  ): Promise<Map<string, boolean>> {
    try {
      // Use batch check for efficiency (single DB query for uncached resources)
      return await this.permissionService.batchCheckAccess(
        documentIds,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
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
   * Moves a document to a different folder (synchronous operation)
   *
   * Single document moves are fast and execute synchronously.
   * Includes permission inheritance if moved to a shared folder.
   *
   * @param id - Document ID
   * @param targetFolderId - Target folder ID (null for root)
   * @param userId - ID of the user moving the document
   * @param environmentId - Environment ID
   * @returns Promise<boolean> - True if successful, false otherwise
   *
   * @example
   * ```typescript
   * const service = new DocumentMoveService();
   * const moved = await service.move('doc_123', 'folder_456', 'user_789', 'env_123');
   * ```
   */
  async move(
    id: string,
    targetFolderId: string | null,
    userId: string,
    environmentId: string,
  ): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "DocumentMoveService.move",
      {
        service: "DocumentMoveService",
        method: "move",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId: id, targetFolderId, userId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = id;
        span.attributes["user_id"] = userId;
        span.attributes["target_folder_id"] = targetFolderId || "root";

        const startTime = performance.now();

        // Get current document state for change tracking
        const [currentDoc] = await (await getTenantDB(environmentId))
          .select({ folderId: tenantTables.documents.folderId })
          .from(tenantTables.documents)
          .where(
            and(
              eq(tenantTables.documents.id, id),
            ),
          )
          .limit(1);

        if (!currentDoc) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const { documentOwnerId } = await DocumentCrudHelpers.checkMovePermissions(
          id,
          userId,
          environmentId,
          this.permissionService,
        );

        if (targetFolderId !== null) {
          await DocumentCrudHelpers.validateTargetFolder(
            targetFolderId,
            documentOwnerId,
            userId,
            environmentId,
            this.folderPermissionService,
          );
        }

        const updatedDocument = await DocumentCrudHelpers.performMoveOperation(
          id,
          targetFolderId,
          environmentId,
        );

        // Track the folder change and log
        const changes = this.changeTrackingService.trackDocumentMove(
          currentDoc.folderId,
          targetFolderId,
        );

        this.accessLogService.logDocumentAccess(
          id,
          userId,
          "move",
          "direct",
          { changes: changes.length > 0 ? changes : undefined },
        ).catch((err) => {
          useLogger(LoggerLevels.warn, {
            message: "Failed to log document move",
            section: loggerAppSections.DOCUMENTS,
            messageKey: "document_move_log_failed",
            details: { documentId: id, userId },
            raw: err,
          });
        });

        // Handle permission inheritance asynchronously if moved to a folder
        if (targetFolderId) {
          this.handlePermissionInheritanceAsync(
            id,
            targetFolderId,
            documentOwnerId,
          ).catch((error) => {
            useLogger(LoggerLevels.error, {
              message: "Async permission inheritance failed for document move",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "permission_inheritance_async_error",
              details: {
                documentId: id,
                folderId: targetFolderId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
        }

        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.STANDARD,
        );

        span.attributes["success"] = true;
        return updatedDocument;
      },
    );
  }

  /**
   * Handles permission inheritance asynchronously without blocking the move
   *
   * @param documentId - ID of the moved document
   * @param folderId - ID of the target folder
   * @param ownerId - ID of the document owner
   * @returns Promise<void> - Fire-and-forget async processing
   *
   * @private
   */
  private async handlePermissionInheritanceAsync(
    documentId: string,
    folderId: string,
    ownerId: string,
  ): Promise<void> {
    try {
      const permissionInheritanceService = getDocumentPermissionInheritanceService();

      await permissionInheritanceService.handleNewDocumentInheritance(
        documentId,
        folderId,
        ownerId,
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Performs bulk move operation to a target folder
   *
   * @param documentIds - Array of document IDs to move
   * @param targetFolderId - Target folder ID (null for root)
   * @param userId - ID of the user performing the move
   * @param environmentId - ID of the environment
   * @param asyncMode - If true (default), use async SSE-based operation; if false, run synchronously
   * @returns Promise<InitiateMoveOperationResult | IBulkOperationResult> - Operation details or sync result
   */
  async bulkMove(
    documentIds: string[],
    targetFolderId: string | null,
    userId: string,
    environmentId: string,
    asyncMode: boolean = true,
  ): Promise<InitiateMoveOperationResult | IBulkOperationResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentMoveService.bulkMove",
      {
        service: "DocumentMoveService",
        method: "bulkMove",
        section: loggerAppSections.DOCUMENTS,
        details: { documentIds, targetFolderId, userId, environmentId },
      },
      "DOCUMENT.BULK_MOVE_FAILED",
      async (span) => {
        span.attributes["async_mode"] = asyncMode;
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["document_count"] = documentIds.length;
        span.attributes["target_folder_id"] = targetFolderId || "root";

        // Validate limits
        this.validateBulkOperationLimits(documentIds);

        // Validate target folder exists and user has WRITE access
        if (targetFolderId !== null) {
          const hasFolderAccess = await this.folderPermissionService.checkFolderAccess(
            targetFolderId,
            userId,
            DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
          );

          if (!hasFolderAccess) {
            throwHttpError("DOCUMENT.MOVE_TARGET_FOLDER_INVALID");
          }
        }

        // Basic permission check for documents (detailed checks done by background job)
        const permissionMap = await this.checkBulkPermissions(
          documentIds,
          userId,
          environmentId,
        );

        const allowedIds: string[] = [];
        for (const [documentId, hasAccess] of permissionMap.entries()) {
          if (hasAccess) {
            allowedIds.push(documentId);
          }
        }

        if (allowedIds.length === 0) {
          throwHttpError("DOCUMENT.MOVE_NO_DOCUMENTS");
        }

        // Choose sync or async based on asyncMode
        if (!asyncMode) {
          // Synchronous bulk move
          const result = await this.performSynchronousBulkMove(
            allowedIds,
            targetFolderId,
            userId,
            environmentId,
          );

          span.attributes["allowed_document_count"] = allowedIds.length;
          span.attributes["success"] = result.success;

          return result;
        }

        // Async bulk move operation with SSE
        const moveOperationService = getMoveOperationService();
        const result = await moveOperationService.initiateMoveOperation({
          operationType: "bulk_documents",
          userId,
          environmentId,
          documentIds: allowedIds,
          targetFolderId,
        }, true); // executeImmediately = true

        span.attributes["operation_id"] = result.operationId;
        span.attributes["allowed_document_count"] = allowedIds.length;
        span.attributes["success"] = true;

        return result;
      },
    );
  }

  /**
   * Performs synchronous bulk move operation
   *
   * @param documentIds - Array of document IDs to move
   * @param targetFolderId - Target folder ID (null for root)
   * @param userId - ID of the user performing the move
   * @param environmentId - ID of the environment
   * @returns Promise<IBulkOperationResult> - Bulk operation result
   *
   * @private
   */
  private async performSynchronousBulkMove(
    documentIds: string[],
    targetFolderId: string | null,
    userId: string,
    environmentId: string,
  ): Promise<IBulkOperationResult> {
    const errors: Array<{ documentId: string; error: string }> = [];

    // Perform moves sequentially
    for (const documentId of documentIds) {
      try {
        await this.move(documentId, targetFolderId, userId, environmentId);
      } catch (error) {
        errors.push({
          documentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: errors.length === 0,
      failedCount: errors.length,
      errors,
    };
  }
}
