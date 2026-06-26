/**
 * @file interfaces/move-operations.ts
 * @description Types and interfaces for async move operations with cache-based status tracking
 *
 * Covers single/bulk document and folder moves with:
 * - Cache-based status tracking
 * - Progress updates via SSE
 * - Rollback state management
 */

/**
 * The type of move operation being performed
 */
export type MoveOperationType =
  | "single_document"
  | "bulk_documents"
  | "single_folder"
  | "bulk_folders";

/**
 * Current status of a move operation
 */
export enum MoveOperationStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
  ROLLING_BACK = "rolling_back",
}

/**
 * The current phase within a move operation's lifecycle
 */
export type MoveOperationPhase =
  | "initialization"
  | "validation"
  | "processing"
  | "moving"
  | "permission_inheritance"
  | "completion"
  | "finalization"
  | "rollback";

/**
 * Parameters for initiating a new move operation
 */
export interface InitiateMoveOperationParams {
  /** Type of move operation */
  operationType: MoveOperationType;
  /** User ID initiating the move */
  userId: string;
  /** Environment ID for multi-tenant isolation */
  environmentId: string;

  // Single document
  documentId?: string;
  targetFolderId?: string | null;

  // Bulk documents
  documentIds?: string[];

  // Single folder
  folderId?: string;
  targetParentFolderId?: string | null;

  // Bulk folders
  folderIds?: string[];
}

/**
 * Result returned after initiating a move operation
 */
export interface InitiateMoveOperationResult {
  /** Unique identifier for this operation */
  operationId: string;
  /** Current status of the operation */
  status: MoveOperationStatus | "pending" | "processing";
  /** ISO timestamp of estimated completion */
  estimatedCompletion: string;
  /** Total number of items in the operation (for bulk) */
  totalItems?: number;
  /** Human-readable message about the operation */
  message: string;
}

/**
 * Full status record for a move operation stored in cache
 */
export type MoveOperationStatusType = {
  /** Unique operation identifier */
  operationId: string;
  /** User ID who initiated the operation */
  userId: string;
  /** Environment ID */
  environmentId: string;
  /** Type of operation */
  operationType: MoveOperationType;
  /** Current status */
  status: MoveOperationStatus;
  /** Creation timestamp (ms since epoch) */
  createdAt: number;
  /** Last update timestamp (ms since epoch) */
  updatedAt: number;
  /** Progress percentage (0-100) */
  progress: number;
  /** Current phase of the operation */
  currentPhase: MoveOperationPhase;
  /** Timestamp when operation completed (ms since epoch) */
  completedAt?: number;
  /** Timestamp when operation started (ms since epoch) */
  startedAt?: number;
  /** Error message if the operation failed */
  error?: string;
  /** Reason for rollback if the operation was rolled back */
  rollbackReason?: string;

  // Single document fields
  documentId?: string;
  targetFolderId?: string | null;
  originalFolderId?: string | null;

  // Bulk document fields
  documentIds?: string[];
  totalDocuments?: number;
  processedDocuments?: number;
  failedDocuments?: number;

  // Single folder fields
  folderId?: string;
  targetParentFolderId?: string | null;
  originalParentFolderId?: string | null;
  totalItems?: number;
  processedItems?: number;

  // Bulk folder fields
  folderIds?: string[];
  totalFolders?: number;
  processedFolders?: number;
  failedFolders?: number;
};

/**
 * Rollback state for a move operation, enabling undo on failure
 */
export interface MoveOperationRollbackState {
  /** The operation this rollback state belongs to */
  operationId: string;
  /** Type of operation */
  operationType: MoveOperationType;
  /** Snapshot of original locations before the move */
  originalStates: Array<{
    /** Item ID (document or folder) */
    id: string;
    /** Type of item */
    type: "document" | "folder";
    /** Original folder ID (for documents) */
    originalFolderId: string | null;
    /** Original parent folder ID (for folders) */
    originalParentFolderId?: string | null;
  }>;
  /** Timestamp when rollback state was captured */
  createdAt: number;
}

/**
 * SSE event types for move operation streaming
 */
export enum MoveOperationSSEEventType {
  /** Operation started */
  MOVE_STARTED = "move_started",
  /** Progress update */
  PROGRESS = "progress",
  /** Operation completed successfully */
  COMPLETED = "completed",
  /** Operation failed */
  FAILED = "failed",
  /** Operation was cancelled */
  CANCELLED = "cancelled",
  /** Move completed (alias for specific move completion events) */
  MOVE_COMPLETED = "move_completed",
  /** Move failed (alias for specific move failure events) */
  MOVE_FAILED = "move_failed",
}

/**
 * SSE event structure for move operations
 */
export interface MoveOperationSSEEvent {
  /** Event type */
  type: MoveOperationSSEEventType;
  /** Operation ID this event relates to */
  operationId: string;
  /** Event timestamp (ms since epoch) */
  timestamp: number;
  /** Partial status data for the event */
  data: Partial<MoveOperationStatusType>;
}
