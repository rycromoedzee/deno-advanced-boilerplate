/**
 * @file services/cache/durable-cache.store.ts
 * @description DurableCacheStore — pure persistence layer for the durable cache.
 *
 * Owns all DB I/O and scope routing for the durable_cache backing table. No cache
 * logic lives here — the facade (cache.service.ts) orchestrates when to read-through,
 * warm, and cascade invalidations; this store only persists/deletes.
 *
 * Scope routing: `policy.scope` selects the physical DB. Global -> getGlobalDB();
 * tenant -> tenant DB (phase 5, not yet implemented — phase 5 resolves environmentId
 * from requestContext and throws if absent, never falling back to a shared sentinel).
 *
 * Security: span attributes log ONLY the namespace — never the key or value (values
 * may carry secrets, e.g. encrypted derived keys). All queries are parameterized via
 * Drizzle; the GLOB pattern is a bound parameter, never string-interpolated.
 */
import { and, eq, lte, sql } from "@deps"; // drizzle operators — NOT re-exported by @db/index.ts (cf. refresh-token.repository.ts:5)
import { getGlobalDB, type GlobalDB, globalTables } from "@db/index.ts";
import { traced } from "@services/tracing/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import type { DurableNamespacePolicy } from "@interfaces/cache.ts";

// Phase 5 (tenant scope) additionally imports { getTenantDB, tenantTables, requestContext } from "@db/index.ts".

/** A resolved DB handle + table for a scope. Phase 1 is global only; phase 5 widens `db`. */
export interface DurableHandle {
  db: GlobalDB; // phase 1: global only. Phase 5 widens to `GlobalDB | TenantDB`.
  table: typeof globalTables.durableCache;
}

/** A durable row as returned to the facade: the raw cached value + its absolute expiry. */
export interface DurableRow<T> {
  value: T;
  expiresAt: number | null; // unix seconds; null = no expiry
}

/** Provider of a global-scope handle. Injectable so tests can run against a temp DB. */
export type DurableGlobalHandleProvider = () => DurableHandle;

export class DurableCacheStore {
  private readonly resolveGlobalHandle: DurableGlobalHandleProvider;

  constructor(resolveGlobalHandle?: DurableGlobalHandleProvider) {
    // Default resolves the real global singleton. Tests inject a temp DB handle so
    // global-scope tests never touch the getGlobalDB() singleton (which, under
    // NODE_ENV=test, has no usable backing DB and would pollute ./data in dev).
    this.resolveGlobalHandle = resolveGlobalHandle ??
      (() => ({ db: getGlobalDB(), table: globalTables.durableCache }));
  }

  /**
   * Resolves the DB handle + table for a namespace's policy.
   *
   * Tenant scope throws until phase 5: do NOT fall back to the global table, both
   * because that is a cross-tenant bleed and because the handle type is global-only.
   * Kept async for phase-5 parity (getTenantDB is async) even though the global path
   * is synchronous.
   */
  // deno-lint-ignore require-await -- async for phase-5 parity (getTenantDB is async)
  private async resolve(policy: DurableNamespacePolicy): Promise<DurableHandle> {
    if (policy.scope !== "global") {
      throw new Error("DurableCacheStore: tenant scope is not implemented until phase 5");
    }
    return this.resolveGlobalHandle();
  }

  async get<T>(namespace: string, key: string, policy: DurableNamespacePolicy): Promise<DurableRow<T> | null> {
    return await traced("DurableCacheStore.get", "db.query", async (span) => {
      span.attributes["namespace"] = namespace; // namespace is safe to log; value/key are NOT
      const { db, table } = await this.resolve(policy);
      const rows = await db.select().from(table)
        .where(and(eq(table.namespace, namespace), eq(table.key, key)))
        .limit(1);
      if (rows.length === 0) {
        span.attributes["found"] = false;
        return null;
      }
      span.attributes["found"] = true;
      return { value: rows[0].value as T, expiresAt: rows[0].expiresAt ?? null };
    });
  }

  async set<T>(
    namespace: string,
    key: string,
    value: T,
    expiresAt: number | null,
    policy: DurableNamespacePolicy,
  ): Promise<void> {
    return await traced("DurableCacheStore.set", "db.query", async (span) => {
      span.attributes["namespace"] = namespace;
      const { db, table } = await this.resolve(policy);
      const nowSec = getTimeNowForStorage();
      await db.insert(table)
        .values({ namespace, key, value: value as unknown, expiresAt, createdAt: nowSec, updatedAt: nowSec })
        .onConflictDoUpdate({
          target: [table.namespace, table.key],
          set: { value: value as unknown, expiresAt, updatedAt: nowSec },
        });
    });
  }

  async delete(namespace: string, key: string, policy: DurableNamespacePolicy): Promise<void> {
    return await traced("DurableCacheStore.delete", "db.query", async (span) => {
      span.attributes["namespace"] = namespace;
      const { db, table } = await this.resolve(policy);
      await db.delete(table).where(and(eq(table.namespace, namespace), eq(table.key, key)));
    });
  }

  /**
   * Deletes keys matching a glob within a namespace. The cache contract passes a glob
   * (e.g. "user:*"); libSQL GLOB matches globs directly (same semantics as the Redis
   * provider's SCAN MATCH). The pattern is a bound parameter — never interpolated.
   */
  async deletePattern(namespace: string, globPattern: string, policy: DurableNamespacePolicy): Promise<void> {
    return await traced("DurableCacheStore.deletePattern", "db.query", async (span) => {
      span.attributes["namespace"] = namespace;
      const { db, table } = await this.resolve(policy);
      await db.delete(table).where(and(eq(table.namespace, namespace), sql`${table.key} GLOB ${globPattern}`));
    });
  }

  async clearNamespace(namespace: string, policy: DurableNamespacePolicy): Promise<void> {
    return await traced("DurableCacheStore.clearNamespace", "db.query", async (span) => {
      span.attributes["namespace"] = namespace;
      const { db, table } = await this.resolve(policy);
      await db.delete(table).where(eq(table.namespace, namespace));
    });
  }

  /**
   * Reaper: bulk-deletes expired rows from an explicit handle so the caller controls
   * global vs each-tenant (phase 5). Expired rows are already treated as misses on
   * read (lazy-deleted); this just bounds table growth. Leaves null-expiry rows.
   */
  async deleteExpired(handle: DurableHandle): Promise<void> {
    return await traced("DurableCacheStore.deleteExpired", "db.query", async () => {
      const nowSec = getTimeNowForStorage();
      await handle.db.delete(handle.table)
        .where(and(sql`${handle.table.expiresAt} IS NOT NULL`, lte(handle.table.expiresAt, nowSec)));
    });
  }
}
