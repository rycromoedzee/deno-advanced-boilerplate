/**
 * @file jobs/object-storage-backup.job.ts
 * @description Object-storage backup scheduled job (Phase A push-new + B/C deferred deletes).
 *
 * Incremental off-site copy of tenant object storage (user file bytes), plus the
 * deferred-delete half of the 3-2-1 story:
 *
 * - **Phase A (per tenant):** copy catalog rows whose `backedUpAt IS NULL` to
 *   the backup destination, marking each backed up only after a confirmed
 *   upload. Thumbnails copy best-effort (separate `thumbnailBackedUpAt`).
 * - **Phase B (per tenant):** purge backup copies of tombstones whose grace
 *   window has elapsed (`backup_deletion_queue`). `deleteFile` is idempotent —
 *   `MEDIA.FILE_NOT_FOUND` (object was never backed up) is treated as success.
 * - **Phase C (once per run):** drain due whole-env purge rows
 *   (`environment_backup_purge_queue`, DD8) by enumerating the destroyed
 *   tenant's backup subtree with `listKeysRecursive` and `deleteFile`-ing each
 *   key explicitly — NEVER `deleteDirectory` (S3 silently caps at 1000 keys;
 *   Bunny/Local swallow errors). The purge row is only dropped once the prefix
 *   lists empty.
 *
 * Run on the STANDALONE runner so `timeoutMs` applies. Distributed locking
 * mirrors `runDbBackup`: acquire → setInterval(refresh) → per-tenant
 * try/catch+continue (one vanished tenant never aborts the run) → finally release.
 *
 * Reconciliation note: the env-purge row is inserted INSIDE `destroyEnvironment`'s
 * teardown transaction (atomic), so a destroyed tenant always has a purge row —
 * a cross-provider orphan-prefix reconciliation sweep (env destroyed before this
 * feature shipped) is a documented follow-up, not auto-run here.
 */
import { envConfig } from "@config/env.ts";
import { loggerAppSections } from "@logger/index.ts";
import { eq } from "@deps";
import { getGlobalDB, getTenantDB } from "@db/index.ts";
import { environmentSqliteRegistry } from "@db/schema/global/auth.ts";
import { acquireJobLock, refreshJobLock, releaseJobLock } from "./services/job-lock.service.ts";
import { logJobCompleted, logJobError, logJobSkipped, logJobStarted, useJobLogger } from "./job-helpers.ts";
import {
  markAttachmentBackedUp,
  markDocumentMainBackedUp,
  markDocumentThumbnailBackedUp,
  selectUnbackedAttachments,
  selectUnbackedDocuments,
} from "@services/object-backup/catalog.ts";
import { copyObject } from "@services/object-backup/copy.ts";
import {
  bumpEnvironmentPurgeAttempts,
  bumpTombstoneAttempts,
  markEnvironmentPurgeDone,
  markTombstonePurged,
  selectDueEnvironmentPurges,
  selectDueTombstones,
} from "@services/object-backup/tombstone.ts";
import { purgeBackupObject, purgeEnvironmentBackupSubtree } from "@services/object-backup/purge.ts";

const FEATURE = "object-storage-backup";
const SECTION = loggerAppSections.BACKUP;

/** Active tenant environment ids (registry.isActive). */
async function enumerateTenantIds(): Promise<string[]> {
  const rows = await getGlobalDB()
    .select({ id: environmentSqliteRegistry.id })
    .from(environmentSqliteRegistry)
    .where(eq(environmentSqliteRegistry.isActive, true));
  return rows.map((r) => r.id);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface TenantRunStats {
  copied: number;
  bytes: number;
  failed: number;
  purged: number;
}

/** Phase A (push new) + Phase B (purge due tombstones) for one tenant. */
async function backupTenant(
  environmentId: string,
  isAborted: () => boolean,
): Promise<TenantRunStats> {
  const db = await getTenantDB(environmentId);
  const limit = envConfig.objectBackup.batchLimit;
  const now = Math.floor(Date.now() / 1000);
  let copied = 0;
  let bytes = 0;
  let failed = 0;
  let purged = 0;

  // --- Phase A: documents (+ thumbnails) ---
  const docs = await selectUnbackedDocuments(db, limit);
  for (const doc of docs) {
    if (isAborted()) break;

    if (doc.needsMain) {
      try {
        bytes += await copyObject(doc.folderPath);
        // Mark ONLY after a confirmed upload — a crash here leaves backedUpAt
        // NULL and the next run re-copies safely (overwrite-safe upload).
        await markDocumentMainBackedUp(db, doc.id, now);
        copied++;
      } catch (err) {
        failed++;
        await useJobLogger({
          feature: FEATURE,
          action: "document-copy-failed",
          section: SECTION,
          level: "warn",
          details: { environmentId, storageId: doc.id },
          raw: err,
        });
        continue; // main failed → skip thumbnail this run; backedUpAt stays NULL
      }
    }

    if (doc.needsThumbnail && doc.thumbnailPath) {
      try {
        await copyObject(doc.thumbnailPath);
        await markDocumentThumbnailBackedUp(db, doc.id, now);
        copied++;
      } catch (err) {
        // Best-effort: a missing thumbnail never blocks the main object.
        // thumbnailBackedUpAt stays NULL → retried independently next run.
        await useJobLogger({
          feature: FEATURE,
          action: "thumbnail-copy-failed",
          section: SECTION,
          level: "warn",
          details: { environmentId, storageId: doc.id },
          raw: err,
        });
      }
    }
  }

  if (isAborted()) return { copied, bytes, failed, purged };

  // --- Phase A: note attachments ---
  const attachments = await selectUnbackedAttachments(db, limit);
  for (const att of attachments) {
    if (isAborted()) break;
    try {
      bytes += await copyObject(att.storageKey);
      await markAttachmentBackedUp(db, att.id, now);
      copied++;
    } catch (err) {
      failed++;
      await useJobLogger({
        feature: FEATURE,
        action: "attachment-copy-failed",
        section: SECTION,
        level: "warn",
        details: { environmentId, attachmentId: att.id },
        raw: err,
      });
    }
  }

  // --- Phase B: purge due tombstones (deferred deletes) ---
  const dueTombstones = await selectDueTombstones(db, now, limit);
  for (const t of dueTombstones) {
    if (isAborted()) break;
    try {
      await purgeBackupObject(t.storageKey);
      await markTombstonePurged(db, t.id);
      purged++;
    } catch (err) {
      await bumpTombstoneAttempts(db, t.id, errMsg(err));
      await useJobLogger({
        feature: FEATURE,
        action: "tombstone-purge-failed",
        section: SECTION,
        level: "warn",
        details: { environmentId, attempts: t.attempts + 1 },
        raw: err,
      });
    }
  }

  return { copied, bytes, failed, purged };
}

/** Phase C: drain due whole-env purge rows (once per run, global queue). */
async function runPhaseC(now: number, isAborted: () => boolean): Promise<{ envsPurged: number; envsFailed: number }> {
  const due = await selectDueEnvironmentPurges(now, envConfig.objectBackup.batchLimit);
  let envsPurged = 0;
  let envsFailed = 0;
  for (const purge of due) {
    if (isAborted()) break;
    try {
      await purgeEnvironmentBackupSubtree(purge.prefix);
      await markEnvironmentPurgeDone(purge.environmentId);
      envsPurged++;
      await useJobLogger({
        feature: FEATURE,
        action: "env-purged",
        section: SECTION,
        level: "info",
        details: { environmentId: purge.environmentId },
      });
    } catch (err) {
      envsFailed++;
      await bumpEnvironmentPurgeAttempts(purge.environmentId, errMsg(err));
      await useJobLogger({
        feature: FEATURE,
        action: "env-purge-failed",
        section: SECTION,
        level: "warn",
        details: { environmentId: purge.environmentId, attempts: purge.attempts + 1 },
        raw: err,
      });
    }
  }
  return { envsPurged, envsFailed };
}

export async function runObjectStorageBackup(): Promise<void> {
  if (!envConfig.objectBackup.enabled) return;

  if (!(await acquireJobLock(FEATURE))) {
    await logJobSkipped(FEATURE, SECTION, "another instance is running");
    return;
  }

  const startTime = performance.now();
  let aborted = false;
  const refreshTimer = setInterval(async () => {
    if (!(await refreshJobLock(FEATURE).catch(() => false))) {
      aborted = true;
      await useJobLogger({ feature: FEATURE, action: "lock-refresh-failed", section: SECTION, level: "error" });
    }
  }, envConfig.objectBackup.lockRefreshIntervalMs);

  try {
    await logJobStarted(FEATURE, SECTION);

    const tenantIds = await enumerateTenantIds();
    let totalCopied = 0;
    let totalBytes = 0;
    let totalFailed = 0;
    let totalPurged = 0;
    let tenantsOk = 0;
    let tenantsFailed = 0;

    for (const environmentId of tenantIds) {
      if (aborted) break;
      try {
        const stats = await backupTenant(environmentId, () => aborted);
        totalCopied += stats.copied;
        totalBytes += stats.bytes;
        totalFailed += stats.failed;
        totalPurged += stats.purged;
        tenantsOk++;
        if (stats.copied > 0 || stats.failed > 0 || stats.purged > 0) {
          await useJobLogger({
            feature: FEATURE,
            action: "tenant-complete",
            section: SECTION,
            level: "info",
            details: {
              environmentId,
              copied: stats.copied,
              bytes: stats.bytes,
              failed: stats.failed,
              purged: stats.purged,
            },
          });
        }
      } catch (err) {
        // Per-tenant best-effort: a tenant that throws (e.g. destroyed mid-run)
        // must not abort the whole run.
        tenantsFailed++;
        await useJobLogger({
          feature: FEATURE,
          action: "tenant-failed",
          section: SECTION,
          level: "warn",
          details: { environmentId },
          raw: err,
        });
      }
    }

    // Phase C runs once per job run (global queue), after the per-tenant work.
    const phaseC = aborted ? { envsPurged: 0, envsFailed: 0 } : await runPhaseC(Math.floor(Date.now() / 1000), () => aborted);

    await logJobCompleted(FEATURE, SECTION, {
      status: aborted ? "aborted" : "success",
      tenantsTotal: tenantIds.length,
      tenantsSucceeded: tenantsOk,
      tenantsFailed: tenantsFailed,
      objectsCopied: totalCopied,
      bytesCopied: totalBytes,
      objectsFailed: totalFailed,
      tombstonesPurged: totalPurged,
      envsPurged: phaseC.envsPurged,
      envsPurgeFailed: phaseC.envsFailed,
      durationMs: performance.now() - startTime,
    });
  } catch (error) {
    await logJobError(FEATURE, SECTION, error);
    throw error;
  } finally {
    clearInterval(refreshTimer);
    await releaseJobLock(FEATURE);
  }
}
