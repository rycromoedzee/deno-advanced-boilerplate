/**
 * @file services/documents/move-operation.service.ts
 * @description Service for managing async move operations with cache-based status tracking
 */

import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import {
  type InitiateMoveOperationParams,
  type InitiateMoveOperationResult,
  MoveOperationPhase,
  type MoveOperationRollbackState,
  MoveOperationStatus,
  type MoveOperationStatusType,
  type MoveOperationType,
} from "@interfaces/move-operations.ts";
import { generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { getTimeNow } from "@utils/shared/time.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";

/**
 * Move Operation Service
 *
 * Handles async move operations with:
 * - Cache-based status tracking
 * - Progress updates
 * - Rollback state management
 * - SSE event coordination
 */
export class MoveOperationService {
  private readonly OPERATION_TTL = 24 * 60 * 60; // 24 hours
  private readonly PROGRESS_TTL = 60 * 60; // 1 hour
  private readonly ROLLBACK_TTL = 7 * 24 * 60 * 60; // 7 days

  /**
   * Initiate a new async move operation
   *
   * @param params - Move operation parameters
   * @param executeImmediately - If true, triggers background processing immediately (default: true)
   */
  async initiateMoveOperation(
    params: InitiateMoveOperationParams,
    executeImmediately: boolean = true,
  ): Promise<InitiateMoveOperationResult> {
    return await traced(
      "MoveOperationService.initiateMoveOperation",
      "service",
      async (span) => {
        span.attributes["operation_type"] = params.operationType;
        span.attributes["user_id"] = params.userId;
        span.attributes["environment_id"] = params.environmentId;
        span.attributes["execute_immediately"] = executeImmediately;

        const cache = await getCache();
        const operationId = generateIdRandomWithTimestamp();
        const now = getTimeNow();

        // Create initial status based on operation type
        const status = this.createInitialStatus(operationId, params, now);

        // Store operation status in cache
        await cache.set(
          CACHE_NAMESPACES.MOVE_OPERATIONS.OPERATIONS,
          operationId,
          status,
          { ttl: this.OPERATION_TTL },
        );

        // Initialize progress tracking
        await cache.set(
          CACHE_NAMESPACES.MOVE_OPERATIONS.PROGRESS,
          operationId,
          { progress: 0, phase: "initialization" },
          { ttl: this.PROGRESS_TTL },
        );

        span.attributes["operation_id"] = operationId;
        span.attributes["status"] = status.status;

        // Trigger immediate background processing if requested
        if (executeImmediately) {
          // Import and trigger background processing (fire-and-forget)
          const { processMoveOperationImmediately } = await import("./move-operations.processor.ts");
          processMoveOperationImmediately(status);
        }

        // Calculate estimated completion (rough estimate)
        const estimatedCompletion = this.calculateEstimatedCompletion(
          params.operationType,
          params.documentIds?.length || params.folderIds?.length || 1,
        );

        return {
          operationId,
          status: executeImmediately ? "processing" : "pending",
          estimatedCompletion,
          totalItems: this.getTotalItems(params),
          message: this.getInitiationMessage(params.operationType),
        };
      },
    );
  }

  /**
   * Get operation status
   */
  async getOperationStatus(
    operationId: string,
  ): Promise<MoveOperationStatusType | null> {
    const cache = await getCache();
    return await cache.get<MoveOperationStatusType>(
      CACHE_NAMESPACES.MOVE_OPERATIONS.OPERATIONS,
      operationId,
    );
  }

  /**
   * Update operation status
   */
  async updateOperationStatus(
    operationId: string,
    updates: Partial<MoveOperationStatusType>,
  ): Promise<void> {
    const cache = await getCache();
    const status = await this.getOperationStatus(operationId);

    if (!status) {
      await useLogger(LoggerLevels.warn, {
        message: "Cannot update status for non-existent operation",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "move_operation_status_not_found",
        details: { operationId },
      });
      return;
    }

    const updatedStatus = {
      ...status,
      ...updates,
      updatedAt: getTimeNow(),
    } as MoveOperationStatusType;

    await cache.set(
      CACHE_NAMESPACES.MOVE_OPERATIONS.OPERATIONS,
      operationId,
      updatedStatus,
      { ttl: this.OPERATION_TTL },
    );

    // Update progress separately for faster access
    await this.updateProgress(
      operationId,
      updatedStatus.progress || 0,
      this.getCurrentPhase(updatedStatus),
    );
  }

  /**
   * Update operation progress
   */
  async updateProgress(
    operationId: string,
    progress: number,
    phase: MoveOperationPhase,
  ): Promise<void> {
    const cache = await getCache();
    await cache.set(
      CACHE_NAMESPACES.MOVE_OPERATIONS.PROGRESS,
      operationId,
      { progress, phase, updatedAt: getTimeNow() },
      { ttl: this.PROGRESS_TTL },
    );
  }

  /**
   * Get operation progress
   */
  async getOperationProgress(
    operationId: string,
  ): Promise<{ progress: number; phase: MoveOperationPhase } | null> {
    const cache = await getCache();
    return await cache.get<{ progress: number; phase: MoveOperationPhase }>(
      CACHE_NAMESPACES.MOVE_OPERATIONS.PROGRESS,
      operationId,
    );
  }

  /**
   * Store rollback state
   */
  async storeRollbackState(
    operationId: string,
    rollbackState: MoveOperationRollbackState,
  ): Promise<void> {
    const cache = await getCache();
    await cache.set(
      CACHE_NAMESPACES.MOVE_OPERATIONS.ROLLBACK_STATES,
      operationId,
      rollbackState,
      { ttl: this.ROLLBACK_TTL },
    );
  }

  /**
   * Get rollback state
   */
  async getRollbackState(
    operationId: string,
  ): Promise<MoveOperationRollbackState | null> {
    const cache = await getCache();
    return await cache.get<MoveOperationRollbackState>(
      CACHE_NAMESPACES.MOVE_OPERATIONS.ROLLBACK_STATES,
      operationId,
    );
  }

  /**
   * Mark operation as completed
   */
  async markCompleted(
    operationId: string,
    success: boolean = true,
    error?: string,
  ): Promise<void> {
    const status = await this.getOperationStatus(operationId);
    if (!status) {
      return;
    }

    await this.updateOperationStatus(operationId, {
      status: success ? MoveOperationStatus.COMPLETED : MoveOperationStatus.FAILED,
      completedAt: getTimeNow(),
      progress: 100,
      error,
    });
  }

  /**
   * Mark operation as cancelled
   */
  async markCancelled(operationId: string, reason?: string): Promise<void> {
    await this.updateOperationStatus(operationId, {
      status: MoveOperationStatus.CANCELLED,
      completedAt: getTimeNow(),
      error: reason,
    });
  }

  /**
   * Create initial status based on operation type
   */
  private createInitialStatus(
    operationId: string,
    params: InitiateMoveOperationParams,
    now: number,
  ): MoveOperationStatusType {
    const base = {
      operationId,
      userId: params.userId,
      environmentId: params.environmentId,
      operationType: params.operationType,
      status: "pending" as MoveOperationStatus,
      createdAt: now,
      updatedAt: now,
      progress: 0,
      currentPhase: "initialization" as MoveOperationPhase,
    };

    switch (params.operationType) {
      case "single_document":
        return {
          ...base,
          documentId: params.documentId!,
          targetFolderId: params.targetFolderId ?? null,
          originalFolderId: null, // Will be populated during move
        } as MoveOperationStatusType;

      case "bulk_documents":
        return {
          ...base,
          documentIds: params.documentIds || [],
          targetFolderId: params.targetFolderId ?? null,
          totalDocuments: params.documentIds?.length || 0,
          processedDocuments: 0,
          failedDocuments: 0,
        } as MoveOperationStatusType;

      case "single_folder":
        return {
          ...base,
          folderId: params.folderId!,
          targetParentFolderId: params.targetParentFolderId ?? null,
          originalParentFolderId: null, // Will be populated during move
          totalItems: 0, // Will be populated during move
          processedItems: 0,
        } as MoveOperationStatusType;

      case "bulk_folders":
        return {
          ...base,
          folderIds: params.folderIds || [],
          targetParentFolderId: params.targetParentFolderId ?? null,
          totalFolders: params.folderIds?.length || 0,
          processedFolders: 0,
          failedFolders: 0,
          totalItems: 0,
          processedItems: 0,
        } as MoveOperationStatusType;
    }
  }

  /**
   * Calculate estimated completion time
   */
  private calculateEstimatedCompletion(
    operationType: MoveOperationType,
    itemCount: number,
  ): string {
    const now = Date.now();
    // Rough estimates:
    // - Single operations: ~5 seconds
    // - Bulk operations: ~2 seconds per item, max 5 minutes
    let estimatedMs = 5000; // Base 5 seconds

    if (operationType === "bulk_documents" || operationType === "bulk_folders") {
      estimatedMs = Math.min(itemCount * 2000, 5 * 60 * 1000);
    } else if (operationType === "single_folder") {
      // Folder moves can be slower due to hierarchy processing
      estimatedMs = 10000; // 10 seconds base
    }

    const completionTime = new Date(now + estimatedMs);
    return completionTime.toISOString();
  }

  /**
   * Get total items for operation
   */
  private getTotalItems(params: InitiateMoveOperationParams): number | undefined {
    if (params.operationType === "bulk_documents") {
      return params.documentIds?.length;
    }
    if (params.operationType === "bulk_folders") {
      return params.folderIds?.length;
    }
    return undefined;
  }

  /**
   * Get initiation message
   */
  private getInitiationMessage(operationType: MoveOperationType): string {
    switch (operationType) {
      case "single_document":
        return "Document move operation queued for async processing";
      case "bulk_documents":
        return "Bulk document move operation queued for async processing";
      case "single_folder":
        return "Folder move operation queued for async processing";
      case "bulk_folders":
        return "Bulk folder move operation queued for async processing";
    }
  }

  /**
   * Get current phase from status
   */
  private getCurrentPhase(status: MoveOperationStatusType): MoveOperationPhase {
    return status.currentPhase || "initialization";
  }
}

// Singleton instance
let moveOperationServiceInstance: MoveOperationService | null = null;

/**
 * Get singleton instance of MoveOperationService
 */
export function getMoveOperationService(): MoveOperationService {
  if (!moveOperationServiceInstance) {
    moveOperationServiceInstance = new MoveOperationService();
  }
  return moveOperationServiceInstance;
}
