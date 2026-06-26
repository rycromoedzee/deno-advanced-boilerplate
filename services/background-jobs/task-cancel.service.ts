/**
 * @file services/background-tasks/task-cancel.service.ts
 * @description Service for handling task cancellation requests
 *
 * Handles cancellation with proper status updates in DB and cache.
 * Returns 404 for unauthorized access (not 403) to prevent information disclosure.
 */

import { getGlobalDB, globalTables } from "@db/index.ts";

import { eq, sql } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/span-utils.ts";
import { DB_ENUM_JOB_STATUS } from "@db/enums/index.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { getPubSubService } from "@services/shared/pubsub.factory.ts";
import type { CancellationResult } from "@interfaces/background-task.ts";
import type { Span } from "@interfaces/tracing.ts";

/**
 * Service for handling task cancellation requests.
 */
export class TaskCancelService {
  /**
   * Request cancellation of a task.
   * Returns 404 for unauthorized access (not 403).
   *
   * IMPORTANT: Both userId AND environmentId must match for authorization.
   * This ensures proper multi-tenant isolation.
   */
  requestCancellation(
    taskId: string,
    userId: string,
    environmentId: string,
  ): Promise<CancellationResult> {
    return tracedWithServiceErrorHandling(
      "TaskCancel.requestCancellation",
      {
        service: "TaskCancel",
        method: "requestCancellation",
        section: loggerAppSections.INTERNAL,
        details: { taskId },
      },
      "JOBS.CANCEL_FAILED",
      async (span: Span) => {
        span.attributes["task.id"] = taskId;

        // Get current task state
        const [job] = await traced(
          "TaskCancel.requestCancellation",
          "db.query",
          () => {
            return getGlobalDB()
              .select()
              .from(globalTables.jobs)
              .where(eq(globalTables.jobs.id, taskId))
              .limit(1);
          },
        );

        if (!job) {
          return { success: false, reason: "not_found" };
        }

        const meta = job.meta as Record<string, unknown> | null;

        // Authorization check - must match BOTH userId AND environmentId
        // Return not_found for unauthorized (404 pattern) to prevent information disclosure
        if (meta?.userId !== userId || meta?.environmentId !== environmentId) {
          return { success: false, reason: "not_found" };
        }

        // Check if already in terminal state
        if (job.status === DB_ENUM_JOB_STATUS.COMPLETED) {
          return { success: false, reason: "already_completed" };
        }
        if (job.status === DB_ENUM_JOB_STATUS.CANCELLED) {
          return { success: false, reason: "already_cancelled" };
        }
        if (job.status === DB_ENUM_JOB_STATUS.FAILED) {
          return { success: false, reason: "already_failed" };
        }

        // Update DB with cancellation
        const now = Date.now();
        await traced(
          "TaskCancel.requestCancellation",
          "db.query",
          () => {
            return getGlobalDB()
              .update(globalTables.jobs)
              .set({
                status: DB_ENUM_JOB_STATUS.CANCELLED,
                meta: sql`jsonb_set(
                  COALESCE(meta, '{}'::jsonb),
                  '{cancelledAt}',
                  ${now}::jsonb
                )`,
                updatedAt: Math.floor(now / 1000),
              })
              .where(eq(globalTables.jobs.id, taskId));
          },
        );

        // Invalidate cache
        const cache = await getCache();
        await cache.delete(CACHE_NAMESPACES.BACKGROUND_TASKS.STATUS, taskId);

        getPubSubService()
          .then((pubSub) =>
            pubSub.publish(
              `task:${taskId}:cancel`,
              JSON.stringify({ cancelled: true, taskId }),
            )
          )
          .catch(() => {});

        await useLogger(LoggerLevels.info, {
          message: "Task cancellation requested",
          section: loggerAppSections.INTERNAL,
          messageKey: "background_tasks.cancelled",
          details: {
            taskId,
            userId,
            environmentId,
          },
        });

        return { success: true };
      },
    );
  }
}

// Singleton
let taskCancelService: TaskCancelService | null = null;

export function getTaskCancelService(): TaskCancelService {
  if (!taskCancelService) {
    taskCancelService = new TaskCancelService();
  }
  return taskCancelService;
}
