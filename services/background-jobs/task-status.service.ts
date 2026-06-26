/**
 * @file services/background-tasks/task-status.service.ts
 * @description Service for querying task status and streaming updates via SSE
 *
 * Provides real-time task status updates via Server-Sent Events (SSE).
 * Uses DB as source of truth with cache as read-through layer.
 */

import { getGlobalDB, globalTables } from "@db/index.ts";

import { eq, type HonoContext as Context, streamSSE } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/span-utils.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { type TaskState, TaskStatus } from "@interfaces/background-task.ts";
import type { Span } from "@interfaces/tracing.ts";

const TASK_CACHE_TTL = 3600; // 1 hour

/**
 * Service for querying task status and streaming updates.
 * Uses DB as source of truth with cache as read-through layer.
 */
export class TaskStatusService {
  /**
   * Get task state with authorization check.
   * Returns null if not found or unauthorized (404 pattern).
   *
   * IMPORTANT: Both userId AND environmentId must match for authorization.
   * This ensures proper multi-tenant isolation.
   */
  getTaskState(
    taskId: string,
    userId: string,
    environmentId: string,
  ): Promise<TaskState | null> {
    return tracedWithServiceErrorHandling(
      "TaskStatus.getTaskState",
      {
        service: "TaskStatus",
        method: "getTaskState",
        section: loggerAppSections.INTERNAL,
        details: { taskId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        span.attributes["task.id"] = taskId;

        // Try cache first (read-through)
        const cache = await getCache();
        const cached = await cache.get<TaskState>(
          CACHE_NAMESPACES.BACKGROUND_TASKS.STATUS,
          taskId,
        );

        if (cached) {
          // Authorization check - must match BOTH userId AND environmentId
          // Return null for unauthorized (404 pattern) to prevent information disclosure
          if (cached.userId !== userId || cached.environmentId !== environmentId) {
            return null;
          }
          return cached;
        }

        // Cache miss - query DB (source of truth)
        const [job] = await traced(
          "TaskStatus.getTaskState",
          "db.query",
          () => {
            return getGlobalDB()
              .select()
              .from(globalTables.jobs)
              .where(eq(globalTables.jobs.id, taskId))
              .limit(1);
          },
        );

        if (!job) return null;

        const meta = job.meta as Record<string, unknown> | null;

        // Authorization check - must match BOTH userId AND environmentId
        // Return null for unauthorized (404 pattern) to prevent information disclosure
        if (meta?.userId !== userId || meta?.environmentId !== environmentId) {
          return null;
        }

        // Convert to TaskState
        const state: TaskState = {
          status: job.status as TaskStatus,
          progress: (meta?.progress as number) ?? 0,
          message: meta?.message as string | undefined,
          result: meta?.result,
          userId: meta?.userId as string,
          environmentId: meta?.environmentId as string,
          createdAt: job.createdAt * 1000, // Convert from seconds to milliseconds
          updatedAt: job.updatedAt * 1000,
          startedAt: meta?.startedAt as number | undefined,
          finishedAt: meta?.finishedAt as number | undefined,
          retryCount: meta?.retryCount as number | undefined,
          maxRetries: job.maxAttempts,
        };

        // Populate cache for future reads
        await cache.set(
          CACHE_NAMESPACES.BACKGROUND_TASKS.STATUS,
          taskId,
          state,
          { ttl: TASK_CACHE_TTL },
        );

        return state;
      },
    );
  }

  /**
   * SSE streaming using polling (to be replaced with pub/sub).
   * Streams task status updates to the client in real-time.
   */
  async streamTaskStatus(
    c: Context,
    taskId: string,
    userId: string,
    environmentId: string,
  ): Promise<Response> {
    // Verify authorization first
    const state = await this.getTaskState(taskId, userId, environmentId);
    if (!state) {
      return c.json({ error: "Task not found" }, 404);
    }

    return streamSSE(c, async (stream) => {
      // Send initial state
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify(state),
      });

      // If already complete, close stream
      if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(state.status)) {
        return;
      }

      // Poll for updates (NOTE: uses polling; a pub/sub replacement is a future performance optimization.)
      const pollInterval = setInterval(async () => {
        try {
          const updatedState = await this.getTaskState(taskId, userId, environmentId);
          if (updatedState) {
            await stream.writeSSE({
              event: updatedState.status,
              data: JSON.stringify(updatedState),
            });

            if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(updatedState.status)) {
              clearInterval(pollInterval);
            }
          }
        } catch (error) {
          await useLogger(LoggerLevels.error, {
            message: "Error in task stream polling",
            section: loggerAppSections.INTERNAL,
            messageKey: "background_tasks.stream.poll_error",
            details: { taskId },
            raw: error,
          });
        }
      }, 1000);

      // Clean up on disconnect
      stream.onAbort(() => {
        clearInterval(pollInterval);
      });
    });
  }
}

// Singleton
let taskStatusService: TaskStatusService | null = null;

export function getTaskStatusService(): TaskStatusService {
  if (!taskStatusService) {
    taskStatusService = new TaskStatusService();
  }
  return taskStatusService;
}
