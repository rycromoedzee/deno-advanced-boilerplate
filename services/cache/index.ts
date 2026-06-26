/**
 * @file services/cache/index.ts
 * @description Barrel exports for cache services and the cache lifecycle owner.
 * Re-exports cache interfaces, providers, and utilities, and houses the global
 * singleton lifecycle: getCache() returns the lazily-initialized GlobalCacheService,
 * warmupCache() eagerly connects the backend at boot, and closeCacheService()
 * tears it down on shutdown.
 */
import { GlobalCacheService, initializeCache } from "./cache.service.ts";

// Re-export cache interfaces and types from centralized location
export type {
  CacheConfig,
  CacheEntry,
  CacheLockOptions,
  CacheOptions,
  CacheProvider,
  CacheStatistics,
  DetailedCacheStatistics,
  DurableNamespacePolicy,
} from "@interfaces/cache.ts";

// Per-namespace operational config (runtime values) lives in cache.config.ts:
// the namespace registry, logging redaction sets, and the durability policy.
export {
  CACHE_LOG_REDACTED_KEYS,
  CACHE_NAMESPACES,
  CACHE_NAMESPACES_DO_NOT_LOG,
  DURABLE_CACHE_POLICY,
  isDurable,
  policyFor,
} from "./cache.config.ts";

// Export cache service and initialization
export { GlobalCacheService, initializeCache } from "./cache.service.ts";

// Durable cache layer (DB-backed read-through/write-through for allow-listed namespaces)
export { DurableCacheStore } from "./durable-cache.store.ts";
export type { DurableGlobalHandleProvider, DurableHandle, DurableRow } from "./durable-cache.store.ts";

// Export cache providers
export { MemoryCacheProvider } from "./memory-cache.provider.ts";
export { DenoKVCacheProvider, KVCacheProvider } from "./deno-kv-cache.provider.ts"; // KVCacheProvider is backward compatibility alias
export { MultiTierCacheProvider } from "./multi-tier-cache.provider.ts";
export { RedisCacheProvider } from "./redis-cache.provider.ts";

// Export cache utilities for reuse
export {
  batchArray,
  calculateEntrySize,
  calculateHitRate,
  createCacheKey,
  createNamespaceStats,
  formatBytes,
  formatPercentage,
  generateInstanceId,
  getByteLength,
  isExpired,
  safeJsonParse,
  safeJsonStringify,
  sanitizeGlobPattern,
  sleep,
} from "./cache-utils.ts";

export type { NamespaceStats } from "./cache-utils.ts";

// Singleton instance
let cacheInstance: GlobalCacheService | null = null;
let initializationPromise: Promise<GlobalCacheService> | null = null;

export function getCache(): Promise<GlobalCacheService> {
  if (cacheInstance) {
    return Promise.resolve(cacheInstance);
  }

  if (!initializationPromise) {
    initializationPromise = initializeCache()
      .then((instance) => {
        cacheInstance = instance;
        return instance;
      })
      .catch((error) => {
        // Reset promise on failure so retry is possible
        initializationPromise = null;
        throw error;
      });
  }

  return initializationPromise;
}

/**
 * Eagerly initialize the cache at application startup.
 *
 * The cache backend (Redis / Deno KV) connects lazily on the first `getCache()`
 * call. On a cold process that first call happens inside a request (e.g. the
 * login lockout lookup), forcing that request to pay the full connection
 * handshake cost — observed as multi-second latency on the first cache op.
 *
 * Calling this at boot moves that one-time connection cost off the request hot
 * path. It is safe to call multiple times (it simply reuses the singleton) and
 * non-fatal: failures are swallowed so startup is never blocked, and the next
 * `getCache()` will retry as before.
 */
export async function warmupCache(): Promise<void> {
  try {
    await getCache();
  } catch {
    // Non-fatal: getCache() resets its init promise on failure so the first
    // request will transparently retry. We never want warmup to crash boot.
  }
}

/**
 * Close the cache service
 * Called by global shutdown handler in main.ts
 */
export async function closeCacheService(): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.close();
    cacheInstance = null;
  }
  initializationPromise = null;
}
