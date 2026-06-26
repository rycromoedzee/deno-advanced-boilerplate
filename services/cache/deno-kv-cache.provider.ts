/**
 * @file services/cache/deno-kv-cache.provider.ts
 * @description Deno KV-based cache provider for development and fallback scenarios
 */

import { CacheEntry, CacheOptions, CacheProvider, CacheStatistics, DetailedCacheStatistics } from "@interfaces/cache.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { envConfig } from "@config/env.ts";
import { AppHttpException } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { calculateEntrySize, calculateHitRate, createNamespaceStats, isExpired, type NamespaceStats, sleep } from "./cache-utils.ts";

// Queue operation retry configuration
const QUEUE_MAX_RETRIES = 10;
const QUEUE_INITIAL_BACKOFF_MS = 10;
const QUEUE_MAX_BACKOFF_MS = 1000;

// NamespaceStats is now imported from cache-utils.ts

export class DenoKVCacheProvider implements CacheProvider {
  private kv!: Deno.Kv;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private cleanupIntervalMs: number;
  private isInitialized = false;

  constructor(cleanupIntervalMs?: number) {
    // Default to 2 hours if not specified, or use environment config
    this.cleanupIntervalMs = cleanupIntervalMs ||
      (envConfig.cache.ttlCleanupIntervalMinutes * 60 * 1000 * 24); // 24x longer for KV cleanup
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.kv = await Deno.openKv();

    // Initialize global stats if they don't exist
    const globalStats = await this.kv.get(["stats", "global"]);
    if (!globalStats.value) {
      const now = new Date();
      await this.kv.set(["stats", "global"], {
        hits: 0,
        misses: 0,
        createdTime: now,
        lastResetTime: now,
      });
    }

    this.startCleanupTask();
    this.isInitialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }
  }

  private startCleanupTask() {
    this.cleanupIntervalId = setInterval(async () => {
      await this.cleanupExpiredEntries();
    }, this.cleanupIntervalMs);
  }

  private async cleanupExpiredEntries(): Promise<void> {
    const now = getTimeNow();
    const entries = this.kv.list({ prefix: ["cache"] });

    for await (const entry of entries) {
      const cacheEntry = entry.value as CacheEntry<unknown>;
      if (cacheEntry.expires && cacheEntry.expires < now) {
        await this.kv.delete(entry.key);
      }
    }
  }

  private stopCleanupTask() {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  private async getValidEntryCount(namespace?: string): Promise<number> {
    const now = getTimeNow();
    let count = 0;

    const prefix = namespace ? ["cache", namespace] : ["cache"];
    const entries = this.kv.list({ prefix });

    for await (const entry of entries) {
      const cacheEntry = entry.value as CacheEntry<unknown>;
      if (!cacheEntry.expires || cacheEntry.expires > now) {
        count++;
      }
    }

    return count;
  }

  // calculateEntrySize is now imported from cache-utils.ts

  private async calculateNamespaceSize(namespace: string): Promise<number> {
    let total = 0;
    const now = getTimeNow();

    const entries = this.kv.list({ prefix: ["cache", namespace] });
    for await (const entry of entries) {
      const cacheEntry = entry.value as CacheEntry<unknown>;
      if (!cacheEntry.expires || cacheEntry.expires > now) {
        const key = entry.key[entry.key.length - 1] as string;
        total += calculateEntrySize(key, cacheEntry.value, 0); // No overhead for KV
      }
    }

    return total;
  }

  private async recordHit(namespace: string): Promise<void> {
    await this.ensureInitialized();

    // Update namespace stats
    await this.updateNamespaceStats(namespace, { hits: 1 });

    // Update global stats
    await this.updateGlobalStats({ hits: 1 });
  }

  private async recordMiss(namespace: string): Promise<void> {
    await this.ensureInitialized();

    // Update namespace stats
    await this.updateNamespaceStats(namespace, { misses: 1 });

    // Update global stats
    await this.updateGlobalStats({ misses: 1 });
  }

  private async updateNamespaceStats(
    namespace: string,
    updates: { hits?: number; misses?: number },
  ): Promise<void> {
    const statsKey = ["stats", "namespace", namespace];
    const existing = await this.kv.get(statsKey);

    let stats: NamespaceStats;
    if (existing.value) {
      stats = existing.value as NamespaceStats;
    } else {
      const now = new Date();
      stats = {
        hits: 0,
        misses: 0,
        createdTime: now,
        lastResetTime: now,
      };
    }

    if (updates.hits) stats.hits += updates.hits;
    if (updates.misses) stats.misses += updates.misses;

    await this.kv.set(statsKey, stats);
  }

  private async updateGlobalStats(
    updates: { hits?: number; misses?: number },
  ): Promise<void> {
    const statsKey = ["stats", "global"];
    const existing = await this.kv.get(statsKey);

    const stats = existing.value as NamespaceStats;
    if (updates.hits) stats.hits += updates.hits;
    if (updates.misses) stats.misses += updates.misses;

    await this.kv.set(statsKey, stats);
  }

  private async getNamespaceStats(namespace: string): Promise<NamespaceStats> {
    const result = await this.kv.get(["stats", "namespace", namespace]);
    if (result.value) {
      return result.value as NamespaceStats;
    }

    return createNamespaceStats();
  }

  private async getGlobalStats(): Promise<NamespaceStats> {
    const result = await this.kv.get(["stats", "global"]);
    return result.value as NamespaceStats;
  }

  // calculateHitRate is now imported from cache-utils.ts

  /**
   * Liveness probe — issues a real KV read. Does NOT fail open: a KV error
   * rejects and is converted to false, so a disconnected backend is detected.
   */
  async ping(): Promise<boolean> {
    try {
      await this.kv.get(["__healthcheck__"]);
      return true;
    } catch {
      return false;
    }
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    try {
      await this.ensureInitialized();

      const entry = await this.kv.get(["cache", namespace, key]);

      if (!entry.value) {
        this.recordMiss(namespace);
        return null;
      }

      const cacheEntry = entry.value as CacheEntry<T>;

      if (isExpired(cacheEntry.expires)) {
        await this.kv.delete(["cache", namespace, key]);
        this.recordMiss(namespace);
        return null;
      }

      this.recordHit(namespace);
      return cacheEntry.value;
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error getting value from DenoKV cache",
        messageKey: "cache.deno_kv.get.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });

      this.recordMiss(namespace);
      return null;
    }
  }

  async getAndDelete<T>(namespace: string, key: string): Promise<T | null> {
    try {
      await this.ensureInitialized();

      const kvKey: Deno.KvKey = ["cache", namespace, key];
      const entry = await this.kv.get(kvKey);

      if (!entry.value) {
        this.recordMiss(namespace);
        return null;
      }

      const cacheEntry = entry.value as CacheEntry<T>;

      if (isExpired(cacheEntry.expires)) {
        await this.kv.delete(kvKey);
        this.recordMiss(namespace);
        return null;
      }

      const atomicResult = await this.kv.atomic()
        .check(entry)
        .delete(kvKey)
        .commit();

      if (!atomicResult.ok) {
        this.recordMiss(namespace);
        return null;
      }

      this.recordHit(namespace);
      return cacheEntry.value;
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error in DenoKV getAndDelete",
        messageKey: "cache.deno_kv.get_and_delete.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });

      this.recordMiss(namespace);
      return null;
    }
  }

  async set<T>(
    namespace: string,
    key: string,
    value: T,
    options?: CacheOptions,
  ): Promise<void> {
    try {
      await this.ensureInitialized();

      const entry: CacheEntry<T> = {
        value,
        expires: options?.ttl ? getTimeNow() + (options.ttl * 1000) : undefined,
        createdAt: getTimeNow(),
      };

      // Use KV's built-in TTL if available
      const kvOptions = options?.ttl ? { expireIn: options.ttl * 1000 } : undefined;

      await this.kv.set(["cache", namespace, key], entry, kvOptions);

      if (options?.maxSize) {
        const count = await this.getValidEntryCount(namespace);
        if (count > options.maxSize) {
          // Remove oldest entry
          const entries = this.kv.list({ prefix: ["cache", namespace] });
          let oldest: { key: Deno.KvKey; createdAt: number } | null = null;

          for await (const entry of entries) {
            const cacheEntry = entry.value as CacheEntry<unknown>;
            if (!oldest || cacheEntry.createdAt < oldest.createdAt) {
              oldest = { key: entry.key, createdAt: cacheEntry.createdAt };
            }
          }

          if (oldest) {
            await this.kv.delete(oldest.key);
          }
        }
      }
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error setting value in DenoKV cache",
        messageKey: "cache.deno_kv.set.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    try {
      await this.ensureInitialized();
      await this.kv.delete(["cache", namespace, key]);
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error deleting value from DenoKV cache",
        messageKey: "cache.deno_kv.delete.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });
    }
  }

  async getAllInNamespace(
    namespace: string,
  ): Promise<Map<string, CacheEntry<string | null>>> {
    await this.ensureInitialized();

    const result = new Map<string, CacheEntry<string | null>>();
    const entries = this.kv.list({ prefix: ["cache", namespace] });

    for await (const entry of entries) {
      const key = entry.key[entry.key.length - 1] as string;
      const cacheEntry = entry.value as CacheEntry<string | null>;

      // Check if not expired
      if (!cacheEntry.expires || cacheEntry.expires > getTimeNow()) {
        result.set(key, cacheEntry);
      }
    }

    return result;
  }

  async deletePattern(namespace: string, pattern: string): Promise<void> {
    await this.ensureInitialized();

    try {
      // Convert glob pattern to regex pattern
      // First escape special regex chars, but preserve * and ? for glob conversion
      const escapedPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex chars except * and ?
        .replace(/\*/g, ".*") // Convert * to .*
        .replace(/\?/g, "."); // Convert ? to .
      const regex = new RegExp(`^${escapedPattern}$`);

      const entries = this.kv.list({ prefix: ["cache", namespace] });
      const keysToDelete: Deno.KvKey[] = [];

      for await (const entry of entries) {
        const key = entry.key[entry.key.length - 1] as string;
        if (regex.test(key)) {
          keysToDelete.push(entry.key);
        }
      }

      for (const key of keysToDelete) {
        await this.kv.delete(key);
      }
    } catch (error) {
      console.error("Pattern matching error:", error);
    }
  }

  async clearNamespace(namespace: string): Promise<void> {
    try {
      await this.ensureInitialized();

      const entries = this.kv.list({ prefix: ["cache", namespace] });
      for await (const entry of entries) {
        await this.kv.delete(entry.key);
      }

      // Reset statistics for the cleared namespace
      await this.resetStats(namespace);
    } catch {
      // If KV is already closed, ignore the error
      return;
    }
  }

  async getEntryCount(namespace?: string): Promise<number> {
    await this.ensureInitialized();
    return await this.getValidEntryCount(namespace);
  }

  async getAverageEntrySize(namespace?: string): Promise<number> {
    const totalSize = await this.getTotalSize(namespace);
    const entryCount = await this.getEntryCount(namespace);
    return entryCount > 0 ? totalSize / entryCount : 0;
  }

  async getTotalSize(namespace?: string): Promise<number> {
    await this.ensureInitialized();

    if (namespace) {
      return await this.calculateNamespaceSize(namespace);
    }

    let total = 0;
    const namespaces = await this.getAllNamespaces();
    for (const ns of namespaces) {
      total += await this.calculateNamespaceSize(ns);
    }
    return total;
  }

  async getAllNamespaces(): Promise<string[]> {
    await this.ensureInitialized();

    const namespaces = new Set<string>();
    const entries = this.kv.list({ prefix: ["cache"] });

    for await (const entry of entries) {
      if (entry.key.length >= 2) {
        const namespace = entry.key[1] as string;
        const cacheEntry = entry.value as CacheEntry<unknown>;

        // Only include namespaces with non-expired entries
        if (!cacheEntry.expires || cacheEntry.expires > getTimeNow()) {
          namespaces.add(namespace);
        }
      }
    }

    return Array.from(namespaces).sort();
  }

  async getDetailedStats(namespace?: string): Promise<DetailedCacheStatistics> {
    await this.ensureInitialized();

    const entryCount = await this.getEntryCount(namespace);
    const totalSize = await this.getTotalSize(namespace);
    const avgSize = await this.getAverageEntrySize(namespace);

    let stats: NamespaceStats;
    if (namespace) {
      stats = await this.getNamespaceStats(namespace);
    } else {
      stats = await this.getGlobalStats();
    }

    const hitRate = calculateHitRate(stats.hits, stats.misses);

    // Calculate size distribution
    let largest = 0, smallest = Infinity;
    const prefix = namespace ? ["cache", namespace] : ["cache"];
    const entries = this.kv.list({ prefix });

    for await (const entry of entries) {
      const cacheEntry = entry.value as CacheEntry<unknown>;
      if (!cacheEntry.expires || cacheEntry.expires > getTimeNow()) {
        const key = entry.key[entry.key.length - 1] as string;
        const size = calculateEntrySize(key, cacheEntry.value, 0); // No overhead for KV
        largest = Math.max(largest, size);
        smallest = Math.min(smallest, size);
      }
    }

    return {
      hits: stats.hits,
      misses: stats.misses,
      hitRate,
      entryCount,
      totalSize,
      averageEntrySize: avgSize,
      largestEntrySize: largest === 0 ? 0 : largest,
      smallestEntrySize: smallest === Infinity ? 0 : smallest,
      namespace,
      lastResetTime: stats.lastResetTime,
      createdTime: stats.createdTime,
    };
  }

  async getStats(namespace?: string): Promise<CacheStatistics> {
    await this.ensureInitialized();

    const entryCount = await this.getEntryCount(namespace);
    const totalSize = await this.getTotalSize(namespace);
    const averageEntrySize = await this.getAverageEntrySize(namespace);

    let stats: NamespaceStats;
    if (namespace) {
      stats = await this.getNamespaceStats(namespace);
    } else {
      stats = await this.getGlobalStats();
    }

    const hitRate = calculateHitRate(stats.hits, stats.misses);

    return {
      hits: stats.hits,
      misses: stats.misses,
      hitRate,
      entryCount,
      totalSize,
      averageEntrySize,
      namespace,
      lastResetTime: stats.lastResetTime,
      createdTime: stats.createdTime,
    };
  }

  async resetStats(namespace?: string): Promise<void> {
    try {
      await this.ensureInitialized();
    } catch {
      // If KV is already closed, skip stats reset
      return;
    }

    const now = getTimeNow();

    if (namespace) {
      // Get current namespace stats
      const currentStats = await this.getNamespaceStats(namespace);

      // Reset namespace stats
      await this.kv.set(["stats", "namespace", namespace], {
        hits: 0,
        misses: 0,
        createdTime: currentStats.createdTime,
        lastResetTime: now,
      });

      // Update global stats by subtracting the reset namespace stats
      const globalStats = await this.getGlobalStats();
      await this.kv.set(["stats", "global"], {
        ...globalStats,
        hits: Math.max(0, globalStats.hits - currentStats.hits),
        misses: Math.max(0, globalStats.misses - currentStats.misses),
        lastResetTime: now,
      });
    } else {
      // Reset global stats
      const globalStats = await this.getGlobalStats();
      await this.kv.set(["stats", "global"], {
        ...globalStats,
        hits: 0,
        misses: 0,
        lastResetTime: now,
      });

      // Reset all namespace stats
      const entries = this.kv.list({ prefix: ["stats", "namespace"] });
      for await (const entry of entries) {
        const stats = entry.value as NamespaceStats;
        await this.kv.set(entry.key, {
          ...stats,
          hits: 0,
          misses: 0,
          lastResetTime: now,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Queue operations — atomic FIFO using Deno KV head/tail index transactions
  // ---------------------------------------------------------------------------

  /**
   * Atomically append a value to the tail of a named queue.
   * Uses an optimistic-lock loop with bounded retries and exponential backoff
   * so concurrent enqueues on multiple instances are safe.
   * @throws Error if max retries exceeded
   */
  async enqueue(queueName: string, value: string): Promise<void> {
    await this.ensureInitialized();

    for (let attempt = 0; attempt < QUEUE_MAX_RETRIES; attempt++) {
      const tailEntry = await this.kv.get<number>(["queue_tail", queueName]);
      const tail = tailEntry.value ?? 0;
      const result = await this.kv.atomic()
        .check(tailEntry)
        .set(["queue_tail", queueName], tail + 1)
        .set(["queue", queueName, tail], value)
        .commit();

      if (result.ok) return;

      // Exponential backoff with cap
      const backoff = Math.min(
        QUEUE_INITIAL_BACKOFF_MS * Math.pow(2, attempt),
        QUEUE_MAX_BACKOFF_MS,
      );
      await sleep(backoff);
    }

    throw new Error(`Failed to enqueue to "${queueName}" after ${QUEUE_MAX_RETRIES} attempts`);
  }

  /**
   * Atomically dequeue a value from the head of a named queue.
   * Returns null if the queue is empty.
   * Uses an optimistic-lock loop with bounded retries for multi-instance safety.
   * @throws Error if max retries exceeded
   */
  async dequeue(queueName: string): Promise<string | null> {
    await this.ensureInitialized();

    for (let attempt = 0; attempt < QUEUE_MAX_RETRIES; attempt++) {
      const headEntry = await this.kv.get<number>(["queue_head", queueName]);
      const tailEntry = await this.kv.get<number>(["queue_tail", queueName]);
      const head = headEntry.value ?? 0;
      const tail = tailEntry.value ?? 0;

      if (head >= tail) return null; // Queue empty

      const itemEntry = await this.kv.get<string>(["queue", queueName, head]);

      const result = await this.kv.atomic()
        .check(headEntry)
        .check(itemEntry)
        .set(["queue_head", queueName], head + 1)
        .delete(["queue", queueName, head])
        .commit();

      if (result.ok) {
        return itemEntry.value ?? null;
      }

      // Exponential backoff with cap
      const backoff = Math.min(
        QUEUE_INITIAL_BACKOFF_MS * Math.pow(2, attempt),
        QUEUE_MAX_BACKOFF_MS,
      );
      await sleep(backoff);
    }

    throw new Error(`Failed to dequeue from "${queueName}" after ${QUEUE_MAX_RETRIES} attempts`);
  }

  /**
   * Return the number of items currently in the queue.
   */
  async queueLength(queueName: string): Promise<number> {
    await this.ensureInitialized();
    const head = (await this.kv.get<number>(["queue_head", queueName])).value ?? 0;
    const tail = (await this.kv.get<number>(["queue_tail", queueName])).value ?? 0;
    return Math.max(0, tail - head);
  }

  async acquireLock(lockKey: string, token: string, ttlMs: number): Promise<boolean> {
    await this.ensureInitialized();
    const kvKey: Deno.KvKey = ["lock", lockKey];
    const entry = await this.kv.get(kvKey);

    const result = await this.kv.atomic()
      .check(entry)
      .set(kvKey, { token }, { expireIn: ttlMs })
      .commit();

    return result.ok;
  }

  async releaseLock(lockKey: string, token: string): Promise<boolean> {
    await this.ensureInitialized();
    const kvKey: Deno.KvKey = ["lock", lockKey];
    const entry = await this.kv.get<{ token: string }>(kvKey);
    if (!entry.value || entry.value.token !== token) return false;

    const result = await this.kv.atomic()
      .check(entry)
      .delete(kvKey)
      .commit();

    return result.ok;
  }

  close(): Promise<void> {
    this.stopCleanupTask();
    if (this.kv) {
      this.kv.close();
    }
    return Promise.resolve();
  }
}

let kvCacheProvider: DenoKVCacheProvider;
export function useDenoKVCacheProvider(
  cleanupIntervalMs?: number,
): DenoKVCacheProvider {
  if (!kvCacheProvider) {
    kvCacheProvider = new DenoKVCacheProvider(cleanupIntervalMs);
  }
  return kvCacheProvider;
}

// Backward compatibility alias
export const KVCacheProvider = DenoKVCacheProvider;
export const useKVCacheProvider = useDenoKVCacheProvider;
