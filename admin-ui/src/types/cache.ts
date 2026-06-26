/**
 * Cache types for the admin UI.
 *
 * Backend-mirrored response shapes are aliased to the generated OpenAPI types
 * (`./api.generated.ts`) so the backend contract is the single source of truth
 * and contract drift fails at compile time. UI-only display types remain
 * hand-written below.
 */

import type { components } from "./api.generated";

/**
 * A single cache entry returned by the STREAMING `/__cache-insights/data`
 * endpoint. This endpoint streams NDJSON and has no generated response schema,
 * so this shape stays hand-written (see cache.service.ts → getCacheData()).
 */
export interface CacheEntry {
  namespace: string;
  key: string;
  value: unknown;
  ttl: string | null;
  expiresAt: number | null;
  size: number;
  createdAt: number;
}

/** Aggregated per-scope cache statistics (mirrors AdminDetailedCacheStats). */
export type CacheStatistics = components["schemas"]["AdminDetailedCacheStats"];

/** Detailed cache statistics (mirrors AdminDetailedCacheStats). */
export type DetailedCacheStatistics = components["schemas"]["AdminDetailedCacheStats"];

/** Top-level cache stats payload (mirrors AdminCacheStats). */
export type CacheStats = components["schemas"]["AdminCacheStats"];

/** UI-only filter dropdown option. */
export interface FilterOption {
  value: string;
  label: string;
}

/** UI-only stat-card display model. */
export interface StatCardData {
  label: string;
  value: number | string;
  color?: string;
  formatter?: (value: any) => string;
}
