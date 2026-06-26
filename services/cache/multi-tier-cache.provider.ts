/**
 * @file services/cache/multi-tier-cache.provider.ts
 * @description Multi-tier cache provider combining L1 (memory) and L2 (Redis/KV) layers
 */

import { CacheEntry, CacheOptions, CacheProvider, CacheStatistics, DetailedCacheStatistics } from "@interfaces/cache.ts";
import { CACHE_NAMESPACES } from "./cache.config.ts";
import { MemoryCacheProvider } from "./memory-cache.provider.ts";
import { envConfig } from "@config/env.ts";
import { RedisCacheProvider } from "./redis-cache.provider.ts";
import { calculateEntrySize } from "./cache-utils.ts";

interface MultiTierOptions {
  l1MaxSize?: number; // L1 cache max size in bytes (default: 50MB)
  l1MaxEntries?: number; // L1 cache max entries (default: 10000)
  l1TtlCleanupInterval?: number; // L1 TTL cleanup interval (default: 5 minutes)
  l1HotNamespaces?: string[]; // Namespaces that should always use L1
  l1SkipNamespaces?: string[]; // Namespaces that should skip L1
  l1SkipLargeValues?: boolean; // Skip L1 for large values (default: true)
  l1LargeValueThreshold?: number; // Threshold for large values in bytes (default: 10KB)
}

interface MultiTierStats extends CacheStatistics {
  l1Stats: CacheStatistics;
  l2Stats: CacheStatistics;
  l1HitRate: number;
  l2HitRate: number;
  overallHitRate: number;
}

export class MultiTierCacheProvider implements CacheProvider {
  private l1Cache: MemoryCacheProvider;
  private l2Cache: CacheProvider;
  private options: Required<MultiTierOptions>;

  constructor(l2Cache: CacheProvider, options: MultiTierOptions = {}) {
    this.l2Cache = l2Cache;

    this.options = {
      l1MaxSize: options.l1MaxSize || envConfig.cache.l1MaxSize,
      l1MaxEntries: options.l1MaxEntries || envConfig.cache.l1MaxEntries,
      l1TtlCleanupInterval: options.l1TtlCleanupInterval ||
        (envConfig.cache.ttlCleanupIntervalMinutes * 60 * 1000),
      l1HotNamespaces: options.l1HotNamespaces || [
        CACHE_NAMESPACES.AUTH.JWT_SESSION,
        CACHE_NAMESPACES.PERMISSIONS.GROUPS,
        CACHE_NAMESPACES.PERMISSIONS.USER,
        CACHE_NAMESPACES.PERMISSIONS.API_KEY,
        CACHE_NAMESPACES.PERMISSIONS.ADMIN,
        CACHE_NAMESPACES.AUTH.API_KEY,
        CACHE_NAMESPACES.RATE_LIMITS,
        CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
      ],
      l1SkipNamespaces: options.l1SkipNamespaces || [
        CACHE_NAMESPACES.PERMISSIONS.ALL,
        CACHE_NAMESPACES.AUTH.USER_SESSIONS,
        CACHE_NAMESPACES.THREAT_INTELLIGENCE.LOOKUP_CACHE,
      ],
      l1SkipLargeValues: options.l1SkipLargeValues ?? true,
      l1LargeValueThreshold: options.l1LargeValueThreshold ||
        (envConfig.cache.l1LargeValueThresholdKB * 1024),
    };

    this.l1Cache = new MemoryCacheProvider({
      maxSize: this.options.l1MaxSize,
      maxEntries: this.options.l1MaxEntries,
      ttlCleanupInterval: this.options.l1TtlCleanupInterval,
    });

    if (this.l2Cache instanceof RedisCacheProvider) {
      this.l2Cache.onInvalidation(
        async (namespace: string, key?: string, pattern?: string) => {
          if (key) {
            await this.l1Cache.delete(namespace, key);
          } else if (pattern) {
            await this.l1Cache.deletePattern(namespace, pattern);
          } else {
            await this.l1Cache.clearNamespace(namespace);
          }
        },
      );
    }
  }

  private shouldUseL1(namespace: string, value?: unknown): boolean {
    if (this.options.l1SkipNamespaces.includes(namespace)) {
      return false;
    }

    if (this.options.l1HotNamespaces.includes(namespace)) {
      return true;
    }

    if (value !== undefined && this.options.l1SkipLargeValues) {
      try {
        const size = calculateEntrySize("", value, 0);
        if (size > this.options.l1LargeValueThreshold) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Liveness probe — L1 (memory) is always reachable, so liveness is determined
   * by the L2 backend.
   */
  async ping(): Promise<boolean> {
    return await this.l2Cache.ping();
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    if (this.shouldUseL1(namespace)) {
      const l1Result = await this.l1Cache.get<T>(namespace, key);
      if (l1Result !== null) {
        return l1Result;
      }
    }

    const l2Result = await this.l2Cache.get<T>(namespace, key);
    if (l2Result !== null) {
      if (this.shouldUseL1(namespace, l2Result)) {
        this.l1Cache.set(namespace, key, l2Result).catch((err) => {
          // L1 failures are non-critical but should be monitored
          console.debug(`[MultiTierCache] L1 cache set failed (non-critical):`, {
            namespace,
            key,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      return l2Result;
    }

    return null;
  }

  async getAndDelete<T>(namespace: string, key: string): Promise<T | null> {
    await this.l1Cache.delete(namespace, key);
    return await this.l2Cache.getAndDelete<T>(namespace, key);
  }

  async set<T>(
    namespace: string,
    key: string,
    value: T,
    options?: CacheOptions,
  ): Promise<void> {
    const shouldUseL1 = this.shouldUseL1(namespace, value);
    await this.l2Cache.set(namespace, key, value, options);

    if (shouldUseL1) {
      this.l1Cache.set(namespace, key, value, options).catch((err) => {
        // L1 failures are non-critical but should be monitored
        console.debug(`[MultiTierCache] L1 cache set failed (non-critical):`, {
          namespace,
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    await Promise.all([
      this.l2Cache.delete(namespace, key),
      this.l1Cache.delete(namespace, key),
    ]);
  }

  async deletePattern(namespace: string, pattern: string): Promise<void> {
    await Promise.all([
      this.l2Cache.deletePattern(namespace, pattern),
      this.l1Cache.deletePattern(namespace, pattern),
    ]);
  }

  async clearNamespace(namespace: string): Promise<void> {
    await Promise.all([
      this.l2Cache.clearNamespace(namespace),
      this.l1Cache.clearNamespace(namespace),
    ]);
  }

  async getAllInNamespace(
    namespace: string,
  ): Promise<Map<string, CacheEntry<string | null>>> {
    return await this.l2Cache.getAllInNamespace(namespace);
  }

  async getEntryCount(namespace?: string): Promise<number> {
    return await this.l2Cache.getEntryCount(namespace);
  }

  async getAverageEntrySize(namespace?: string): Promise<number> {
    return await this.l2Cache.getAverageEntrySize(namespace);
  }

  async getTotalSize(namespace?: string): Promise<number> {
    return await this.l2Cache.getTotalSize(namespace);
  }

  async getAllNamespaces(): Promise<string[]> {
    return await this.l2Cache.getAllNamespaces();
  }

  async getStats(namespace?: string): Promise<CacheStatistics> {
    return await this.l2Cache.getStats(namespace);
  }

  async getDetailedStats(namespace?: string): Promise<DetailedCacheStatistics> {
    return await this.l2Cache.getDetailedStats(namespace);
  }

  /**
   * Get comprehensive multi-tier statistics
   */
  async getMultiTierStats(namespace?: string): Promise<MultiTierStats> {
    const [l1Stats, l2Stats] = await Promise.all([
      this.l1Cache.getStats(namespace),
      this.l2Cache.getStats(namespace),
    ]);

    const l1HitRate = l1Stats.hitRate;
    const l2HitRate = l2Stats.hitRate;

    // Each tier maintains independent hit/miss counters, so they cannot simply
    // be subtracted from one another. Reconstruct true external request volume
    // from the multi-tier read path:
    //   - Every L1-eligible read consults L1 → counted in (l1.hits + l1.misses).
    //   - On an L1 miss we consult L2 → those L2 lookups equal l1.misses.
    //   - L2-only reads (L1-skipped namespaces) appear solely in L2 counters as
    //     additional lookups beyond the ones triggered by L1 misses.
    //
    // External requests = L1 lookups + L2-only lookups
    //   L2-only lookups = (l2.hits + l2.misses) - l1.misses   (clamped at 0)
    // Served-from-cache  = l1.hits + l2.hits
    const l1Lookups = l1Stats.hits + l1Stats.misses;
    const l2Lookups = l2Stats.hits + l2Stats.misses;
    const l2OnlyLookups = Math.max(0, l2Lookups - l1Stats.misses);
    const totalRequests = l1Lookups + l2OnlyLookups;

    const servedFromCache = l1Stats.hits + l2Stats.hits;
    const overallHitRate = totalRequests > 0 ? Math.min(100, (servedFromCache / totalRequests) * 100) : 0;

    return {
      ...l2Stats,
      l1Stats,
      l2Stats,
      l1HitRate,
      l2HitRate,
      overallHitRate,
    };
  }

  /**
   * Get L1 cache memory usage information
   */
  getL1MemoryUsage(): { used: number; max: number; percentage: number } {
    return this.l1Cache.getMemoryUsage();
  }

  /**
   * Get L1 cache eviction statistics
   */
  getL1EvictionStats(namespace?: string): { evictions: number } {
    return this.l1Cache.getEvictionStats(namespace);
  }

  /**
   * Warm up L1 cache with frequently accessed data from L2
   */
  async warmupL1Cache(
    namespaces: string[] = this.options.l1HotNamespaces,
    maxEntriesPerNamespace: number = 100,
  ): Promise<void> {
    for (const namespace of namespaces) {
      try {
        const entries = await this.l2Cache.getAllInNamespace(namespace);
        let count = 0;

        for (const [key, entry] of entries) {
          if (count >= maxEntriesPerNamespace) break;

          if (this.shouldUseL1(namespace, entry.value)) {
            await this.l1Cache.set(namespace, key, entry.value, {
              ttl: entry.expires ? Math.max(0, (entry.expires - Date.now()) / 1000) : undefined,
            });
            count++;
          }
        }
      } catch (error) {
        console.warn(
          `Failed to warmup L1 cache for namespace ${namespace}:`,
          error,
        );
      }
    }
  }

  /**
   * Invalidate specific key from both layers (useful for cache bus)
   */
  async invalidateKey(namespace: string, key: string): Promise<void> {
    await this.delete(namespace, key);
  }

  /**
   * Invalidate pattern from both layers (useful for cache bus)
   */
  async invalidatePattern(namespace: string, pattern: string): Promise<void> {
    await this.deletePattern(namespace, pattern);
  }

  resetStats(namespace?: string): void {
    this.l1Cache.resetStats(namespace);
    this.l2Cache.resetStats(namespace);
  }

  // ---------------------------------------------------------------------------
  // Queue operations — always delegate to L2 (durable tier) only.
  // Queue state must never be split across L1/L2 tiers.
  // ---------------------------------------------------------------------------

  /**
   * Enqueue to the durable L2 backend.
   * L1 (memory) is intentionally bypassed to preserve cross-instance ordering.
   */
  async enqueue(queueName: string, value: string): Promise<void> {
    if (!this.l2Cache.enqueue) {
      throw new Error("L2 cache provider does not support queue operations");
    }
    await this.l2Cache.enqueue(queueName, value);
  }

  /**
   * Dequeue from the durable L2 backend.
   * Returns null if the queue is empty.
   */
  async dequeue(queueName: string): Promise<string | null> {
    if (!this.l2Cache.dequeue) return null;
    return await this.l2Cache.dequeue(queueName);
  }

  /**
   * Return the current queue length from the durable L2 backend.
   */
  async queueLength(queueName: string): Promise<number> {
    if (!this.l2Cache.queueLength) return 0;
    return await this.l2Cache.queueLength(queueName);
  }

  async acquireLock(lockKey: string, token: string, ttlMs: number): Promise<boolean> {
    return await this.l2Cache.acquireLock(lockKey, token, ttlMs);
  }

  async releaseLock(lockKey: string, token: string): Promise<boolean> {
    return await this.l2Cache.releaseLock(lockKey, token);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.l1Cache.close(),
      this.l2Cache.close(),
    ]);
  }

  /**
   * Get configuration information
   */
  getConfiguration(): {
    l1MaxSize: number;
    l1MaxEntries: number;
    l1HotNamespaces: string[];
    l1SkipNamespaces: string[];
    l1LargeValueThreshold: number;
  } {
    return {
      l1MaxSize: this.options.l1MaxSize,
      l1MaxEntries: this.options.l1MaxEntries,
      l1HotNamespaces: [...this.options.l1HotNamespaces],
      l1SkipNamespaces: [...this.options.l1SkipNamespaces],
      l1LargeValueThreshold: this.options.l1LargeValueThreshold,
    };
  }

  /**
   * Get cache bus status for monitoring
   */
  getCacheBusStatus() {
    if (this.l2Cache instanceof RedisCacheProvider) {
      return this.l2Cache.getCacheBusStatus();
    }
    return {
      enabled: false,
      isListening: false,
      instanceId: null,
      channelName: null,
      hasRedis: false,
      callbackCount: 0,
    };
  }

  /**
   * Get the underlying Redis connection for Pub/Sub use
   * Returns null if not using Redis backend
   */
  getRedisConnection(): { publisher: unknown; subscriber: unknown } | null {
    if (this.l2Cache instanceof RedisCacheProvider) {
      return this.l2Cache.getRedisConnection();
    }
    return null;
  }
}
