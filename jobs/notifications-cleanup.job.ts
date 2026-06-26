/**
 * @file jobs/notifications-cleanup.job.ts
 * @description Notifications Cleanup scheduled job
 */
/**
 * Notifications Cleanup Job
 *
 * Deletes dismissed notifications older than the retention period.
 * Runs daily at 3:30 AM to clean up dismissed notifications.
 *
 * Iterates every active tenant environment because `notifications` is a
 * tenant-scoped table.
 * Uses batch processing to avoid long database locks.
 * Uses distributed locking to ensure only one instance runs this job.
 */

import { getGlobalDB, getTenantDB } from "@db/db.ts";
import { environmentSqliteRegistry } from "@db/schema/global/auth.ts";
import { notifications } from "@db/schema/tenant/notification.ts";
import { loggerAppSections } from "@logger/index.ts";
import { acquireJobLock, releaseJobLock } from "./services/job-lock.service.ts";
import { logJobBatch, logJobCompleted, logJobError, logJobSkipped, logJobStarted } from "./job-helpers.ts";
import { envConfig } from "@config/env.ts";
import { and, eq, inArray, isNotNull, lt } from "@deps";

const CLEANUP_BATCH_SIZE = 1000;

const FEATURE = "notifications-cleanup";
const SECTION = loggerAppSections.NOTIFICATIONS;

export async function cleanupDismissedNotifications(): Promise<number> {
  if (!(await acquireJobLock("notifications-cleanup"))) {
    await logJobSkipped(FEATURE, SECTION, "another instance is running");
    return 0;
  }

  const startTime = performance.now();
  const retentionDays = envConfig.notifications.retentionDays;
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);

  try {
    await logJobStarted(FEATURE, SECTION, {
      retentionDays,
      cutoffTimestamp,
      batchSize: CLEANUP_BATCH_SIZE,
    });

    const environments = await getGlobalDB()
      .select({ id: environmentSqliteRegistry.id })
      .from(environmentSqliteRegistry)
      .where(eq(environmentSqliteRegistry.isActive, true));

    let totalDeleted = 0;

    for (const { id: environmentId } of environments) {
      let tenantDeleted = 0;
      try {
        const db = await getTenantDB(environmentId);

        while (true) {
          const dismissedNotifications = await db
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                isNotNull(notifications.dismissedAt),
                lt(notifications.dismissedAt, cutoffTimestamp),
              ),
            )
            .limit(CLEANUP_BATCH_SIZE);

          if (dismissedNotifications.length === 0) {
            break;
          }

          const ids = dismissedNotifications.map((n) => n.id);
          await db
            .delete(notifications)
            .where(inArray(notifications.id, ids));

          const batchDeleted = ids.length;
          tenantDeleted += batchDeleted;

          await logJobBatch(FEATURE, SECTION, {
            environmentId,
            processedCount: batchDeleted,
            totalCount: totalDeleted + tenantDeleted,
          });

          if (batchDeleted < CLEANUP_BATCH_SIZE) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        await logJobError(FEATURE, SECTION, error, {
          environmentId,
          tenantDeleted,
        });
        continue;
      }

      totalDeleted += tenantDeleted;
    }

    const duration = performance.now() - startTime;

    await logJobCompleted(FEATURE, SECTION, {
      deletedCount: totalDeleted,
      environmentCount: environments.length,
      durationMs: duration,
      retentionDays,
    });

    return totalDeleted;
  } catch (error) {
    await logJobError(FEATURE, SECTION, error);
    throw error;
  } finally {
    await releaseJobLock("notifications-cleanup");
  }
}
