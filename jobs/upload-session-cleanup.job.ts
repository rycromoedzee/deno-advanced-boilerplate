/**
 * @file jobs/upload-session-cleanup.job.ts
 * @description Background job to cleanup expired upload sessions and orphaned chunks
 *
 * This job runs periodically to:
 * - Find and delete expired upload sessions from cache
 * - Delete associated temporary chunk files from storage
 * - Prevent storage bloat from abandoned uploads
 *
 * Uses distributed locking to ensure only one instance runs cleanup at a time
 * in a horizontally scaled environment.
 */

import { loggerAppSections } from "@services/logger/index.ts";
import { getCache } from "@services/cache/index.ts";
import { getUploadSessionService } from "@services/upload-processor/upload-session.service.ts";

import { getTimeNow } from "@utils/shared/index.ts";
import { acquireJobLock, releaseJobLock } from "./services/job-lock.service.ts";
import { logJobCompleted, logJobError, logJobSkipped, logJobStarted } from "./job-helpers.ts";

const FEATURE = "upload-session-cleanup";
const SECTION = loggerAppSections.DOCUMENTS;

/**
 * Cleanup job for expired upload sessions
 *
 * Uses PostgreSQL advisory locks to ensure only one instance runs cleanup at a time.
 * If another instance is already running, this function will return immediately.
 */
export async function cleanupUploadSessions() {
  const startTime = getTimeNow();

  if (!(await acquireJobLock("upload-session-cleanup"))) {
    logJobSkipped(FEATURE, SECTION, "another instance is running");
    return;
  }

  try {
    await logJobStarted(FEATURE, SECTION);

    // Get singleton cache instance and session service
    const cache = await getCache();
    const sessionService = getUploadSessionService(cache);

    // Cleanup expired sessions
    const cleanedCount = await sessionService.cleanupExpiredSessions();

    const duration = getTimeNow() - startTime;

    await logJobCompleted(FEATURE, SECTION, {
      sessionsCleanedUp: cleanedCount,
      durationMs: duration,
    });
  } catch (error) {
    const duration = getTimeNow() - startTime;

    await logJobError(FEATURE, SECTION, error, {
      durationMs: duration,
    });

    // Re-throw to ensure Deno.cron is aware of the failure
    throw error;
  } finally {
    // Always release the lock, even if cleanup failed
    await releaseJobLock("upload-session-cleanup");
  }
}
