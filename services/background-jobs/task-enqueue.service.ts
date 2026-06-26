/**
 * @file services/background-tasks/task-enqueue.service.ts
 * @description Service for enqueueing and processing background tasks
 *
 * This service orchestrates background task processing in a way that's compatible
 * with scale-to-zero environments:
 *
 * 1. Tasks are stored in DB (source of truth) and enqueued to queue provider
 * 2. A processor is triggered (fire & forget) to process the queue
 * 3. The processor runs until the queue is empty, then stops
 * 4. Multiple parallel instances safely compete for tasks via atomic dequeue
 * 5. Task state is cached for fast reads and SSE streaming
 */

import { getGlobalDB, globalTables } from "@db/index.ts";

import { eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/span-utils.ts";
import { DB_ENUM_JOB_STATUS } from "@db/enums/index.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import {
  type BackgroundTask,
  type TaskEnqueueResult,
  type TaskOptions,
  type TaskQueueProvider,
  type TaskState,
  TaskStatus,
} from "@interfaces/background-task.ts";
import type { BaseTaskHandler } from "./base-task-handler.ts";
import type { Span } from "@interfaces/tracing.ts";
import { createCancellationToken } from "./utils/cancellation-token.ts";
import { TaskCancelledError } from "./base-task-handler.ts";

const TASK_CACHE_TTL = 3600; // 1 hour

/**
 * Service for enqueueing and processing background tasks.
 * Uses DB as source of truth with cache as read-through layer.
 */
export class TaskEnqueueService {
  private isProcessing = false;

  constructor(
    private queueProvider: TaskQueueProvider,
    private getHandler: (taskType: string) => BaseTaskHandler<unknown, unknown> | undefined,
    private config: {
      taskTimeout?: number;
      retryOnFailure?: boolean;
      maxRetries?: number;
      retryDelay?: number;
    } = {},
  ) {}

  /**
   * Enqueue a new task for processing.
   * Both userId AND environmentId are REQUIRED for proper multi-tenant isolation.
   */
  enqueueTask<TInput>(
    taskType: string,
    input: TInput,
    options: TaskOptions,
  ): Promise<TaskEnqueueResult> {
    return tracedWithServiceErrorHandling(
      "TaskEnqueue.enqueueTask",
      {
        service: "TaskEnqueue",
        method: "enqueueTask",
        section: loggerAppSections.INTERNAL,
        details: { taskType, userId: options.userId, environmentId: options.environmentId },
      },
      "JOBS.ENQUEUE_FAILED",
      async (span: Span) => {
        span.attributes["task.type"] = taskType;
        span.attributes["task.userId"] = options.userId;
        span.attributes["task.environmentId"] = options.environmentId;

        const handler = this.getHandler(taskType) as BaseTaskHandler<TInput, unknown> | undefined;
        if (!handler) {
          throwHttpError("JOBS.HANDLER_NOT_FOUND");
        }

        // Validate input against handler schema
        const validatedInput = handler.inputSchema.parse(input);

        const taskId = crypto.randomUUID();
        const now = Date.now();

        // 1. Create DB record (source of truth)
        await traced(
          "TaskEnqueue.enqueueTask",
          "db.query",
          () => {
            return getGlobalDB().insert(globalTables.jobs).values({
              id: taskId,
              type: taskType,
              data: validatedInput,
              status: DB_ENUM_JOB_STATUS.PENDING,
              maxAttempts: handler.maxRetries ?? this.config.maxRetries ?? 3,
              meta: {
                userId: options.userId,
                environmentId: options.environmentId,
                resultType: handler.resultType,
                progress: 0,
                message: "Task queued",
                createdAt: now,
              },
            });
          },
        );

        // 2. Enqueue to queue provider
        const task: BackgroundTask<TInput> = {
          id: taskId,
          type: taskType,
          data: validatedInput,
          createdAt: now,
          userId: options.userId,
          environmentId: options.environmentId,
          priority: options.priority,
          metadata: options.metadata,
        };
        await this.queueProvider.enqueue(task);

        // 3. Populate cache for fast reads
        const cache = await getCache();
        const initialState: TaskState = {
          status: TaskStatus.PENDING,
          progress: 0,
          message: "Task queued",
          userId: options.userId,
          environmentId: options.environmentId,
          createdAt: now,
          updatedAt: now,
        };
        await cache.set(
          CACHE_NAMESPACES.BACKGROUND_TASKS.STATUS,
          taskId,
          initialState,
          { ttl: TASK_CACHE_TTL },
        );

        // 4. Trigger processor (fire & forget)
        this.processQueue().catch((error) => {
          useLogger(LoggerLevels.error, {
            message: "Background task processing error",
            section: loggerAppSections.INTERNAL,
            messageKey: "background_tasks.processing_error",
            raw: error,
          });
        });

        await useLogger(LoggerLevels.info, {
          message: "Background task enqueued",
          section: loggerAppSections.INTERNAL,
          messageKey: "background_tasks.enqueue",
          details: {
            taskId,
            taskType,
            userId: options.userId,
            environmentId: options.environmentId,
          },
        });

        return {
          taskId,
          statusUrl: `/api/jobs/${taskId}/status`,
          streamUrl: `/api/jobs/${taskId}/stream`,
        };
      },
    );
  }

  /**
   * Process tasks from queue until empty (scale-to-zero compatible).
   */
  async processQueue(): Promise<void> {
    // Prevent multiple processors in same instance
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Process until queue is empty
      while (true) {
        const task = await this.queueProvider.dequeue();

        if (!task) {
          // Queue is empty, stop processing
          break;
        }

        // Process this task
        await this.processTask(task as BackgroundTask<unknown>);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single task with cancellation support.
   */
  private async processTask(task: BackgroundTask<unknown>): Promise<void> {
    const handler = this.getHandler(task.type);

    if (!handler) {
      await this.updateTaskState(task.id, {
        status: TaskStatus.FAILED,
        error: {
          message: `No handler registered for task type: ${task.type}`,
          code: "NO_HANDLER",
        },
        finishedAt: Date.now(),
      });

      await useLogger(LoggerLevels.error, {
        message: "No handler found for task type",
        section: loggerAppSections.INTERNAL,
        messageKey: "background_tasks.no_handler",
        details: {
          taskId: task.id,
          taskType: task.type,
        },
      });

      return;
    }

    // Get current task state from DB to check retry count
    const [jobRecord] = await traced(
      "TaskEnqueue.processTask",
      "db.query",
      () => {
        return getGlobalDB()
          .select()
          .from(globalTables.jobs)
          .where(eq(globalTables.jobs.id, task.id))
          .limit(1);
      },
    );

    const meta = jobRecord?.meta as Record<string, unknown> | null;
    const retryCount = (meta?.retryCount as number) ?? 0;

    // Update to processing state
    await this.updateTaskState(task.id, {
      status: TaskStatus.PROCESSING,
      message: retryCount > 0 ? `Processing task (retry ${retryCount}/${handler.maxRetries ?? 3})` : "Processing task",
      startedAt: Date.now(),
    });

    // Create cancellation token
    const cancellationToken = createCancellationToken(task.id);

    try {
      // Create progress update callback
      const updateProgress = async (
        progress: number,
        message?: string,
      ): Promise<void> => {
        await this.updateTaskState(task.id, {
          progress: Math.min(100, Math.max(0, progress)),
          message,
        });
      };

      // Execute with timeout
      const timeout = this.config.taskTimeout ?? 5 * 60 * 1000; // 5 minutes default
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Task execution timeout")),
          timeout,
        )
      );

      const result = await Promise.race([
        handler.run(task, updateProgress, cancellationToken),
        timeoutPromise,
      ]);

      // Task completed successfully
      await this.updateTaskState(task.id, {
        status: TaskStatus.COMPLETED,
        progress: 100,
        message: "Task completed successfully",
        result,
        finishedAt: Date.now(),
      });

      await useLogger(LoggerLevels.info, {
        message: "Background task completed",
        section: loggerAppSections.INTERNAL,
        messageKey: "background_tasks.completed",
        details: {
          taskId: task.id,
          taskType: task.type,
          duration: Date.now() - task.createdAt,
          retryCount,
        },
      });
    } catch (error) {
      // Handle cancellation
      if (error instanceof TaskCancelledError) {
        await this.updateTaskState(task.id, {
          status: TaskStatus.CANCELLED,
          message: "Task was cancelled",
          finishedAt: Date.now(),
        });

        await useLogger(LoggerLevels.info, {
          message: "Background task cancelled",
          section: loggerAppSections.INTERNAL,
          messageKey: "background_tasks.cancelled",
          details: {
            taskId: task.id,
            taskType: task.type,
          },
        });
        return;
      }

      // Check if we should retry
      const maxRetries = handler.maxRetries ?? this.config.maxRetries ?? 3;
      if (this.config.retryOnFailure !== false && retryCount < maxRetries) {
        await this.handleTaskRetry(task, error, retryCount, maxRetries);
      } else {
        // Final failure - no more retries
        await this.handleTaskFailure(task, error, retryCount);
      }
    }
  }

  /**
   * Sanitize error for storage (remove stack traces and sensitive data)
   */
  private sanitizeErrorForStorage(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        // Explicitly exclude stack trace for security
      };
    }
    if (typeof error === "object" && error !== null) {
      // For object errors, only keep safe properties
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(error as Record<string, unknown>)) {
        // Only include primitive values, exclude potentially sensitive keys
        if (
          !["stack", "password", "token", "secret", "key", "credential"].some((k) => key.toLowerCase().includes(k)) &&
          (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        ) {
          sanitized[key] = value;
        }
      }
      return sanitized;
    }
    return { value: String(error) };
  }

  /**
   * Handle task retry with exponential backoff
   */
  private async handleTaskRetry(
    task: BackgroundTask<unknown>,
    error: unknown,
    currentRetryCount: number,
    maxRetries: number,
  ): Promise<void> {
    const nextRetryCount = currentRetryCount + 1;

    // Calculate exponential backoff delay: base * (2 ^ retryCount)
    // With jitter to prevent thundering herd
    const baseDelay = this.config.retryDelay ?? 1000;
    const exponentialDelay = baseDelay * Math.pow(2, currentRetryCount);
    const jitter = Math.random() * 1000; // Random 0-1000ms
    const delayMs = exponentialDelay + jitter;

    await this.updateTaskState(task.id, {
      status: TaskStatus.PENDING,
      message: `Task failed, retrying in ${Math.round(delayMs / 1000)}s (attempt ${nextRetryCount}/${maxRetries})`,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: "EXECUTION_ERROR_RETRYING",
        details: this.sanitizeErrorForStorage(error),
      },
      retryCount: nextRetryCount,
      nextRetryAt: Date.now() + delayMs,
    });

    await useLogger(LoggerLevels.warn, {
      message: "Background task failed, scheduling retry",
      section: loggerAppSections.INTERNAL,
      messageKey: "background_tasks.retry_scheduled",
      details: {
        taskId: task.id,
        taskType: task.type,
        retryCount: nextRetryCount,
        maxRetries,
        delayMs: Math.round(delayMs),
      },
      raw: error,
    });

    // Schedule retry after delay
    setTimeout(async () => {
      try {
        await this.queueProvider.enqueue(task);

        await useLogger(LoggerLevels.info, {
          message: "Task re-enqueued for retry",
          section: loggerAppSections.INTERNAL,
          messageKey: "background_tasks.retry_enqueued",
          details: {
            taskId: task.id,
            retryCount: nextRetryCount,
          },
        });
      } catch (enqueueError) {
        await useLogger(LoggerLevels.error, {
          message: "Failed to re-enqueue task for retry",
          section: loggerAppSections.INTERNAL,
          messageKey: "background_tasks.retry_enqueue_failed",
          details: {
            taskId: task.id,
            retryCount: nextRetryCount,
          },
          raw: enqueueError,
        });
      }
    }, delayMs);
  }

  /**
   * Handle final task failure (no more retries)
   */
  private async handleTaskFailure(
    task: BackgroundTask<unknown>,
    error: unknown,
    retryCount: number,
  ): Promise<void> {
    await this.updateTaskState(task.id, {
      status: TaskStatus.FAILED,
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: "EXECUTION_ERROR",
        details: this.sanitizeErrorForStorage(error),
      },
      finishedAt: Date.now(),
    });

    await useLogger(LoggerLevels.error, {
      message: "Background task failed permanently",
      section: loggerAppSections.INTERNAL,
      messageKey: "background_tasks.failed",
      details: {
        taskId: task.id,
        taskType: task.type,
        duration: Date.now() - task.createdAt,
        retryCount,
      },
      raw: error,
    });
  }

  /**
   * Update task state in DB and cache.
   */
  private async updateTaskState(
    taskId: string,
    updates: Partial<TaskState>,
  ): Promise<void> {
    const now = Date.now();

    // Update DB (source of truth)
    await traced(
      "TaskEnqueue.updateTaskState",
      "db.query",
      async () => {
        // Get current state
        const [currentJob] = await getGlobalDB()
          .select()
          .from(globalTables.jobs)
          .where(eq(globalTables.jobs.id, taskId))
          .limit(1);

        if (!currentJob) {
          useLogger(LoggerLevels.warn, {
            message: "Task state not found for task",
            section: loggerAppSections.INTERNAL,
            messageKey: "background_tasks.state_not_found",
            details: { taskId },
          });
          return;
        }

        const currentMeta = currentJob.meta as Record<string, unknown> | null;
        const newMeta = {
          ...currentMeta,
          ...updates,
          updatedAt: now,
        };

        // Map status string to numeric
        let newStatus = currentJob.status;
        if (updates.status) {
          switch (updates.status) {
            case TaskStatus.PENDING:
              newStatus = DB_ENUM_JOB_STATUS.PENDING;
              break;
            case TaskStatus.PROCESSING:
              newStatus = DB_ENUM_JOB_STATUS.PROCESSING;
              break;
            case TaskStatus.COMPLETED:
              newStatus = DB_ENUM_JOB_STATUS.COMPLETED;
              break;
            case TaskStatus.FAILED:
              newStatus = DB_ENUM_JOB_STATUS.FAILED;
              break;
            case TaskStatus.CANCELLED:
              newStatus = DB_ENUM_JOB_STATUS.CANCELLED;
              break;
          }
        }

        return getGlobalDB()
          .update(globalTables.jobs)
          .set({
            status: newStatus,
            meta: newMeta,
            updatedAt: Math.floor(now / 1000),
          })
          .where(eq(globalTables.jobs.id, taskId));
      },
    );

    // Update cache
    const cache = await getCache();
    const currentState = await cache.get<TaskState>(
      CACHE_NAMESPACES.BACKGROUND_TASKS.STATUS,
      taskId,
    );

    if (currentState) {
      const newState: TaskState = {
        ...currentState,
        ...updates,
        updatedAt: now,
      };
      await cache.set(
        CACHE_NAMESPACES.BACKGROUND_TASKS.STATUS,
        taskId,
        newState,
        { ttl: TASK_CACHE_TTL },
      );
    }
  }

  /**
   * Close queue provider
   */
  async close(): Promise<void> {
    await this.queueProvider.close();
  }
}
