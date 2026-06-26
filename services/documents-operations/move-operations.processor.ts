/**
 * @file services/documents/move-operations.processor.ts
 * @description Background processor for async move operations
 *
 * Handles immediate background processing of move operations with:
 * - Permission inheritance and validation
 * - Automatic rollback on errors
 * - Progress tracking and SSE events
 * - Support for document and folder moves (single & bulk)
 *
 * Operations are triggered immediately when initiated, not via scheduled cron jobs.
 */

import { getMoveOperationService } from "./move-operation.service.ts";
import { getDocumentPermissionInheritanceService } from "@services/documents-permission/index.ts";
import { broadcastMoveEvent } from "./sse-move-events.service.ts";
import type { MoveOperationRollbackState, MoveOperationStatusType } from "@interfaces/move-operations.ts";
import { MoveOperationSSEEventType, MoveOperationStatus } from "@interfaces/move-operations.ts";
import { LogContextService, loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getTimeNow } from "@utils/shared/time.ts";
import { DocumentFolderCrudHelpers } from "@services/document-folders/folder-crud.helpers.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Process a specific move operation immediately in the background
 *
 * This is called directly when a move operation is initiated.
 * Runs in a fire-and-forget manner to avoid blocking the API response.
 *
 * @param operation - The move operation to process
 */
export function processMoveOperationImmediately(
  operation: MoveOperationStatusType,
): void {
  // Run in background context (fire-and-forget)
  const backgroundPromise = new LogContextService("move-operation-immediate")
    .runWithBackgroundContext({}, async () => {
      try {
        await processSingleOperation(operation);
      } catch (error) {
        await useLogger(LoggerLevels.error, {
          message: "Failed to process move operation immediately",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "MOVE_OPERATION_IMMEDIATE_FAILED",
          details: {
            operationId: operation.operationId,
            operationType: operation.operationType,
          },
          raw: error,
        });
      }
    });

  // Handle promise rejection (fire-and-forget with error logging)
  if (backgroundPromise) {
    backgroundPromise.catch((error: unknown) => {
      // Catch any errors from the background context itself
      useLogger(LoggerLevels.error, {
        message: "Background context failed for move operation",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "MOVE_OPERATION_BACKGROUND_CONTEXT_FAILED",
        details: {
          operationId: operation.operationId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }
}

/**
 * Process a single move operation
 */
async function processSingleOperation(
  operation: MoveOperationStatusType,
): Promise<void> {
  const moveService = getMoveOperationService();

  // Mark as processing
  await moveService.updateOperationStatus(operation.operationId, {
    status: MoveOperationStatus.PROCESSING,
    startedAt: getTimeNow(),
    currentPhase: "initialization",
  });

  // Fetch updated status and broadcast
  const startedStatus = await moveService.getOperationStatus(operation.operationId);
  if (startedStatus) {
    await broadcastMoveEvent(operation.operationId, MoveOperationSSEEventType.MOVE_STARTED, startedStatus);
  }

  try {
    switch (operation.operationType) {
      case "single_document":
        await processSingleDocumentMove(
          operation as MoveOperationStatusType & { operationType: "single_document"; documentId: string; targetFolderId: string | null },
        );
        break;
      case "bulk_documents":
        await processBulkDocumentMove(
          operation as MoveOperationStatusType & { operationType: "bulk_documents"; documentIds: string[]; targetFolderId: string | null },
        );
        break;
      case "single_folder":
        await processSingleFolderMove(
          operation as MoveOperationStatusType & { operationType: "single_folder"; folderId: string; targetParentFolderId: string | null },
        );
        break;
      case "bulk_folders":
        await processBulkFolderMove(
          operation as MoveOperationStatusType & {
            operationType: "bulk_folders";
            folderIds: string[];
            targetParentFolderId: string | null;
          },
        );
        break;
    }

    await moveService.markCompleted(operation.operationId, true);

    // Fetch updated status and broadcast completion
    const completedStatus = await moveService.getOperationStatus(operation.operationId);
    if (completedStatus) {
      await broadcastMoveEvent(operation.operationId, MoveOperationSSEEventType.MOVE_COMPLETED, completedStatus);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await moveService.markCompleted(operation.operationId, false, errorMessage);

    // Fetch updated status and broadcast failure
    const failedStatus = await moveService.getOperationStatus(operation.operationId);
    if (failedStatus) {
      await broadcastMoveEvent(operation.operationId, MoveOperationSSEEventType.MOVE_FAILED, failedStatus);
    }

    throw error;
  }
}

/**
 * Process single document move
 */
async function processSingleDocumentMove(
  operation: MoveOperationStatusType & { operationType: "single_document"; documentId: string; targetFolderId: string | null },
): Promise<void> {
  const moveService = getMoveOperationService();
  const permissionService = getDocumentPermissionInheritanceService();
  const db = await getTenantDB();
  const { eq } = await import("@deps");

  let originalFolderId: string | null = null;

  try {
    // Get original folder ID before moving
    const [doc] = await db
      .select({ folderId: tenantTables.documents.folderId })
      .from(tenantTables.documents)
      .where(eq(tenantTables.documents.id, operation.documentId))
      .limit(1);

    if (doc) {
      originalFolderId = doc.folderId;
    }

    // Store rollback state
    const rollbackState: MoveOperationRollbackState = {
      operationId: operation.operationId,
      operationType: "single_document",
      originalStates: [
        {
          id: operation.documentId,
          type: "document",
          originalFolderId,
        },
      ],
      createdAt: getTimeNow(),
    };
    await moveService.storeRollbackState(operation.operationId, rollbackState);

    // Update operation status with original folder ID
    await moveService.updateOperationStatus(operation.operationId, {
      originalFolderId,
    });

    // Perform move
    await moveService.updateOperationStatus(operation.operationId, {
      currentPhase: "moving",
      progress: 30,
    });

    // Use DocumentCrudHelpers directly to avoid circular dependency
    const { DocumentCrudHelpers } = await import("@services/documents/document-crud.helpers.ts");
    await DocumentCrudHelpers.performMoveOperation(
      operation.documentId,
      operation.targetFolderId,
      operation.environmentId,
    );

    // Handle permission inheritance if target folder is shared
    if (operation.targetFolderId) {
      await moveService.updateOperationStatus(operation.operationId, {
        currentPhase: "permission_inheritance",
        progress: 60,
      });

      // Get document owner for permission inheritance
      const [docWithOwner] = await db
        .select({ ownerId: tenantTables.documents.ownerId })
        .from(tenantTables.documents)
        .where(eq(tenantTables.documents.id, operation.documentId))
        .limit(1);

      if (docWithOwner) {
        await permissionService.handleNewDocumentInheritance(
          operation.documentId,
          operation.targetFolderId,
          docWithOwner.ownerId,
        );
      }
    }

    await moveService.updateOperationStatus(operation.operationId, {
      currentPhase: "completion",
      progress: 100,
    });
  } catch (error) {
    // ROLLBACK on ANY error
    await useLogger(LoggerLevels.error, {
      message: "Error during document move, initiating rollback",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "DOCUMENT_MOVE_ERROR_ROLLBACK",
      details: {
        documentId: operation.documentId,
        operationId: operation.operationId,
        error: error instanceof Error ? error.message : String(error),
      },
      raw: error,
    });

    await moveService.updateOperationStatus(operation.operationId, {
      status: MoveOperationStatus.ROLLING_BACK,
      rollbackReason: error instanceof Error ? error.message : String(error),
    });

    try {
      // Move document back to original location
      await db
        .update(tenantTables.documents)
        .set({
          folderId: originalFolderId,
          updatedAt: Math.floor(getTimeNow() / 1000),
        })
        .where(eq(tenantTables.documents.id, operation.documentId));

      // NOTE: rollback does not revoke inherited permissions created during the forward move.

      await useLogger(LoggerLevels.info, {
        message: "Document move rollback completed",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "DOCUMENT_MOVE_ROLLBACK_SUCCESS",
        details: { documentId: operation.documentId, operationId: operation.operationId },
      });

      await moveService.updateOperationStatus(operation.operationId, {
        status: MoveOperationStatus.FAILED,
        error: `Move failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch (rollbackError) {
      await useLogger(LoggerLevels.error, {
        message: "CRITICAL: Rollback failed for document move",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "DOCUMENT_MOVE_ROLLBACK_FAILED",
        details: {
          documentId: operation.documentId,
          operationId: operation.operationId,
          originalError: error instanceof Error ? error.message : String(error),
          rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        },
        raw: rollbackError,
      });

      await moveService.updateOperationStatus(operation.operationId, {
        status: MoveOperationStatus.FAILED,
        error: `Move failed and rollback also failed. Manual intervention required.`,
      });
    }

    throw error;
  }
}

/**
 * Process bulk document move
 */
async function processBulkDocumentMove(
  operation: MoveOperationStatusType & { operationType: "bulk_documents"; documentIds: string[]; targetFolderId: string | null },
): Promise<void> {
  const moveService = getMoveOperationService();
  const permissionService = getDocumentPermissionInheritanceService();
  const { eq, inArray } = await import("@deps");
  const { getTimeNowForStorage } = await import("@utils/shared/index.ts");

  const db = await getTenantDB();
  const originalStates: Array<{ id: string; originalFolderId: string | null }> = [];

  try {
    // Get original folder IDs BEFORE moving
    const docsBeforeMove = await db
      .select({ id: tenantTables.documents.id, folderId: tenantTables.documents.folderId })
      .from(tenantTables.documents)
      .where(inArray(tenantTables.documents.id, operation.documentIds));

    for (const doc of docsBeforeMove) {
      originalStates.push({
        id: doc.id,
        originalFolderId: doc.folderId,
      });
    }

    // Store rollback state
    const rollbackState: MoveOperationRollbackState = {
      operationId: operation.operationId,
      operationType: "bulk_documents",
      originalStates: originalStates.map((state) => ({
        id: state.id,
        type: "document" as const,
        originalFolderId: state.originalFolderId,
      })),
      createdAt: getTimeNow(),
    };
    await moveService.storeRollbackState(operation.operationId, rollbackState);

    // Perform bulk move
    await moveService.updateOperationStatus(operation.operationId, {
      currentPhase: "moving",
      progress: 20,
    });

    const now = getTimeNowForStorage();
    const movedDocuments = await db
      .update(tenantTables.documents)
      .set({
        folderId: operation.targetFolderId,
        updatedAt: now,
      })
      .where(
        inArray(tenantTables.documents.id, operation.documentIds),
      )
      .returning({ id: tenantTables.documents.id });

    const result = {
      success: movedDocuments.length === operation.documentIds.length,
      processedCount: movedDocuments.length,
      failedCount: operation.documentIds.length - movedDocuments.length,
      errors: [],
    };

    // Update progress
    await moveService.updateOperationStatus(operation.operationId, {
      processedDocuments: result.processedCount,
      failedDocuments: result.failedCount,
      progress: 50,
      currentPhase: "permission_inheritance",
    });

    // Handle permission inheritance for successfully moved documents
    if (operation.targetFolderId && result.processedCount > 0) {
      // Process permission inheritance in batches
      const batchSize = 50;
      for (let i = 0; i < operation.documentIds.length; i += batchSize) {
        const batch = operation.documentIds.slice(i, i + batchSize);

        // Get document owners
        const docs = await db
          .select({ id: tenantTables.documents.id, ownerId: tenantTables.documents.ownerId })
          .from(tenantTables.documents)
          .where(inArray(tenantTables.documents.id, batch));

        // Process inheritance for each document - ANY error will trigger rollback
        for (const doc of docs) {
          await permissionService.handleNewDocumentInheritance(
            doc.id,
            operation.targetFolderId,
            doc.ownerId,
          );
        }

        // Update progress
        const progress = 50 + Math.floor((i / operation.documentIds.length) * 40);
        await moveService.updateOperationStatus(operation.operationId, {
          progress,
        });
      }
    }

    await moveService.updateOperationStatus(operation.operationId, {
      currentPhase: "completion",
      progress: 100,
    });
  } catch (error) {
    // ROLLBACK on ANY error
    await useLogger(LoggerLevels.error, {
      message: "Error during bulk document move, initiating rollback",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "BULK_DOCUMENT_MOVE_ERROR_ROLLBACK",
      details: {
        documentCount: operation.documentIds.length,
        operationId: operation.operationId,
        error: error instanceof Error ? error.message : String(error),
      },
      raw: error,
    });

    await moveService.updateOperationStatus(operation.operationId, {
      status: MoveOperationStatus.ROLLING_BACK,
      rollbackReason: error instanceof Error ? error.message : String(error),
    });

    try {
      // Move all documents back to their original locations
      for (const state of originalStates) {
        await db
          .update(tenantTables.documents)
          .set({
            folderId: state.originalFolderId,
            updatedAt: Math.floor(getTimeNow() / 1000),
          })
          .where(eq(tenantTables.documents.id, state.id));
      }

      // NOTE: rollback does not revoke inherited permissions created during the forward move.

      await useLogger(LoggerLevels.info, {
        message: "Bulk document move rollback completed",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "BULK_DOCUMENT_MOVE_ROLLBACK_SUCCESS",
        details: {
          documentCount: originalStates.length,
          operationId: operation.operationId,
        },
      });

      await moveService.updateOperationStatus(operation.operationId, {
        status: MoveOperationStatus.FAILED,
        error: `Bulk move failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch (rollbackError) {
      await useLogger(LoggerLevels.error, {
        message: "CRITICAL: Rollback failed for bulk document move",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "BULK_DOCUMENT_MOVE_ROLLBACK_FAILED",
        details: {
          documentCount: operation.documentIds.length,
          operationId: operation.operationId,
          originalError: error instanceof Error ? error.message : String(error),
          rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        },
        raw: rollbackError,
      });

      await moveService.updateOperationStatus(operation.operationId, {
        status: MoveOperationStatus.FAILED,
        error: `Bulk move failed and rollback also failed. Manual intervention required.`,
      });
    }

    throw error;
  }
}

/**
 * Process single folder move
 */
async function processSingleFolderMove(
  operation: MoveOperationStatusType & { operationType: "single_folder"; folderId: string; targetParentFolderId: string | null },
): Promise<void> {
  const moveService = getMoveOperationService();
  const permissionService = getDocumentPermissionInheritanceService();
  const db = await getTenantDB();
  const { eq } = await import("@deps");

  let originalParentFolderId: string | null = null;

  try {
    // Get original parent folder ID BEFORE moving
    const [folder] = await db
      .select({ parentFolderId: tenantTables.documentFolders.parentFolderId })
      .from(tenantTables.documentFolders)
      .where(eq(tenantTables.documentFolders.id, operation.folderId))
      .limit(1);

    if (folder) {
      originalParentFolderId = folder.parentFolderId;
    }

    // Store rollback state
    const rollbackState: MoveOperationRollbackState = {
      operationId: operation.operationId,
      operationType: "single_folder",
      originalStates: [
        {
          id: operation.folderId,
          type: "folder",
          originalFolderId: null,
          originalParentFolderId,
        },
      ],
      createdAt: getTimeNow(),
    };
    await moveService.storeRollbackState(operation.operationId, rollbackState);

    // Perform folder move
    await moveService.updateOperationStatus(operation.operationId, {
      currentPhase: "moving",
      progress: 30,
    });

    // Perform folder move directly in database to avoid circular dependency
    await db
      .update(tenantTables.documentFolders)
      .set({
        parentFolderId: operation.targetParentFolderId,
      })
      .where(eq(tenantTables.documentFolders.id, operation.folderId));

    // Handle permission inheritance for folder hierarchy if moving into a shared folder
    if (operation.targetParentFolderId) {
      await moveService.updateOperationStatus(operation.operationId, {
        currentPhase: "permission_inheritance",
        progress: 60,
      });

      // Get all documents in this folder and its subfolders
      const descendants = await DocumentFolderCrudHelpers.getAllDescendants(
        operation.folderId,
        operation.userId,
        operation.environmentId,
      );

      // Get documents in the moved folder
      const docs = await db
        .select({ id: tenantTables.documents.id, ownerId: tenantTables.documents.ownerId })
        .from(tenantTables.documents)
        .where(eq(tenantTables.documents.folderId, operation.folderId));

      // Handle permission inheritance for all documents - ANY error will trigger rollback
      for (const doc of docs) {
        await permissionService.handleNewDocumentInheritance(
          doc.id,
          operation.folderId,
          doc.ownerId,
        );
      }

      // Handle subfolders recursively - ANY error will trigger rollback
      for (const descendant of descendants) {
        const subDocs = await db
          .select({ id: tenantTables.documents.id, ownerId: tenantTables.documents.ownerId })
          .from(tenantTables.documents)
          .where(eq(tenantTables.documents.folderId, descendant.id));

        for (const doc of subDocs) {
          await permissionService.handleNewDocumentInheritance(
            doc.id,
            descendant.id,
            doc.ownerId,
          );
        }
      }
    }

    await moveService.updateOperationStatus(operation.operationId, {
      currentPhase: "completion",
      progress: 100,
    });
  } catch (error) {
    // ROLLBACK on ANY error
    await useLogger(LoggerLevels.error, {
      message: "Error during folder move, initiating rollback",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "FOLDER_MOVE_ERROR_ROLLBACK",
      details: {
        folderId: operation.folderId,
        operationId: operation.operationId,
        error: error instanceof Error ? error.message : String(error),
      },
      raw: error,
    });

    await moveService.updateOperationStatus(operation.operationId, {
      status: MoveOperationStatus.ROLLING_BACK,
      rollbackReason: error instanceof Error ? error.message : String(error),
    });

    try {
      // Move folder back to original location
      await db
        .update(tenantTables.documentFolders)
        .set({
          parentFolderId: originalParentFolderId,
        })
        .where(eq(tenantTables.documentFolders.id, operation.folderId));

      // NOTE: rollback does not revoke inherited permissions created during the forward move.

      await useLogger(LoggerLevels.info, {
        message: "Folder move rollback completed",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "FOLDER_MOVE_ROLLBACK_SUCCESS",
        details: { folderId: operation.folderId, operationId: operation.operationId },
      });

      await moveService.updateOperationStatus(operation.operationId, {
        status: MoveOperationStatus.FAILED,
        error: `Folder move failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch (rollbackError) {
      await useLogger(LoggerLevels.error, {
        message: "CRITICAL: Rollback failed for folder move",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "FOLDER_MOVE_ROLLBACK_FAILED",
        details: {
          folderId: operation.folderId,
          operationId: operation.operationId,
          originalError: error instanceof Error ? error.message : String(error),
          rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        },
        raw: rollbackError,
      });

      await moveService.updateOperationStatus(operation.operationId, {
        status: MoveOperationStatus.FAILED,
        error: `Folder move failed and rollback also failed. Manual intervention required.`,
      });
    }

    throw error;
  }
}

/**
 * Process bulk folder move
 */
async function processBulkFolderMove(
  operation: MoveOperationStatusType & { operationType: "bulk_folders"; folderIds: string[]; targetParentFolderId: string | null },
): Promise<void> {
  const moveService = getMoveOperationService();
  const permissionService = getDocumentPermissionInheritanceService();
  const { eq, inArray } = await import("@deps");
  const db = await getTenantDB();

  const originalStates: Array<{ id: string; originalParentFolderId: string | null }> = [];

  try {
    // Get original parent folder IDs BEFORE moving any folders
    const foldersBeforeMove = await db
      .select({ id: tenantTables.documentFolders.id, parentFolderId: tenantTables.documentFolders.parentFolderId })
      .from(tenantTables.documentFolders)
      .where(inArray(tenantTables.documentFolders.id, operation.folderIds));

    for (const folder of foldersBeforeMove) {
      originalStates.push({
        id: folder.id,
        originalParentFolderId: folder.parentFolderId,
      });
    }

    // Store rollback state
    const rollbackState: MoveOperationRollbackState = {
      operationId: operation.operationId,
      operationType: "bulk_folders",
      originalStates: originalStates.map((state) => ({
        id: state.id,
        type: "folder" as const,
        originalFolderId: null,
        originalParentFolderId: state.originalParentFolderId,
      })),
      createdAt: getTimeNow(),
    };
    await moveService.storeRollbackState(operation.operationId, rollbackState);

    // Process each folder - ANY error will trigger rollback
    let processed = 0;

    for (const folderId of operation.folderIds) {
      // Perform folder move directly in database to avoid circular dependency
      await db
        .update(tenantTables.documentFolders)
        .set({
          parentFolderId: operation.targetParentFolderId,
        })
        .where(eq(tenantTables.documentFolders.id, folderId));

      // Handle permission inheritance for folder hierarchy if moving into a shared folder
      if (operation.targetParentFolderId) {
        // Get all documents in this folder and its subfolders
        const descendants = await DocumentFolderCrudHelpers.getAllDescendants(
          folderId,
          operation.userId,
          operation.environmentId,
        );

        // Get documents in the moved folder
        const docs = await db
          .select({ id: tenantTables.documents.id, ownerId: tenantTables.documents.ownerId })
          .from(tenantTables.documents)
          .where(eq(tenantTables.documents.folderId, folderId));

        // Handle permission inheritance for all documents - ANY error will trigger rollback
        for (const doc of docs) {
          await permissionService.handleNewDocumentInheritance(
            doc.id,
            folderId,
            doc.ownerId,
          );
        }

        // Handle subfolders recursively - ANY error will trigger rollback
        for (const descendant of descendants) {
          const subDocs = await db
            .select({ id: tenantTables.documents.id, ownerId: tenantTables.documents.ownerId })
            .from(tenantTables.documents)
            .where(eq(tenantTables.documents.folderId, descendant.id));

          for (const doc of subDocs) {
            await permissionService.handleNewDocumentInheritance(
              doc.id,
              descendant.id,
              doc.ownerId,
            );
          }
        }
      }

      processed++;

      // Update progress
      const progress = Math.floor((processed / operation.folderIds.length) * 90);
      await moveService.updateOperationStatus(operation.operationId, {
        processedFolders: processed,
        failedFolders: 0,
        progress,
      });
    }

    await moveService.updateOperationStatus(operation.operationId, {
      currentPhase: "completion",
      progress: 100,
    });
  } catch (error) {
    // ROLLBACK on ANY error - move ALL folders back to original locations
    await useLogger(LoggerLevels.error, {
      message: "Error during bulk folder move, initiating rollback",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "BULK_FOLDER_MOVE_ERROR_ROLLBACK",
      details: {
        folderCount: operation.folderIds.length,
        operationId: operation.operationId,
        error: error instanceof Error ? error.message : String(error),
      },
      raw: error,
    });

    await moveService.updateOperationStatus(operation.operationId, {
      status: MoveOperationStatus.ROLLING_BACK,
      rollbackReason: error instanceof Error ? error.message : String(error),
    });

    try {
      // Move all folders back to their original locations
      for (const state of originalStates) {
        await db
          .update(tenantTables.documentFolders)
          .set({
            parentFolderId: state.originalParentFolderId,
          })
          .where(eq(tenantTables.documentFolders.id, state.id));
      }

      // NOTE: rollback does not revoke inherited permissions created during the forward move.

      await useLogger(LoggerLevels.info, {
        message: "Bulk folder move rollback completed",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "BULK_FOLDER_MOVE_ROLLBACK_SUCCESS",
        details: {
          folderCount: originalStates.length,
          operationId: operation.operationId,
        },
      });

      await moveService.updateOperationStatus(operation.operationId, {
        status: MoveOperationStatus.FAILED,
        error: `Bulk folder move failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch (rollbackError) {
      await useLogger(LoggerLevels.error, {
        message: "CRITICAL: Rollback failed for bulk folder move",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "BULK_FOLDER_MOVE_ROLLBACK_FAILED",
        details: {
          folderCount: operation.folderIds.length,
          operationId: operation.operationId,
          originalError: error instanceof Error ? error.message : String(error),
          rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        },
        raw: rollbackError,
      });

      await moveService.updateOperationStatus(operation.operationId, {
        status: MoveOperationStatus.FAILED,
        error: `Bulk folder move failed and rollback also failed. Manual intervention required.`,
      });
    }

    throw error;
  }
}
