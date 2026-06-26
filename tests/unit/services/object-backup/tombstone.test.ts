/**
 * @file tests/unit/services/object-backup/tombstone.test.ts
 * @description Tests for the deferred-delete queue helpers (DD4/DD8).
 *
 * Pure row builders are checked directly; the select/mark/bump helpers are
 * exercised against an isolated migrated tenant DB (so the backup_deletion_queue
 * table exists), proving the grace-window semantics (not due before deleteAfter,
 * due after).
 */
import { assertEquals } from "@std/assert";
import { createNodeClient, drizzle, eq, migrate } from "@deps";
import { envConfig } from "@config/env.ts";
import * as tenantSchema from "@db/schema/tenant/index.ts";
import { tenantTables } from "@db/index.ts";
import {
  buildBackupTombstoneRows,
  buildEnvironmentPurgeRow,
  bumpTombstoneAttempts,
  environmentBackupPrefix,
  markTombstonePurged,
  selectDueTombstones,
} from "@services/object-backup/tombstone.ts";

interface Handle {
  // deno-lint-ignore no-explicit-any
  db: any;
  client: { close: () => void };
  cleanup: () => Promise<void>;
}

async function makeTenantDb(): Promise<Handle> {
  const dir = await Deno.makeTempDir();
  const client = createNodeClient({ url: `file:${dir}/tenant.db` });
  await client.execute("PRAGMA foreign_keys = OFF");
  // deno-lint-ignore no-explicit-any
  const db: any = drizzle(client, { schema: tenantSchema });
  await migrate(db, { migrationsFolder: "./db/tenant-migrations" });
  return {
    db,
    client,
    cleanup: async () => {
      try {
        client.close();
      } catch { /* idempotent */ }
      await Deno.remove(dir, { recursive: true });
    },
  };
}

const GRACE_SECONDS = envConfig.objectBackup.deleteGraceDays * 86400;

Deno.test("buildBackupTombstoneRows: one row per key, deleteAfter = now + grace", () => {
  const now = 1_700_000_000;
  const rows = buildBackupTombstoneRows(["a", "b"], now);
  assertEquals(rows.length, 2);
  assertEquals(rows.map((r) => r.storageKey).sort(), ["a", "b"]);
  assertEquals(rows[0].deletedAt, now);
  assertEquals(rows[0].deleteAfter, now + GRACE_SECONDS);
  assertEquals(typeof rows[0].id, "string");
});

Deno.test("buildEnvironmentPurgeRow: tenant prefix + grace", () => {
  const now = 1_700_000_000;
  const row = buildEnvironmentPurgeRow("env_xyz", now);
  assertEquals(row.environmentId, "env_xyz");
  assertEquals(row.prefix, environmentBackupPrefix("env_xyz"));
  assertEquals(row.prefix, "environment-storage/env_xyz");
  assertEquals(row.deleteAfter, now + GRACE_SECONDS);
});

Deno.test("tombstone grace: not due before deleteAfter, due after", async () => {
  const h = await makeTenantDb();
  try {
    const now = 1_700_000_000;
    const rows = buildBackupTombstoneRows(["k1", "k2"], now);
    await h.db.insert(tenantTables.backupDeletionQueue).values(rows);

    // Before the grace window elapses → nothing due.
    assertEquals((await selectDueTombstones(h.db, now + 10, 10)).length, 0);

    // After the grace window → both due.
    const due = await selectDueTombstones(h.db, now + GRACE_SECONDS + 1, 10);
    assertEquals(due.map((d) => d.storageKey).sort(), ["k1", "k2"]);
  } finally {
    await h.cleanup();
  }
});

Deno.test("markTombstonePurged removes the row; bumpTombstoneAttempts records the failure", async () => {
  const h = await makeTenantDb();
  try {
    const now = 1_700_000_000;
    const [row] = buildBackupTombstoneRows(["k"], now);
    await h.db.insert(tenantTables.backupDeletionQueue).values(row);

    await bumpTombstoneAttempts(h.db, row.id, "boom");
    const [r] = await h.db
      .select()
      .from(tenantTables.backupDeletionQueue)
      .where(eq(tenantTables.backupDeletionQueue.id, row.id));
    assertEquals(r.attempts, 1);
    assertEquals(r.lastError, "boom");

    await markTombstonePurged(h.db, row.id);
    const after = await h.db
      .select()
      .from(tenantTables.backupDeletionQueue)
      .where(eq(tenantTables.backupDeletionQueue.id, row.id));
    assertEquals(after.length, 0);
  } finally {
    await h.cleanup();
  }
});
