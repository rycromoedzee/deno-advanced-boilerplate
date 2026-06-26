/**
 * @file tests/integration/services/cache/durable-cache.store.test.ts
 * @description DurableCacheStore persistence tests against an isolated file-backed libSQL DB.
 *
 * The store is given an injected DB handle (the testability seam) pointing at a
 * throwaway temp DB, so these never touch the getGlobalDB() singleton. The
 * durable_cache table is created via raw SQL because the global migration is
 * deferred (see plans/durable-cache-layer.md §5.2) — the CREATE mirrors
 * db/schema/global/durable-cache.ts exactly.
 *
 * No DB credentials required (the seam bypasses getGlobalDB), so this runs under
 * the default `deno task test` (NODE_ENV=test). Set TRACING_ENABLED=false to
 * silence span noise.
 */
import { assertEquals } from "@std/assert";
import { createClient as createNodeClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "@deps";
import { globalTables } from "@db/index.ts";
import { DurableCacheStore, type DurableHandle } from "@services/cache/durable-cache.store.ts";
import type { DurableNamespacePolicy } from "@interfaces/cache.ts";

const POLICY: DurableNamespacePolicy = { scope: "global", writeMode: "sync" };

// Mirrors db/schema/global/durable-cache.ts verbatim (the migration is deferred).
const CREATE_TABLE_SQL =
  "CREATE TABLE `durable_cache` (`namespace` text NOT NULL, `key` text NOT NULL, `value` text NOT NULL, `expires_at` integer, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, PRIMARY KEY(`namespace`, `key`))";
const CREATE_INDEX_SQL = "CREATE INDEX `idx_durable_cache_expires_at` ON `durable_cache` (`expires_at`)";

interface Fixture {
  store: DurableCacheStore;
  handle: DurableHandle;
  cleanup: () => Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const tmpDir = await Deno.makeTempDir();
  const client = createNodeClient({ url: `file:${tmpDir}/durable-test.db` });
  const db = drizzle(client, { schema: globalTables });
  await client.execute(CREATE_TABLE_SQL);
  await client.execute(CREATE_INDEX_SQL);
  const handle: DurableHandle = { db, table: globalTables.durableCache };
  const store = new DurableCacheStore(() => handle);
  return {
    store,
    handle,
    cleanup: async () => {
      client.close();
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    },
  };
}

const allRows = (h: DurableHandle) => h.db.select().from(globalTables.durableCache);
const rowsIn = (h: DurableHandle, ns: string) =>
  h.db.select().from(globalTables.durableCache).where(eq(globalTables.durableCache.namespace, ns));

Deno.test("DurableCacheStore.set/get round-trips the value and stored expiry", async () => {
  const f = await makeFixture();
  try {
    const future = Math.floor(Date.now() / 1000) + 500;
    await f.store.set("ns", "ttl", { a: 1 }, future, POLICY);
    await f.store.set("ns", "nottl", { b: 2 }, null, POLICY);
    assertEquals(await f.store.get<{ a: number }>("ns", "ttl", POLICY), { value: { a: 1 }, expiresAt: future });
    assertEquals(await f.store.get<{ b: number }>("ns", "nottl", POLICY), { value: { b: 2 }, expiresAt: null });
  } finally {
    await f.cleanup();
  }
});

Deno.test("DurableCacheStore.set upserts on conflict (overwrites value, bumps updatedAt, keeps createdAt)", async () => {
  const f = await makeFixture();
  try {
    const oldSec = Math.floor(Date.now() / 1000) - 5000;
    // Seed a stale row directly so the upsert's updatedAt bump is observable.
    await f.handle.db.insert(globalTables.durableCache).values({
      namespace: "ns",
      key: "k",
      value: { v: 1 } as unknown,
      expiresAt: null,
      createdAt: oldSec,
      updatedAt: oldSec,
    });
    await f.store.set("ns", "k", { v: 2 }, null, POLICY);
    const rows = await allRows(f.handle);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].value, { v: 2 });
    assertEquals(rows[0].createdAt, oldSec); // unchanged on upsert
    assertEquals(rows[0].updatedAt > oldSec, true); // bumped
  } finally {
    await f.cleanup();
  }
});

Deno.test("DurableCacheStore.delete removes a single key", async () => {
  const f = await makeFixture();
  try {
    await f.store.set("ns", "k", "v", null, POLICY);
    await f.store.set("ns", "other", "v", null, POLICY);
    await f.store.delete("ns", "k", POLICY);
    assertEquals(await f.store.get("ns", "k", POLICY), null);
    assertEquals((await allRows(f.handle)).length, 1);
  } finally {
    await f.cleanup();
  }
});

Deno.test("DurableCacheStore.deletePattern matches keys by glob within a namespace only", async () => {
  const f = await makeFixture();
  try {
    await f.store.set("ns", "user:1", "x", null, POLICY);
    await f.store.set("ns", "user:2", "x", null, POLICY);
    await f.store.set("ns", "admin:1", "x", null, POLICY);
    await f.store.set("other", "user:1", "x", null, POLICY);
    await f.store.deletePattern("ns", "user:*", POLICY);
    assertEquals((await rowsIn(f.handle, "ns")).map((r) => r.key).sort(), ["admin:1"]);
    assertEquals((await rowsIn(f.handle, "other")).length, 1); // other namespace untouched
  } finally {
    await f.cleanup();
  }
});

Deno.test("DurableCacheStore.clearNamespace deletes only the given namespace", async () => {
  const f = await makeFixture();
  try {
    await f.store.set("ns1", "a", "x", null, POLICY);
    await f.store.set("ns1", "b", "x", null, POLICY);
    await f.store.set("ns2", "a", "x", null, POLICY);
    await f.store.clearNamespace("ns1", POLICY);
    assertEquals((await rowsIn(f.handle, "ns1")).length, 0);
    assertEquals((await rowsIn(f.handle, "ns2")).length, 1);
  } finally {
    await f.cleanup();
  }
});

Deno.test("DurableCacheStore.deleteExpired removes only expired rows, leaves null/future expiry", async () => {
  const f = await makeFixture();
  try {
    const now = Math.floor(Date.now() / 1000);
    await f.store.set("ns", "expired", "e", now - 10, POLICY);
    await f.store.set("ns", "fresh", "f", now + 1000, POLICY);
    await f.store.set("ns", "nottl", "n", null, POLICY);
    await f.store.deleteExpired(f.handle);
    assertEquals((await allRows(f.handle)).map((r) => r.key).sort(), ["fresh", "nottl"]);
  } finally {
    await f.cleanup();
  }
});
