/**
 * @file jobs/trace-cleanup.job.ts
 * @description Trace Cleanup scheduled job
 */
/**
 * Trace Cleanup Job
 *
 * Automatically removes expired trace logs from the database to prevent table bloat.
 * Runs daily at 2 AM to clean up traces past their retention period.
 *
 * Uses batch processing to avoid long database locks.
 * Uses distributed locking to ensure only one instance runs this job in a horizontally scaled environment.
 */

import { getWorkerDB } from "@db/db.ts";
import { traceLogs } from "@db/schema/global/services.ts";
import { inArray, lt } from "@deps";
import { loggerAppSections } from "@logger/index.ts";
import { acquireJobLock, releaseJobLock } from "./services/job-lock.service.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { logJobBatch, logJobCompleted, logJobError, logJobSkipped, logJobStarted } from "./job-helpers.ts";

/**
 * Batch size for cleanup operations
 * Deletes this many traces at a time to avoid long DB locks
 */
const CLEANUP_BATCH_SIZE = 1000;

const FEATURE = "trace-cleanup";
const SECTION = loggerAppSections.TRACING;

/**
 * Clean up expired trace logs from the database in batches
 * Deletes traces where expires_at is less than current time
 *
 * Uses PostgreSQL advisory locks to prevent multiple instances from running concurrently.
 * If another instance is already running this job, this function will return 0 immediately.
 *
 * @param batchSize - Number of traces to delete per batch (default: 1000)
 * @returns Number of traces deleted, or 0 if lock could not be acquired
 */
export async function cleanupExpiredTraces(batchSize = CLEANUP_BATCH_SIZE): Promise<number> {
  if (!(await acquireJobLock("trace-cleanup"))) {
    await logJobSkipped(FEATURE, SECTION, "another instance is running");
    return 0;
  }

  const startTime = performance.now();

  try {
    const db = getWorkerDB();
    const now = getTimeNowForStorage();
    let totalDeleted = 0;

    await logJobStarted(FEATURE, SECTION, {
      currentTimestamp: now,
      batchSize,
    });

    while (true) {
      const expiredTraces = await db
        .select({ id: traceLogs.id })
        .from(traceLogs)
        .where(lt(traceLogs.expiresAt, now))
        .limit(batchSize);

      if (expiredTraces.length === 0) {
        break;
      }

      const traceIds = expiredTraces.map((t) => t.id);
      await db
        .delete(traceLogs)
        .where(inArray(traceLogs.id, traceIds));

      const batchDeleted = expiredTraces.length;
      totalDeleted += batchDeleted;

      await logJobBatch(FEATURE, SECTION, {
        processedCount: batchDeleted,
        totalCount: totalDeleted,
      });

      if (batchDeleted < batchSize) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const duration = performance.now() - startTime;
    const durationSeconds = (duration / 1000).toFixed(2);

    await logJobCompleted(FEATURE, SECTION, {
      deletedCount: totalDeleted,
      durationMs: duration,
      durationSeconds: parseFloat(durationSeconds),
      timestamp: now,
    });

    return totalDeleted;
  } catch (error) {
    await logJobError(FEATURE, SECTION, error);
    throw error;
  } finally {
    await releaseJobLock("trace-cleanup");
  }
}

/**
 * Manual cleanup function that can be called directly
 * Useful for testing or manual maintenance
 */
export async function manualCleanupExpiredTraces(): Promise<{
  success: boolean;
  deletedCount: number;
  error?: string;
}> {
  try {
    const deletedCount = await cleanupExpiredTraces();
    return {
      success: true,
      deletedCount,
    };
  } catch (error) {
    return {
      success: false,
      deletedCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get statistics about trace storage
 * Useful for monitoring storage usage
 */
export async function getTraceStorageStats(): Promise<{
  totalTraces: number;
  expiredTraces: number;
  activeTraces: number;
  oldestTrace?: number;
  newestTrace?: number;
}> {
  try {
    const db = getWorkerDB();
    const now = Math.floor(Date.now() / 1000);

    const allTraces = await db.select({
      createdAt: traceLogs.createdAt,
      expiresAt: traceLogs.expiresAt,
    }).from(traceLogs);

    const totalTraces = allTraces.length;
    const expiredTraces = allTraces.filter((t) => t.expiresAt && t.expiresAt < now).length;
    const activeTraces = totalTraces - expiredTraces;

    const timestamps = allTraces.map((t) => Number(t.createdAt));
    const oldestTrace = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
    const newestTrace = timestamps.length > 0 ? Math.max(...timestamps) : undefined;

    return {
      totalTraces,
      expiredTraces,
      activeTraces,
      oldestTrace,
      newestTrace,
    };
  } catch (error) {
    await logJobError(FEATURE, SECTION, error);
    return {
      totalTraces: 0,
      expiredTraces: 0,
      activeTraces: 0,
    };
  }
}
