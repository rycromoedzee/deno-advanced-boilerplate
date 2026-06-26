/**
 * @file scripts/reconcile-backup-prefixes.ts
 * @description One-off/manual reconciliation for the object-storage-backup DD8 gap.
 *
 * The PRIMARY mechanism for purging a destroyed tenant's backup subtree is the
 * `environment_backup_purge_queue` row inserted ATOMICALLY inside
 * `destroyEnvironment`'s teardown transaction — so new destroys are always
 * covered. This script closes the RESIDUAL gap: backup prefixes for environments
 * destroyed BEFORE this feature shipped, or removed by any path that bypassed
 * `destroyEnvironment`.
 *
 * It lists every object key under `environment-storage/` on the BACKUP provider,
 * extracts the distinct environmentIds, and for any envId no longer present in
 * the global `environments` table, enqueues an `environment_backup_purge_queue`
 * row (idempotent on PK). The object-storage-backup job's Phase C then drains
 * them after the grace window.
 *
 * This is intentionally a MANUAL script (not auto-run per job): it scans the
 * whole backup subtree, which is fine for a one-off/periodic audit but too
 * heavy for the hourly job. Run it once after enabling the feature, and
 * periodically as a retention audit:
 *
 *   deno run -A scripts/reconcile-backup-prefixes.ts
 */
import { envConfig } from "@config/env.ts";
import { getBackupStorage } from "@services/storage/singletons.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { enqueueEnvironmentPurge } from "@services/object-backup/tombstone.ts";

async function main(): Promise<void> {
  if (!envConfig.objectBackup.enabled) {
    console.error("OBJECT_BACKUP_ENABLED is false — no backup destination configured; nothing to reconcile.");
    return;
  }

  const backup = getBackupStorage();
  console.log("Listing backup keys under environment-storage/ (scans the whole backup subtree)…");
  const keys = await backup.listKeysRecursive("environment-storage");
  const backupEnvIds = new Set<string>();
  for (const key of keys) {
    const seg = key.split("/")[1]; // environment-storage/<envId>/...
    if (seg) backupEnvIds.add(seg);
  }
  console.log(`Found ${backupEnvIds.size} distinct environmentId(s) on the backup.`);

  const liveRows = await getGlobalDB()
    .select({ id: globalTables.environments.id })
    .from(globalTables.environments);
  const liveEnvIds = new Set(liveRows.map((r) => r.id));

  const now = Math.floor(Date.now() / 1000);
  let enqueued = 0;
  for (const id of backupEnvIds) {
    if (!liveEnvIds.has(id)) {
      await enqueueEnvironmentPurge(id, now); // idempotent on PK
      enqueued++;
      console.log(`  orphan prefix: ${id} → enqueued purge (Phase C drains it after the grace window)`);
    }
  }
  console.log(`Reconciliation complete: ${enqueued} orphan prefix(es) enqueued for purge.`);
}

main().catch((error) => {
  console.error("reconcile-backup-prefixes failed:", error);
  Deno.exit(1);
});
