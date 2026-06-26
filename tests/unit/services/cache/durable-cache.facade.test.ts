/**
 * @file tests/unit/services/cache/durable-cache.facade.test.ts
 * @description GlobalCacheService durable-layer orchestration tests (no DB).
 *
 * Uses a real MemoryCacheProvider as the fast path and an in-memory spy as the
 * injected durableStore, asserting the facade's read-through / write-loop-guard /
 * cascade / no-resurrection logic from plans/durable-cache-layer.md §8 without
 * any database.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { GlobalCacheService } from "@services/cache/cache.service.ts";
import { MemoryCacheProvider } from "@services/cache/memory-cache.provider.ts";
import { CACHE_NAMESPACES } from "@services/cache/cache.config.ts";
import type { DurableCacheStore, DurableRow } from "@services/cache/durable-cache.store.ts";

const NS = CACHE_NAMESPACES.AUTH.REFRESH_TOKENS; // registered policy: { scope: "global", writeMode: "sync" }

interface SpyOpts {
  row?: DurableRow<unknown> | null;
  setDelayMs?: number;
  /** Make the durable store reject, to exercise the graceful-degrade / strict paths. */
  failGet?: boolean;
  failSet?: boolean;
  failDelete?: boolean;
}

function makeSpy(opts: SpyOpts = {}) {
  const calls = { get: 0, set: 0, delete: 0, deletePattern: 0, clearNamespace: 0 };
  const boom = () => Promise.reject(new Error("durable backing store unavailable"));
  const spy = {
    get: async () => {
      calls.get++;
      if (opts.failGet) return await boom();
      return opts.row ?? null;
    },
    set: async () => {
      calls.set++;
      if (opts.setDelayMs) await new Promise((r) => setTimeout(r, opts.setDelayMs));
      if (opts.failSet) return await boom();
    },
    delete: async () => {
      calls.delete++;
      if (opts.failDelete) return await boom();
    },
    deletePattern: async () => {
      calls.deletePattern++;
    },
    clearNamespace: async () => {
      calls.clearNamespace++;
    },
    deleteExpired: async () => {},
  };
  return { store: spy as unknown as DurableCacheStore, calls };
}

const mem = () => new MemoryCacheProvider({ maxSize: 1024 * 1024, maxEntries: 1000 });
const nowSec = () => Math.floor(Date.now() / 1000);

Deno.test("durable flag OFF: facade makes zero durable calls", async () => {
  const { store, calls } = makeSpy();
  const cache = new GlobalCacheService(mem(), { durableEnabled: false, durableStore: store });
  await cache.set(NS, "k", "v");
  assertEquals(calls.set, 0);
  assertEquals(await cache.get<string>(NS, "k"), "v"); // provider hit, no read-through
  assertEquals(calls.get, 0);
  await cache.delete(NS, "k");
  assertEquals(calls.delete, 0);
});

Deno.test("durable read-through warms the provider without a second durable write (write-loop guard)", async () => {
  const { store, calls } = makeSpy({ row: { value: "from-db", expiresAt: nowSec() + 1000 } });
  const cache = new GlobalCacheService(mem(), { durableEnabled: true, durableStore: store });
  assertEquals(await cache.get<string>(NS, "k"), "from-db");
  assertEquals(calls.get, 1);
  assertEquals(calls.set, 0); // warmed via provider.set, NOT this.set → no durable re-persist
  // Provider was warmed: a second get is a provider hit (no second durable read).
  assertEquals(await cache.get<string>(NS, "k"), "from-db");
  assertEquals(calls.get, 1);
});

Deno.test("durable read-through treats an expired row as a miss and lazy-deletes it", async () => {
  const { store, calls } = makeSpy({ row: { value: "stale", expiresAt: nowSec() - 100 } });
  const cache = new GlobalCacheService(mem(), { durableEnabled: true, durableStore: store });
  assertEquals(await cache.get<string>(NS, "k"), null);
  assertEquals(calls.delete, 1); // lazy-deleted
  assertEquals(calls.set, 0); // not warmed
});

Deno.test("durable sync write is awaited before set() resolves", async () => {
  const { store, calls } = makeSpy({ setDelayMs: 25 });
  const cache = new GlobalCacheService(mem(), { durableEnabled: true, durableStore: store });
  const start = Date.now();
  await cache.set(NS, "k", "v"); // REFRESH_TOKENS is writeMode "sync"
  assertEquals(calls.set, 1);
  assertEquals(Date.now() - start >= 25, true); // the durable write was awaited, not fire-and-forget
});

Deno.test("durable delete/deletePattern/clearNamespace cascade to the store", async () => {
  const { store, calls } = makeSpy();
  const cache = new GlobalCacheService(mem(), { durableEnabled: true, durableStore: store });
  await cache.delete(NS, "k");
  assertEquals(calls.delete, 1);
  await cache.deletePattern(NS, "user:*");
  assertEquals(calls.deletePattern, 1);
  await cache.clearNamespace(NS);
  assertEquals(calls.clearNamespace, 1);
});

Deno.test("durable getAndDelete delivers the durable value once and cannot resurrect", async () => {
  const { store, calls } = makeSpy({ row: { value: "once", expiresAt: nowSec() + 1000 } });
  const cache = new GlobalCacheService(mem(), { durableEnabled: true, durableStore: store });
  assertEquals(await cache.getAndDelete<string>(NS, "k"), "once");
  assertEquals(calls.get, 1);
  assertEquals(calls.delete, 1); // durable row always deleted → no resurrection
});

Deno.test("durable getAndDelete honors expiry (no resurrection of stale data)", async () => {
  const { store, calls } = makeSpy({ row: { value: "stale", expiresAt: nowSec() - 50 } });
  const cache = new GlobalCacheService(mem(), { durableEnabled: true, durableStore: store });
  assertEquals(await cache.getAndDelete<string>(NS, "k"), null);
  assertEquals(calls.delete, 1);
});

Deno.test("durable getAndDelete prefers the provider value and still deletes the durable row", async () => {
  const provider = mem();
  await provider.set(NS, "k", "from-cache", { ttl: 100 });
  const { store, calls } = makeSpy({ row: { value: "from-db", expiresAt: nowSec() + 1000 } });
  const cache = new GlobalCacheService(provider, { durableEnabled: true, durableStore: store });
  assertEquals(await cache.getAndDelete<string>(NS, "k"), "from-cache");
  assertEquals(calls.get, 0); // durable not read (provider had it)
  assertEquals(calls.delete, 1); // durable row still deleted (no resurrection)
});

// --- graceful-degrade parity with the bespoke refresh-token path ----------

Deno.test("graceful-degrade: a durable read error degrades to a miss (never throws)", async () => {
  const { store, calls } = makeSpy({ failGet: true });
  const cache = new GlobalCacheService(mem(), { durableEnabled: true, durableStore: store });
  // Backing-store (Turso) error on read-through must not fail the request.
  assertEquals(await cache.get<string>(NS, "k"), null);
  assertEquals(calls.get, 1);
  assertEquals(calls.set, 0); // nothing warmed
});

Deno.test("graceful-degrade: a sync durable write error does not fail cache.set", async () => {
  const provider = mem();
  const { store, calls } = makeSpy({ failSet: true });
  const cache = new GlobalCacheService(provider, { durableEnabled: true, durableStore: store });
  // REFRESH_TOKENS is writeMode "sync"; the durable write throws but the cache
  // set must still resolve (provider write already succeeded).
  await cache.set(NS, "k", "v");
  assertEquals(calls.set, 1);
  assertEquals(await provider.get<string>(NS, "k"), "v"); // value is live for this request
});

Deno.test("strict invalidation: a durable delete error propagates (no-resurrection guard)", async () => {
  const { store, calls } = makeSpy({ failDelete: true });
  const cache = new GlobalCacheService(mem(), { durableEnabled: true, durableStore: store });
  // Unlike reads/writes, invalidation does NOT swallow errors: the caller must
  // learn the durable row may still exist and could resurrect a stale value.
  await assertRejects(() => cache.delete(NS, "k"));
  assertEquals(calls.delete, 1);
});
