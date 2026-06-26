/**
 * @file services/background-tasks/utils/cancellation-token.ts
 * @description Cancellation token with cached state for efficient cancellation checking
 *
 * Instead of a DB query on every check, this token caches the cancelled state
 * and syncs with DB periodically to catch external cancellations.
 */

import { getGlobalDB, globalTables } from "@db/index.ts";

import { eq } from "@deps";
import { traced } from "@services/tracing/span-utils.ts";
import { DB_ENUM_JOB_STATUS } from "@db/enums/index.ts";
import type { CancellationToken as ICancellationToken } from "@interfaces/background-task.ts";

/**
 * Cancellation token with cached state for efficient checking.
 * Syncs with DB periodically to catch external cancellations.
 */
export class CancellationToken implements ICancellationToken {
  private cancelled: boolean = false;
  private lastCheck: number = 0;
  private readonly checkIntervalMs: number;

  constructor(
    private readonly taskId: string,
    checkIntervalMs: number = 5000, // Check DB every 5 seconds max
  ) {
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Check if task has been cancelled.
   * Returns cached value if checked recently, otherwise syncs with DB.
   */
  async isCancelled(): Promise<boolean> {
    // Return cached value if already cancelled or checked recently
    if (this.cancelled || Date.now() - this.lastCheck < this.checkIntervalMs) {
      return this.cancelled;
    }

    // Periodically sync with DB - wrapped in traced() for observability
    this.lastCheck = Date.now();
    const [job] = await traced(
      "CancellationToken.isCancelled",
      "db.query",
      () => {
        return getGlobalDB()
          .select({ status: globalTables.jobs.status, meta: globalTables.jobs.meta })
          .from(globalTables.jobs)
          .where(eq(globalTables.jobs.id, this.taskId))
          .limit(1);
      },
    );

    if (job) {
      this.cancelled = job.status === DB_ENUM_JOB_STATUS.CANCELLED ||
        (job.meta as Record<string, unknown> | null)?.cancelledAt !== undefined;
    }

    return this.cancelled;
  }

  /**
   * Mark as cancelled immediately (called via pub/sub).
   * Use this for instant response to cancellation events.
   */
  markCancelled(): void {
    this.cancelled = true;
  }
}

/**
 * Create a cancellation token for a task
 * @param taskId Task ID to monitor for cancellation
 * @param checkIntervalMs Optional interval for DB sync (default: 5000ms)
 */
export function createCancellationToken(
  taskId: string,
  checkIntervalMs?: number,
): CancellationToken {
  return new CancellationToken(taskId, checkIntervalMs);
}
