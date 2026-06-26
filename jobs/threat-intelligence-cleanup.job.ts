/**
 * @file jobs/threat-intelligence-cleanup.job.ts
 * @description Threat Intelligence Cleanup scheduled job
 */
/**
 * Threat Intelligence Cleanup Job
 *
 * Hard-deletes threat IPs/CIDRs that have been inactive (isActive=false)
 * for more than the retention period. Prevents database bloat from
 * accumulating stale soft-deleted entries.
 *
 * With unique constraints on (ipAddress, sourceId) and (cidrBlock, sourceId),
 * reactivation is handled atomically via upsert, so a minimal retention window
 * is sufficient - just enough for forensic investigation if needed.
 *
 * Schedule: Daily at 4 AM UTC
 */

import { getWorkerDB, type GlobalDB } from "@db/db.ts";
import { threatCIDRs, threatIPs } from "@db/schema/global/threat-intelligence.ts";
import { and, type AnySQLiteTable, eq, inArray, lt, type SQLiteColumn } from "@deps";
import { acquireJobLock, releaseJobLock } from "./services/job-lock.service.ts";
import { loggerAppSections } from "@logger/index.ts";
import { logJobBatch, logJobCompleted, logJobError, logJobSkipped, logJobStarted } from "./job-helpers.ts";

/**
 * Batch size for cleanup operations
 * Deletes this many entries at a time to avoid long DB locks
 */
const CLEANUP_BATCH_SIZE = 1000;

/**
 * Number of days to retain inactive entries before hard deletion.
 * Reduced from 7 to 1 since upsert handles reactivation atomically.
 * Keeping 1 day provides minimal forensic buffer for incident investigation.
 */
const RETENTION_DAYS = 1;

const FEATURE = "threat-intel-cleanup";
const SECTION = loggerAppSections.THREAT_INTELLIGENCE;

/**
 * Hard-delete inactive threat intelligence entries older than retention period.
 * Uses distributed locking to ensure only one instance runs at a time.
 *
 * @returns Total number of entries deleted
 */
export async function cleanupInactiveThreatEntries(): Promise<number> {
  if (!(await acquireJobLock("threat-intel-cleanup"))) {
    await logJobSkipped(FEATURE, SECTION, "another instance is running");
    return 0;
  }

  const startTime = performance.now();
  const db = getWorkerDB();
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - (RETENTION_DAYS * 24 * 60 * 60);
  let totalDeleted = 0;

  try {
    await logJobStarted(FEATURE, SECTION, {
      cutoffTimestamp,
      retentionDays: RETENTION_DAYS,
      batchSize: CLEANUP_BATCH_SIZE,
    });

    // Clean up inactive IPs
    const ipsDeleted = await cleanupTable(db, threatIPs, cutoffTimestamp, totalDeleted);
    totalDeleted += ipsDeleted;

    // Clean up inactive CIDRs
    const cidrsDeleted = await cleanupTable(db, threatCIDRs, cutoffTimestamp, totalDeleted);
    totalDeleted += cidrsDeleted;

    const duration = performance.now() - startTime;

    await logJobCompleted(FEATURE, SECTION, {
      deletedCount: totalDeleted,
      ipsDeleted,
      cidrsDeleted,
      durationMs: Math.round(duration),
      retentionDays: RETENTION_DAYS,
    });

    return totalDeleted;
  } catch (error) {
    await logJobError(FEATURE, SECTION, error);
    throw error;
  } finally {
    await releaseJobLock("threat-intel-cleanup");
  }
}

/**
 * Clean up stale entries from a single table
 */
async function cleanupTable<
  TTable extends AnySQLiteTable & {
    id: SQLiteColumn;
    isActive: SQLiteColumn;
    updatedAt: SQLiteColumn;
  },
>(
  db: GlobalDB,
  table: TTable,
  cutoffTimestamp: number,
  currentTotal: number,
): Promise<number> {
  let deleted = 0;
  // Cast needed because Drizzle's `.from()` conditional type cannot be resolved
  // for a generic table parameter — the runtime behavior is correct.
  // (Same convention as services/threat-intelligence/db-utils.ts.)
  const queryTable = table as AnySQLiteTable;

  while (true) {
    const staleEntries = await db
      .select({ id: table.id })
      .from(queryTable)
      .where(
        and(
          eq(table.isActive, false),
          lt(table.updatedAt, cutoffTimestamp),
        ),
      )
      .limit(CLEANUP_BATCH_SIZE);

    if (staleEntries.length === 0) {
      break;
    }

    const ids = staleEntries.map((entry) => entry.id as string);
    await db.delete(queryTable).where(inArray(table.id, ids));
    deleted += staleEntries.length;

    await logJobBatch(FEATURE, SECTION, {
      processedCount: staleEntries.length,
      totalCount: currentTotal + deleted,
    });

    if (staleEntries.length < CLEANUP_BATCH_SIZE) {
      break;
    }

    // Small delay to avoid long database locks
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return deleted;
}

/**
 * Manual trigger function for testing or on-demand cleanup
 */
export async function manualThreatIntelCleanup(): Promise<{
  success: boolean;
  deletedCount: number;
  error?: string;
}> {
  try {
    const deletedCount = await cleanupInactiveThreatEntries();
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
