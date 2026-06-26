/**
 * @file services/object-backup/tombstone.ts
 * @description Deferred-delete queue helpers (DD4 tenant tombstones + DD8 env purges).
 *
 * Tenant tombstones (`backup_deletion_queue`): enqueued at each delete site
 * carrying the exact storage key(s) that site already computed, INSIDE the
 * same transaction as the row delete (transactional outbox — catalog rows are
 * hard-deleted, so deletions can't be discovered by scanning live tables).
 * Phase B of the job purges the backup copy only after the grace window.
 *
 * Global env-purge rows (`environment_backup_purge_queue`): enqueued INSIDE
 * `destroyEnvironment`'s teardown transaction so Phase C can purge a destroyed
 * tenant's whole backup subtree even after the tenant DB is gone.
 *
 * The row builders are PURE (no db handle) so each delete site can insert them
 * in its own transaction without tx/DB type friction; the select/mark/bump
 * helpers are job-facing and take the DB directly.
 */
import { asc, eq, lte, sql } from "@deps";
import type { TenantDB } from "@db/db.ts";
import { getGlobalDB, globalTables, tenantTables } from "@db/index.ts";
import { envConfig } from "@config/env.ts";

const SECONDS_PER_DAY = 86400;

/** `now + grace` (unix seconds). Grace preserves recoverability of an accidental delete. */
export function backupDeleteAfter(now: number): number {
  return now + envConfig.objectBackup.deleteGraceDays * SECONDS_PER_DAY;
}

/** Object-storage prefix that holds every key for a tenant. */
export function environmentBackupPrefix(environmentId: string): string {
  return `environment-storage/${environmentId}`;
}

// ---------------------------------------------------------------------------
// Tenant tombstones — pure row builder (insert at the delete site, in-tx)
// ---------------------------------------------------------------------------

export interface BackupTombstoneRow {
  id: string;
  storageKey: string;
  deletedAt: number;
  deleteAfter: number;
}

/**
 * Build tombstone rows for the given keys. Pure — the caller inserts them in
 * its own transaction (`tx.insert(tenantTables.backupDeletionQueue).values(...)`).
 */
export function buildBackupTombstoneRows(keys: string[], now: number): BackupTombstoneRow[] {
  if (keys.length === 0) return [];
  const deleteAfter = backupDeleteAfter(now);
  return keys.map((storageKey) => ({
    id: crypto.randomUUID(),
    storageKey,
    deletedAt: now,
    deleteAfter,
  }));
}

// ---------------------------------------------------------------------------
// Tenant tombstones — job-facing (Phase B)
// ---------------------------------------------------------------------------

export interface DueTombstone {
  id: string;
  storageKey: string;
  attempts: number;
}

/** Tombstones whose grace window has elapsed (deleteAfter <= now), oldest first. */
export async function selectDueTombstones(
  db: TenantDB,
  now: number,
  limit: number,
): Promise<DueTombstone[]> {
  return await db
    .select({
      id: tenantTables.backupDeletionQueue.id,
      storageKey: tenantTables.backupDeletionQueue.storageKey,
      attempts: tenantTables.backupDeletionQueue.attempts,
    })
    .from(tenantTables.backupDeletionQueue)
    .where(lte(tenantTables.backupDeletionQueue.deleteAfter, now))
    .orderBy(asc(tenantTables.backupDeletionQueue.deleteAfter))
    .limit(limit);
}

/** Drop a tombstone once its backup copy is confirmed purged. */
export async function markTombstonePurged(db: TenantDB, id: string): Promise<void> {
  await db.delete(tenantTables.backupDeletionQueue).where(eq(tenantTables.backupDeletionQueue.id, id));
}

/** Record a purge failure so the row is retried (with backoff via attempts). */
export async function bumpTombstoneAttempts(db: TenantDB, id: string, errorMsg: string): Promise<void> {
  await db
    .update(tenantTables.backupDeletionQueue)
    .set({ attempts: sql`${tenantTables.backupDeletionQueue.attempts} + 1`, lastError: errorMsg.slice(0, 1000) })
    .where(eq(tenantTables.backupDeletionQueue.id, id));
}

// ---------------------------------------------------------------------------
// Global env-purge queue — DD8
// ---------------------------------------------------------------------------

export interface EnvironmentPurgeRow {
  environmentId: string;
  prefix: string;
  deletedAt: number;
  deleteAfter: number;
}

/** Build the env-purge row. Pure — `destroyEnvironment` inserts it in its tx. */
export function buildEnvironmentPurgeRow(environmentId: string, now: number): EnvironmentPurgeRow {
  return {
    environmentId,
    prefix: environmentBackupPrefix(environmentId),
    deletedAt: now,
    deleteAfter: backupDeleteAfter(now),
  };
}

export interface DueEnvPurge {
  environmentId: string;
  prefix: string;
  attempts: number;
}

/** Enqueue (idempotent on PK) — used by the startup reconciliation sweep. */
export async function enqueueEnvironmentPurge(environmentId: string, now: number): Promise<void> {
  await getGlobalDB()
    .insert(globalTables.environmentBackupPurgeQueue)
    .values(buildEnvironmentPurgeRow(environmentId, now))
    .onConflictDoNothing();
}

export async function selectDueEnvironmentPurges(now: number, limit: number): Promise<DueEnvPurge[]> {
  return await getGlobalDB()
    .select({
      environmentId: globalTables.environmentBackupPurgeQueue.environmentId,
      prefix: globalTables.environmentBackupPurgeQueue.prefix,
      attempts: globalTables.environmentBackupPurgeQueue.attempts,
    })
    .from(globalTables.environmentBackupPurgeQueue)
    .where(lte(globalTables.environmentBackupPurgeQueue.deleteAfter, now))
    .orderBy(asc(globalTables.environmentBackupPurgeQueue.deleteAfter))
    .limit(limit);
}

export async function markEnvironmentPurgeDone(environmentId: string): Promise<void> {
  await getGlobalDB()
    .delete(globalTables.environmentBackupPurgeQueue)
    .where(eq(globalTables.environmentBackupPurgeQueue.environmentId, environmentId));
}

export async function bumpEnvironmentPurgeAttempts(environmentId: string, errorMsg: string): Promise<void> {
  await getGlobalDB()
    .update(globalTables.environmentBackupPurgeQueue)
    .set({
      attempts: sql`${globalTables.environmentBackupPurgeQueue.attempts} + 1`,
      lastError: errorMsg.slice(0, 1000),
    })
    .where(eq(globalTables.environmentBackupPurgeQueue.environmentId, environmentId));
}
