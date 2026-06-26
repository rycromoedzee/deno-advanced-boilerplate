/**
 * @file services/document-folders/folder-move.service.ts
 * @description Service for folder move operations (single & bulk)
 *
 * This service handles folder movement with:
 * - Permission checking
 * - Circular reference validation
 * - Depth validation
 *
 * Consolidates single and bulk move operations to eliminate duplication.
 */

import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { DocumentFolderCrudHelpers } from "./folder-crud.helpers.ts";
import { FolderReadService } from "./folder-read.service.ts";
import { BULK_OPERATION_CONSTRAINTS } from "@constants/documents/bulk-operations.ts";
import { getMoveOperationService } from "@services/documents-operations/index.ts";
import type { InitiateMoveOperationResult } from "@interfaces/move-operations.ts";

/**
 * Result of a bulk operation
 */
export interface IBulkOperationResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  errors: Array<{
    folderId: string;
    error: string;
  }>;
}

/**
 * Folder Move Service
 *
 * Provides folder movement functionality for both single and bulk operations:
 * - Single folder move with validation
 * - Bulk folder move with transaction support
 * - Circular reference prevention
 * - Depth validation
 * - Cache invalidation
 *
 * All operations enforce permission checking and validate folder hierarchy
 * to prevent circular references and maintain data integrity.
 */
export class FolderMoveService {
  private readService: FolderReadService;

  constructor(
    readService?: FolderReadService,
  ) {
    // Use injected dependencies or create new instances
    this.readService = readService || new FolderReadService();
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
      throwHttpError("DOCUMENT_FOLDER.BULK_MOVE_BAD_REQUEST");
    }

    if (
      folderIds.length > BULK_OPERATION_CONSTRAINTS.MAX_FOLDERS
    ) {
      throwHttpError("DOCUMENT_FOLDER.BULK_MOVE_BAD_REQUEST");
    }

    const uniqueIds = new Set(folderIds);
    if (uniqueIds.size !== folderIds.length) {
      throwHttpError("DOCUMENT_FOLDER.BULK_MOVE_BAD_REQUEST");
    }
  }

  /**
   * Moves a folder to a new parent folder using async SSE-based operation
   *
   * @param id - Folder ID to move
   * @param newParentId - New parent folder ID (null for root)
   * @param userId - ID of the user performing the move
   * @param environmentId - ID of the environment
   * @returns Promise<InitiateMoveOperationResult> - Operation details with status and ID
   *
   * @example
   * ```typescript
   * const service = new FolderMoveService();
   * const result = await service.move('folder_123', 'folder_456', 'user_789', 'env_123');
   * console.log(`Operation ${result.operationId} initiated with status ${result.status}`);
   * ```
   */
  async move(
    id: string,
    newParentId: string | null,
    userId: string,
    environmentId: string,
  ): Promise<InitiateMoveOperationResult> {
    const startTime = performance.now();

    return await tracedWithServiceErrorHandling(
      "FolderMoveService.move",
      {
        service: "FolderMoveService",
        method: "move",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId: id, newParentId, userId, environmentId },
      },
      "DOCUMENT_FOLDER.MOVE_FAILED",
      async (span) => {
        span.attributes["folder_id"] = id;
        span.attributes["user_id"] = userId;
        span.attributes["new_parent_id"] = newParentId || "root";

        // Validate permissions and constraints before initiating async operation
        const existing = await this.readService.findById(id, userId, environmentId);

        if (!existing) {
          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.STANDARD,
          );

          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        // Check write permission on the folder being moved
        if (!permissionLevelMeets(existing.userPermissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)) {
          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.STANDARD,
          );
          throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
        }

        const isValid = await DocumentFolderCrudHelpers.validateMove(id, newParentId);
        if (!isValid) {
          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.STANDARD,
          );
          throwHttpError("DOCUMENT_FOLDER.CIRCULAR_REFERENCE");
        }

        if (newParentId) {
          const parentExists = await this.readService.findById(
            newParentId,
            userId,
            environmentId,
          );
          if (!parentExists) {
            await ensureMinimumProcessingTime(
              startTime,
              TIMING_PROFILES.STANDARD,
            );
            throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
          }

          // Check write permission on the destination parent folder
          if (!permissionLevelMeets(parentExists.userPermissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)) {
            await ensureMinimumProcessingTime(
              startTime,
              TIMING_PROFILES.STANDARD,
            );
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }
        }

        const newDepth = await DocumentFolderCrudHelpers.calculateDepth(id, newParentId);
        if (newDepth > 10) {
          throwHttpError("DOCUMENT_FOLDER.MAX_DEPTH_EXCEEDED");
        }

        // Initiate async move operation
        const moveOperationService = getMoveOperationService();
        const result = await moveOperationService.initiateMoveOperation({
          operationType: "single_folder",
          userId,
          environmentId,
          folderId: id,
          targetParentFolderId: newParentId,
        });

        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.STANDARD,
        );

        span.attributes["success"] = true;
        return result;
      },
    );
  }

  /**
   * Performs bulk move operation to a target folder using async SSE-based operation
   *
   * @param folderIds - Array of folder IDs to move
   * @param targetParentId - Target folder ID (null for root)
   * @param userId - ID of the user performing the move
   * @param environmentId - ID of the environment
   * @returns Promise<InitiateMoveOperationResult> - Operation details with status and ID
   */
  async bulkMove(
    folderIds: string[],
    targetParentId: string | null,
    userId: string,
    environmentId: string,
  ): Promise<InitiateMoveOperationResult> {
    return await tracedWithServiceErrorHandling(
      "FolderMoveService.bulkMove",
      {
        service: "FolderMoveService",
        method: "bulkMove",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { userId, environmentId, folderCount: folderIds.length, targetParentId },
      },
      "DOCUMENT_FOLDER.BULK_MOVE_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["folder_count"] = folderIds.length;
        span.attributes["target_parent_id"] = targetParentId || "root";

        // Validate limits
        this.validateBulkOperationLimits(folderIds);

        // Validate target folder if provided
        if (targetParentId !== null) {
          const targetFolder = await this.readService.findById(
            targetParentId,
            userId,
            environmentId,
          );
          if (!targetFolder) {
            throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
          }
          if (!permissionLevelMeets(targetFolder.userPermissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)) {
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }
        }

        // Basic validation for each folder (detailed checks done by background job)
        for (const folderId of folderIds) {
          // Check folder exists and user has permission
          const folder = await this.readService.findById(folderId, userId, environmentId);
          if (!folder) {
            throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
          }
          if (!permissionLevelMeets(folder.userPermissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)) {
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }

          // Validate circular reference
          const isValid = await DocumentFolderCrudHelpers.validateMove(folderId, targetParentId);
          if (!isValid) {
            throwHttpError("DOCUMENT_FOLDER.CIRCULAR_REFERENCE");
          }
        }

        // Initiate async bulk move operation
        const moveOperationService = getMoveOperationService();
        const result = await moveOperationService.initiateMoveOperation({
          operationType: "bulk_folders",
          userId,
          environmentId,
          folderIds,
          targetParentFolderId: targetParentId,
        });

        span.attributes["operation_id"] = result.operationId;
        span.attributes["success"] = true;

        return result;
      },
    );
  }
}
