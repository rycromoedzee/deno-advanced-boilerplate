/**
 * @file interfaces/background-task.ts
 * @description Background task system interfaces for scale-to-zero compatible async processing
 *
 * This system enables long-running operations (like PDF generation) to be processed
 * asynchronously without blocking API requests. It's designed to work in a scale-to-zero
 * environment where background workers only run when tasks exist.
 *
 * Key principles:
 * - DB is the single source of truth (jobs table)
 * - Cache is a read-through layer for performance
 * - Pub/Sub is used for real-time SSE updates
 * - Both userId AND environmentId are required for authorization
 */

import type { z } from "@deps";

/**
 * Task status enum - represents the lifecycle of a background task
 */
export enum TaskStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

/**
 * Task result type - determines how the result is delivered
 */
export enum TaskResultType {
  JSON = "json", // Return JSON data
  DOWNLOAD = "download", // Return file download URL
  NOTIFICATION = "notification", // Just a status message
}

/**
 * Base background task structure
 * @template TData The type of data payload for the task
 */
export interface BackgroundTask<TData = unknown> {
  /** Unique identifier for the task */
  id: string;

  /** Task type identifier (e.g., 'pdf-export', 'data-export') */
  type: string;

  /** Task-specific data payload */
  data: TData;

  /** Timestamp when task was created (milliseconds since epoch) */
  createdAt: number;

  /** Optional priority (higher = more urgent) */
  priority?: number;

  /** User ID who owns this task - REQUIRED for authorization */
  userId?: string;

  /** Environment ID for multi-tenant isolation - REQUIRED */
  environmentId?: string;

  /** Optional metadata for tracking */
  metadata?: Record<string, unknown>;
}

/**
 * Task metadata stored in the jobs table meta column
 */
export interface TaskMeta {
  /** User ID who owns this task - REQUIRED for authorization */
  userId: string;

  /** Environment ID for multi-tenant isolation - REQUIRED */
  environmentId: string;

  /** Result type for response shaping */
  resultType: TaskResultType;

  /** Task result (JSON, download URL, etc.) */
  result?: unknown;

  /** Progress percentage (0-100) */
  progress: number;

  /** Human-readable status message */
  message?: string;

  /** Timestamp when task was created */
  createdAt: number;

  /** Timestamp when processing started */
  startedAt?: number;

  /** Timestamp when task completed/failed */
  finishedAt?: number;

  /** Timestamp if cancelled */
  cancelledAt?: number;
}

/**
 * Task state - stored in cache for SSE streaming and status tracking
 * This is the client-facing representation of task state
 */
export interface TaskState {
  /** Current status of the task */
  status: TaskStatus;

  /** Progress percentage (0-100) */
  progress?: number;

  /** Human-readable status message */
  message?: string;

  /** Result data when completed (e.g., download URL) */
  result?: unknown;

  /** Error information if failed */
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };

  /** Timestamp when state was last updated */
  updatedAt: number;

  /** Timestamp when task was created */
  createdAt: number;

  /** Timestamp when processing started */
  startedAt?: number;

  /** Timestamp when task completed or failed */
  finishedAt?: number;

  /** User ID who owns this task (for authorization) - REQUIRED in new system */
  userId?: string;

  /** Environment ID for multi-tenant isolation - REQUIRED in new system */
  environmentId?: string;

  /** Number of retry attempts (for exponential backoff) */
  retryCount?: number;

  /** Maximum retry attempts allowed */
  maxRetries?: number;

  /** Next retry timestamp (if retrying) */
  nextRetryAt?: number;
}

/**
 * Task queue provider interface - abstracts queue operations
 * Implementations must ensure atomic dequeue for multi-instance safety
 */
export interface TaskQueueProvider {
  /**
   * Add a task to the queue
   * @param task The task to enqueue
   */
  enqueue(task: BackgroundTask): Promise<void>;

  /**
   * Remove and return the next task from the queue (MUST be atomic)
   * Returns null if queue is empty
   *
   * IMPORTANT: In a multi-instance environment, this operation must be atomic
   * to prevent two workers from processing the same task.
   */
  dequeue(): Promise<BackgroundTask | null>;

  /**
   * Peek at the next task without removing it
   */
  peek(): Promise<BackgroundTask | null>;

  /**
   * Get the current queue length
   */
  length(): Promise<number>;

  /**
   * Clear all tasks from the queue
   */
  clear(): Promise<void>;

  /**
   * Close queue connections
   */
  close(): Promise<void>;
}

/**
 * Task handler function type
 * Handlers process specific task types and update progress via callbacks
 */
export type TaskHandler<TData = unknown, TResult = unknown> = (
  task: BackgroundTask<TData>,
  updateProgress: (progress: number, message?: string) => Promise<void>,
) => Promise<TResult>;

/**
 * Task processor configuration
 */
export interface TaskProcessorConfig {
  /** Maximum concurrent tasks (default: 1 for sequential processing) */
  maxConcurrency?: number;

  /** Timeout for individual tasks in milliseconds (default: 5 minutes) */
  taskTimeout?: number;

  /** Retry failed tasks (default: false) */
  retryOnFailure?: boolean;

  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;

  /** Backoff delay between retries in ms (default: 1000) */
  retryDelay?: number;
}

/**
 * Options for enqueuing a new task
 */
export interface TaskOptions {
  /** User ID who owns this task - REQUIRED for authorization */
  userId: string;

  /** Environment ID for multi-tenant isolation - REQUIRED */
  environmentId: string;

  /** Optional priority (higher = more urgent) */
  priority?: number;

  /** Optional additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of enqueuing a task
 */
export interface TaskEnqueueResult {
  /** Unique identifier for the task */
  taskId: string;

  /** URL to get task status */
  statusUrl: string;

  /** URL to stream task updates via SSE */
  streamUrl: string;
}

/**
 * Result of requesting task cancellation
 */
export interface CancellationResult {
  /** Whether cancellation was successful */
  success: boolean;

  /** Reason for failure if success is false */
  reason?: "not_found" | "already_completed" | "already_cancelled" | "already_failed";
}

/**
 * Context passed to task handlers during execution
 */
export interface TaskContext {
  /** Task ID */
  taskId: string;

  /** User ID who owns this task */
  userId?: string;

  /** Environment ID for multi-tenant isolation */
  environmentId?: string;

  /** Callback to update task progress */
  updateProgress: (progress: number, message?: string) => Promise<void>;
}

/**
 * Cancellation token interface for efficient cancellation checking
 */
export interface CancellationToken {
  /**
   * Check if task has been cancelled
   * Uses cached flag with periodic DB sync for efficiency
   */
  isCancelled(): Promise<boolean>;

  /**
   * Mark as cancelled immediately (called via pub/sub)
   */
  markCancelled(): void;
}

/**
 * SSE event types for task streaming
 */
export enum TaskEventType {
  /** Task status changed */
  STATUS = "status",

  /** Task progress updated */
  PROGRESS = "progress",

  /** Task completed successfully */
  COMPLETED = "completed",

  /** Task failed */
  FAILED = "failed",

  /** Task was cancelled */
  CANCELLED = "cancelled",

  /** Connection established */
  CONNECTED = "connected",
}

/**
 * SSE event structure
 */
export interface TaskEvent {
  /** Event type */
  type: TaskEventType;

  /** Event data */
  data: TaskState;

  /** Event timestamp */
  timestamp: number;
}

/**
 * Base interface for task handler definitions
 * Used by the handler registry
 */
export interface ITaskHandlerDefinition<TInput = unknown, TResult = unknown> {
  /** Unique task type identifier */
  readonly taskType: string;

  /** Human-readable description */
  readonly description: string;

  /** Zod schema for input validation */
  readonly inputSchema: z.ZodSchema<TInput>;

  /** Result type for response shaping */
  readonly resultType: TaskResultType;

  /** Maximum retry attempts (optional) */
  readonly maxRetries?: number;

  /**
   * Execute the task
   * @param input Validated input data
   * @param context Task execution context
   * @returns Task result
   */
  execute(input: TInput, context: TaskContext): Promise<TResult>;
}
