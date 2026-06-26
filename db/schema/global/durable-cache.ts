/**
 * @file db/schema/global/durable-cache.ts
 * @description Durable cache backing table (global scope).
 *
 * Generic DB-backed read-through/write-through store for allow-listed cache
 * namespaces whose values must survive L1/L2 eviction and process restarts.
 * Scope is decided per-namespace by policy
 * (see services/cache/cache.config.ts), NOT by the key. Global namespaces
 * (auth/identity) live here; tenant namespaces get a physically-separate table in
 * the tenant DB (deferred to phase 5).
 *
 * Composite PK (namespace, key) mirrors the physical Redis key `${namespace}:${key}`
 * as discrete columns, so `clearNamespace` (`WHERE namespace = ?`) and
 * `deletePattern` (`WHERE namespace = ? AND key GLOB ?`) are both index-friendly.
 *
 * Timestamps are unix seconds via the project helpers (matching jobLocks /
 * storageMetadata); `expires_at` is nullable (null = no expiry).
 */
import { createdAtTimestamp, dbTable, index, integer, primaryKey, text, updatedAtTimestamp } from "../../entities.ts";

export const durableCache = dbTable("durable_cache", {
  namespace: text("namespace").notNull(),
  key: text("key").notNull(),
  // Drizzle JSON-encodes/decodes; store the raw cached value (NOT the Redis
  // provider's { value, createdAt, expires } envelope). See plan §9.
  value: text("value", { mode: "json" }).notNull(),
  expiresAt: integer("expires_at"), // unix seconds; null = no expiry
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  primaryKey({ columns: [table.namespace, table.key] }),
  index("idx_durable_cache_expires_at").on(table.expiresAt),
]);
