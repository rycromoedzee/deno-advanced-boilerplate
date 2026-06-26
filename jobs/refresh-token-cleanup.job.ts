/**
 * @file jobs/refresh-token-cleanup.job.ts
 * @description Refresh Token Cleanup scheduled job
 */
/**
 * Refresh Token Cleanup Job
 *
 * Deletes expired refresh tokens from the global database.
 * Runs hourly to prevent table growth. Expired tokens already fail
 * validation, so this is housekeeping — not a correctness requirement.
 *
 * Uses distributed locking to ensure only one instance runs this job.
 */

import { loggerAppSections } from "@logger/index.ts";
import { acquireJobLock, releaseJobLock } from "./services/job-lock.service.ts";
import { logJobCompleted, logJobError, logJobSkipped, logJobStarted } from "./job-helpers.ts";
import { RefreshTokenRepository } from "@services/session/refresh-token.repository.ts";

const FEATURE = "refresh-token-cleanup";
const SECTION = loggerAppSections.AUTH;

export async function cleanupExpiredRefreshTokens(): Promise<void> {
  if (!(await acquireJobLock("refresh-token-cleanup"))) {
    await logJobSkipped(FEATURE, SECTION, "another instance is running");
    return;
  }

  const startTime = performance.now();

  try {
    await logJobStarted(FEATURE, SECTION);

    const repo = new RefreshTokenRepository();
    await repo.deleteExpired();

    const duration = performance.now() - startTime;

    await logJobCompleted(FEATURE, SECTION, {
      durationMs: duration,
    });
  } catch (error) {
    await logJobError(FEATURE, SECTION, error);
    throw error;
  } finally {
    await releaseJobLock("refresh-token-cleanup");
  }
}
