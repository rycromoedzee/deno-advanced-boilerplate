/**
 * @file jobs/threat-intelligence-sources.job.ts
 * @description Threat Intelligence Sources scheduled job
 */
/**
 * Threat Intelligence Sources Job
 *
 * Periodically updates threat intelligence sources from external providers.
 * Checks each active source and updates it if its update frequency interval has passed.
 *
 * Uses distributed locking to ensure only one instance runs the update at a time.
 */

import { getWorkerDB, tables } from "@db/db.ts";
import { threatSources } from "@db/schema/global/threat-intelligence.ts";
import { loggerAppSections } from "@logger/index.ts";
import { acquireJobLock, releaseJobLock } from "./services/job-lock.service.ts";
import { getThreatSourceUpdateService } from "@services/threat-intelligence/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";

// Get singleton instance via getter function
const threatSourceUpdateService = getThreatSourceUpdateService();
import { logJobCompleted, logJobError, logJobSkipped, logJobStarted } from "./job-helpers.ts";
import { and, desc, eq } from "@deps";

const FEATURE = "threat-intel-sources";
const SECTION = loggerAppSections.THREAT_INTELLIGENCE;

/**
 * Main job handler for updating threat intelligence sources
 */
export async function updateThreatIntelligenceSources(): Promise<void> {
  if (!(await acquireJobLock("threat-intelligence-sources-update"))) {
    await logJobSkipped(FEATURE, SECTION, "another instance is running");
    return;
  }

  const startTime = performance.now();

  try {
    const db = getWorkerDB();

    // Get all active threat sources
    const activeSources = await db
      .select()
      .from(threatSources)
      .where(eq(threatSources.isActive, true));

    if (activeSources.length === 0) {
      return;
    }

    await logJobStarted(FEATURE, SECTION, {
      sourceCount: activeSources.length,
    });

    let updatedCount = 0;
    let skippedCount = 0;

    for (const source of activeSources) {
      // Check if source needs update based on frequency
      const needsUpdate = await checkIfSourceNeedsUpdate(source.id, source.updateFrequency || 24);

      if (needsUpdate) {
        await threatSourceUpdateService.updateSourceById(source.id);
        updatedCount++;
      } else {
        skippedCount++;
      }
    }

    const durationMs = performance.now() - startTime;

    await logJobCompleted(FEATURE, SECTION, {
      updatedCount,
      skippedCount,
      totalDurationMs: durationMs,
    });
  } catch (error) {
    await logJobError(FEATURE, SECTION, error);
    throw error;
  } finally {
    await releaseJobLock("threat-intelligence-sources-update");
  }
}

/**
 * Check if a source needs an update based on its frequency and last successful update
 */
async function checkIfSourceNeedsUpdate(sourceId: string, frequencyHours: number): Promise<boolean> {
  const db = getWorkerDB();

  // Find the last successful update for this source
  const lastUpdate = await db
    .select({ createdAt: tables.threatUpdateLog.createdAt })
    .from(tables.threatUpdateLog)
    .where(
      and(
        eq(tables.threatUpdateLog.sourceId, sourceId),
        eq(tables.threatUpdateLog.status, "success"),
      ),
    )
    .orderBy(desc(tables.threatUpdateLog.createdAt))
    .limit(1);

  if (lastUpdate.length === 0) {
    // Never updated successfully, so it needs one
    return true;
  }

  const lastUpdateDate = lastUpdate[0].createdAt;
  if (!lastUpdateDate) return true;

  const now = getTimeNowForStorage();
  const hoursSinceLastUpdate = (now - lastUpdateDate) / (60 * 60);

  return hoursSinceLastUpdate >= frequencyHours;
}
