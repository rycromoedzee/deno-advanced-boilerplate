/**
 * @file jobs/db-backup.job.ts
 * @description Db Backup scheduled job
 */
/**
 * DB Backup Job
 *
 * Daily gzipped SQL-dump backups of the Global DB and every active tenant DB.
 * Each target is dumped inside a single read transaction (see
 * services/db-backup/dump.ts), streamed through gzip, uploaded via the
 * configured storage provider, and then swept by the GFS retention policy
 * (see services/db-backup/retention.ts).
 *
 * Uses distributed locking to ensure only one instance runs this job. Because
 * multi-tenant backup runs can exceed the 30-minute default lock TTL, the job
 * refreshes its lock periodically; a refresh failure aborts remaining targets.
 *
 * Pre-flight guard lives in services/db-backup/preflight.ts and is called from
 * main.ts and jobs/runners/standalone.ts at boot.
 */

import { envConfig } from "@config/env.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getStorage } from "@services/storage/singletons.ts";
import type { IStorageProvider } from "@interfaces/storage.ts";
import { getGlobalDB, tenantDbPath } from "@db/db.ts";
import { environmentSqliteRegistry } from "@db/schema/global/auth.ts";
import { createNodeClient, createWebClient, eq, type LibSQLClient } from "@deps";
import { useSymmetricDecrypt } from "@services/encryption/encryption.helper.ts";
import { HASHING_CONTEXTS, TextHashing } from "@utils/text/index.ts";
import { createDumpStream } from "@services/db-backup/dump.ts";
import { computeRetention, type RetentionConfig } from "@services/db-backup/retention.ts";
import { acquireJobLock, refreshJobLock, releaseJobLock } from "./services/job-lock.service.ts";
import { logJobCompleted, logJobError, logJobSkipped, logJobStarted, useJobLogger } from "./job-helpers.ts";

const FEATURE = "db-backup";
const SECTION = loggerAppSections.BACKUP;

type BackupScope =
  | { kind: "global" }
  | { kind: "tenant"; environmentId: string };

interface BackupTarget {
  scope: BackupScope;
  /** Human-readable identifier for logs: "global" or "tenant/env_abc" */
  label: string;
}

interface BackupTargetResult {
  target: BackupTarget;
  status: "success" | "failure";
  durationMs: number;
  bytesUploaded?: number;
  snapshotsKept?: number;
  snapshotsDeleted?: number;
  error?: string;
}

// --- Dedicated backup client (uncached, no migrations, null-token-safe) ---

function createClient(config: { url: string; authToken?: string }): LibSQLClient {
  if (config.url.startsWith("file:")) return createNodeClient(config);
  return createWebClient(config);
}

function isDev(): boolean {
  return envConfig.isDevelopment || envConfig.env === "development";
}

// Returns Promise<...> for signature parity with resolveTenantConfig; awaited at call site.
// deno-lint-ignore require-await
async function resolveGlobalConfig(): Promise<{ url: string; authToken?: string }> {
  if (isDev()) return { url: "file:./.data/db/global.db" };
  const url = envConfig.database.globalSqliteUrl;
  const token = envConfig.database.globalSqliteToken;
  if (!url) throw new Error("GLOBAL_SQLITE_URL is not set");
  return token ? { url, authToken: token } : { url };
}

async function resolveTenantConfig(environmentId: string): Promise<{ url: string; authToken?: string }> {
  if (isDev()) {
    return { url: tenantDbPath(environmentId) };
  }
  const [row] = await getGlobalDB()
    .select()
    .from(environmentSqliteRegistry)
    .where(eq(environmentSqliteRegistry.id, environmentId))
    .limit(1);
  if (!row) throw new Error(`Tenant DB registry entry not found for environment: ${environmentId}`);

  const encryptionKey = TextHashing.generateHashFromKeyForEncryption(
    envConfig.auth.generalEncryptionKey!,
    HASHING_CONTEXTS.TENANT_DB_CREDENTIALS,
  );
  const urlBytes = await useSymmetricDecrypt({
    key: encryptionKey,
    data: row.dbUrlEncrypted as Uint8Array,
  });
  const url = new TextDecoder().decode(urlBytes);

  if (row.dbTokenEncrypted == null) return { url };
  const tokenBytes = await useSymmetricDecrypt({
    key: encryptionKey,
    data: row.dbTokenEncrypted as Uint8Array,
  });
  return { url, authToken: new TextDecoder().decode(tokenBytes) };
}

async function openBackupClient(scope: BackupScope): Promise<{ client: LibSQLClient; close: () => void }> {
  const config = scope.kind === "global" ? await resolveGlobalConfig() : await resolveTenantConfig(scope.environmentId);
  const client = createClient(config);
  return {
    client,
    close: () => {
      try {
        client.close();
      } catch { /* idempotent */ }
    },
  };
}

// --- Storage key helpers ---

function scopePrefix(target: BackupTarget): string {
  return target.scope.kind === "global" ? "backups/global/" : `backups/tenant/${target.scope.environmentId}/`;
}

function isoDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDateFromKey(name: string): Date | null {
  const m = name.match(/(\d{4}-\d{2}-\d{2})\.sql\.gz$/);
  if (!m) return null;
  return new Date(m[1] + "T00:00:00Z");
}

// --- Per-target orchestration ---

async function backupTarget(
  target: BackupTarget,
  storage: IStorageProvider,
  now: Date,
  retention: RetentionConfig,
): Promise<BackupTargetResult> {
  const prefix = scopePrefix(target);
  const canonicalKey = `${prefix}${isoDateKey(now)}.sql.gz`;
  const start = performance.now();
  let bytesUploaded = 0;

  try {
    const { client, close } = await openBackupClient(target.scope);
    try {
      const sqlStream = createDumpStream(client);
      // CompressionStream's TypeScript typings use `BufferSource` on the writable
      // side, which doesn't unify with `ReadableStream<Uint8Array>`'s pipeThrough
      // expectation in Deno's lib.dom typings. Runtime behavior is correct.
      const gzipStream = sqlStream.pipeThrough(
        new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
      );
      try {
        const upload = await storage.uploadFile(canonicalKey, gzipStream);
        bytesUploaded = upload.bytesWritten;
      } catch (e) {
        try {
          await storage.deleteFile(canonicalKey);
        } catch { /* best-effort */ }
        throw e;
      }
    } finally {
      close();
    }
  } catch (err) {
    return {
      target,
      status: "failure",
      durationMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let snapshotsKept = 0;
  let snapshotsDeleted = 0;
  try {
    const listing = await storage.listFiles(prefix);
    const dates = listing
      .map((e) => parseDateFromKey(e.name))
      .filter((d): d is Date => d !== null);
    const { keep, delete: toDelete } = computeRetention(dates, now, retention);
    snapshotsKept = keep.length;
    for (const d of toDelete) {
      const key = `${prefix}${isoDateKey(d)}.sql.gz`;
      try {
        await storage.deleteFile(key);
        snapshotsDeleted++;
      } catch (err) {
        await useJobLogger({
          feature: FEATURE,
          action: "retention-delete-failed",
          section: SECTION,
          level: "warn",
          details: { scope: target.label, key },
          raw: err,
        });
      }
    }
  } catch (err) {
    await useJobLogger({
      feature: FEATURE,
      action: "retention-sweep-failed",
      section: SECTION,
      level: "warn",
      details: { scope: target.label, prefix },
      raw: err,
    });
  }

  return {
    target,
    status: "success",
    durationMs: Math.round(performance.now() - start),
    bytesUploaded,
    snapshotsKept,
    snapshotsDeleted,
  };
}

async function enumerateTargets(): Promise<BackupTarget[]> {
  const out: BackupTarget[] = [{ scope: { kind: "global" }, label: "global" }];
  const rows = await getGlobalDB()
    .select({ id: environmentSqliteRegistry.id })
    .from(environmentSqliteRegistry)
    .where(eq(environmentSqliteRegistry.isActive, true));
  for (const row of rows) {
    out.push({ scope: { kind: "tenant", environmentId: row.id }, label: `tenant/${row.id}` });
  }
  return out;
}

export async function runDbBackup(): Promise<void> {
  if (!envConfig.backup.enabled) return;

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
  }, envConfig.backup.lockRefreshIntervalMs);

  try {
    await logJobStarted(FEATURE, SECTION);

    const storage = getStorage();
    const now = new Date();
    const retention: RetentionConfig = {
      dailyRetentionDays: envConfig.backup.dailyRetentionDays,
      weeklyRetentionWeeks: envConfig.backup.weeklyRetentionWeeks,
      monthlyRetentionMonths: envConfig.backup.monthlyRetentionMonths,
    };

    const targets = await enumerateTargets();
    let succeeded = 0;
    let failed = 0;

    for (const target of targets) {
      if (aborted) break;
      const result = await backupTarget(target, storage, now, retention);
      if (result.status === "success") {
        succeeded++;
        await useJobLogger({
          feature: FEATURE,
          action: "target-complete",
          section: SECTION,
          level: "info",
          details: {
            scope: result.target.label,
            durationMs: result.durationMs,
            bytesUploaded: result.bytesUploaded,
            snapshotsKept: result.snapshotsKept,
            snapshotsDeleted: result.snapshotsDeleted,
          },
        });
      } else {
        failed++;
        await useJobLogger({
          feature: FEATURE,
          action: "target-failed",
          section: SECTION,
          level: "warn",
          details: { scope: result.target.label, durationMs: result.durationMs, error: result.error },
        });
      }
    }

    await logJobCompleted(FEATURE, SECTION, {
      status: aborted ? "aborted" : "success",
      targetsTotal: targets.length,
      targetsSucceeded: succeeded,
      targetsFailed: failed,
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
