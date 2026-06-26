/**
 * @file services/cache/memory-cache.provider.ts
 * @description In-memory L1 cache provider with LRU eviction
 */

import { CacheEntry, CacheOptions, CacheProvider, CacheStatistics, DetailedCacheStatistics } from "@interfaces/cache.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { envConfig } from "@config/env.ts";
import { AppHttpException } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import {
  calculateEntrySize,
  calculateHitRate,
  createCacheKey,
  createNamespaceStats,
  isExpired,
  type NamespaceStats,
} from "./cache-utils.ts";

interface MemoryCacheEntry<T> extends CacheEntry<T> {
  lastAccessed: number;
  accessCount: number;
  size: number;
}

// NamespaceStats is now imported from cache-utils.ts

interface MemoryCacheOptions {
  maxSize?: number; // Maximum memory in bytes (default: from env config)
  maxEntries?: number; // Maximum number of entries (default: from env config)
  ttlCleanupInterval?: number; // TTL cleanup interval in ms (default: from env config)
}

export class MemoryCacheProvider implements CacheProvider {
  private cache: Map<string, MemoryCacheEntry<unknown>> = new Map();
  private namespaceStats: Map<string, NamespaceStats> = new Map();
  private globalStats: NamespaceStats;
  private currentSize = 0;
  private maxSize: number;
  private maxEntries: number;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private locks: Map<string, { token: string; expiresAt: number }> = new Map();

  constructor(options: MemoryCacheOptions = {}) {
    this.maxSize = options.maxSize || envConfig.cache.l1MaxSize;
    this.maxEntries = options.maxEntries || envConfig.cache.l1MaxEntries;

    this.globalStats = createNamespaceStats();

    // Start TTL cleanup task
    const cleanupInterval = options.ttlCleanupInterval ||
      (envConfig.cache.ttlCleanupIntervalMinutes * 60 * 1000);
    this.startCleanupTask(cleanupInterval);
  }

  private startCleanupTask(intervalMs: number): void {
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredEntries();
    }, intervalMs);
  }

  private stopCleanupTask(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  private cleanupExpiredEntries(): void {
    const now = getTimeNow();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires && entry.expires < now) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const entry = this.cache.get(key);
      if (entry) {
        this.currentSize -= entry.size;
        this.cache.delete(key);
      }
    }
  }

  private getFullKey(namespace: string, key: string): string {
    return createCacheKey(namespace, key);
  }

  private evictLRU(): void {
    if (this.cache.size === 0) return;

    // Find least recently used entry
    let lruKey = "";
    let lruTime = Infinity;
    let lruNamespace = "";

    for (const [fullKey, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = fullKey;
        lruNamespace = fullKey.split(":")[0];
      }
    }

    if (lruKey) {
      const entry = this.cache.get(lruKey);
      if (entry) {
        this.currentSize -= entry.size;
        this.cache.delete(lruKey);

        // Record eviction
        this.recordEviction(lruNamespace);
      }
    }
  }

  private recordHit(namespace: string): void {
    const stats = this.getOrCreateNamespaceStats(namespace);
    stats.hits++;
    this.globalStats.hits++;
  }

  private recordMiss(namespace: string): void {
    const stats = this.getOrCreateNamespaceStats(namespace);
    stats.misses++;
    this.globalStats.misses++;
  }

  private recordEviction(namespace: string): void {
    const stats = this.getOrCreateNamespaceStats(namespace);
    stats.evictions = (stats.evictions || 0) + 1;
    this.globalStats.evictions = (this.globalStats.evictions || 0) + 1;
  }

  private getOrCreateNamespaceStats(namespace: string): NamespaceStats {
    let stats = this.namespaceStats.get(namespace);
    if (!stats) {
      stats = createNamespaceStats();
      this.namespaceStats.set(namespace, stats);
    }
    return stats;
  }

  // calculateHitRate is now imported from cache-utils.ts

  /**
   * Liveness probe — the in-memory cache is always reachable.
   */
  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }

  get<T>(namespace: string, key: string): Promise<T | null> {
    try {
      const fullKey = this.getFullKey(namespace, key);
      const entry = this.cache.get(fullKey) as MemoryCacheEntry<T> | undefined;

      if (!entry) {
        this.recordMiss(namespace);
        return Promise.resolve(null);
      }

      const now = getTimeNow();

      // Check if expired
      if (isExpired(entry.expires)) {
        this.currentSize -= entry.size;
        this.cache.delete(fullKey);
        this.recordMiss(namespace);
        return Promise.resolve(null);
      }

      // Update access statistics
      entry.lastAccessed = now;
      entry.accessCount++;

      this.recordHit(namespace);
      return Promise.resolve(entry.value);
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error getting value from memory cache",
        messageKey: "cache.memory.get.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });

      this.recordMiss(namespace);
      return Promise.resolve(null);
    }
  }

  getAndDelete<T>(namespace: string, key: string): Promise<T | null> {
    try {
      const fullKey = this.getFullKey(namespace, key);
      const entry = this.cache.get(fullKey) as MemoryCacheEntry<T> | undefined;

      if (!entry) {
        this.recordMiss(namespace);
        return Promise.resolve(null);
      }

      if (isExpired(entry.expires)) {
        this.currentSize -= entry.size;
        this.cache.delete(fullKey);
        this.recordMiss(namespace);
        return Promise.resolve(null);
      }

      this.currentSize -= entry.size;
      this.cache.delete(fullKey);
      this.recordHit(namespace);
      return Promise.resolve(entry.value);
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error in Memory getAndDelete",
        messageKey: "cache.memory.get_and_delete.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });

      return Promise.resolve(null);
    }
  }

  set<T>(
    namespace: string,
    key: string,
    value: T,
    options?: CacheOptions,
  ): Promise<void> {
    try {
      const fullKey = this.getFullKey(namespace, key);
      const now = getTimeNow();
      const entrySize = calculateEntrySize(fullKey, value);

      // Remove existing entry if present
      const existingEntry = this.cache.get(fullKey);
      if (existingEntry) {
        this.currentSize -= existingEntry.size;
      }

      // Check size constraints and evict if necessary
      while (
        (this.currentSize + entrySize > this.maxSize ||
          this.cache.size >= this.maxEntries) &&
        this.cache.size > 0
      ) {
        this.evictLRU();
      }

      // Don't cache if entry is too large (>10% of total cache)
      if (entrySize > this.maxSize * 0.1) {
        console.debug(`[MemoryCache] Entry too large for L1 cache, skipping:`, {
          namespace,
          key,
          entrySize,
          maxAllowedSize: Math.floor(this.maxSize * 0.1),
          totalCacheSize: this.maxSize,
        });
        return Promise.resolve();
      }

      const cacheEntry: MemoryCacheEntry<T> = {
        value,
        expires: options?.ttl ? now + (options.ttl * 1000) : undefined,
        createdAt: now,
        lastAccessed: now,
        accessCount: 1,
        size: entrySize,
      };

      this.cache.set(fullKey, cacheEntry as MemoryCacheEntry<unknown>);
      this.currentSize += entrySize;
      return Promise.resolve();
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error setting value in memory cache",
        messageKey: "cache.memory.set.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });

      return Promise.resolve();
    }
  }

  delete(namespace: string, key: string): Promise<void> {
    try {
      const fullKey = this.getFullKey(namespace, key);
      const entry = this.cache.get(fullKey);

      if (entry) {
        this.currentSize -= entry.size;
        this.cache.delete(fullKey);
      }
      return Promise.resolve();
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error deleting value from memory cache",
        messageKey: "cache.memory.delete.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });

      return Promise.resolve();
    }
  }

  deletePattern(namespace: string, pattern: string): Promise<void> {
    // Convert glob pattern to regex pattern (same as sanitizeGlobPattern)
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex chars except * and ?
      .replace(/\*/g, ".*") // Convert * to .*
      .replace(/\?/g, "."); // Convert ? to .
    const regex = new RegExp(`^${regexPattern}$`);

    const keysToDelete: string[] = [];
    const namespacePrefix = `${namespace}:`;

    for (const fullKey of this.cache.keys()) {
      if (fullKey.startsWith(namespacePrefix)) {
        const key = fullKey.substring(namespacePrefix.length);
        if (regex.test(key)) {
          keysToDelete.push(fullKey);
        }
      }
    }

    for (const fullKey of keysToDelete) {
      const entry = this.cache.get(fullKey);
      if (entry) {
        this.currentSize -= entry.size;
        this.cache.delete(fullKey);
      }
    }
    return Promise.resolve();
  }

  clearNamespace(namespace: string): Promise<void> {
    const namespacePrefix = `${namespace}:`;
    const keysToDelete: string[] = [];

    for (const fullKey of this.cache.keys()) {
      if (fullKey.startsWith(namespacePrefix)) {
        keysToDelete.push(fullKey);
      }
    }

    for (const fullKey of keysToDelete) {
      const entry = this.cache.get(fullKey);
      if (entry) {
        this.currentSize -= entry.size;
        this.cache.delete(fullKey);
      }
    }

    // Reset namespace statistics
    this.resetStats(namespace);
    return Promise.resolve();
  }

  getAllInNamespace(
    namespace: string,
  ): Promise<Map<string, CacheEntry<string | null>>> {
    const result = new Map<string, CacheEntry<string | null>>();
    const namespacePrefix = `${namespace}:`;
    const now = getTimeNow();

    for (const [fullKey, entry] of this.cache.entries()) {
      if (fullKey.startsWith(namespacePrefix)) {
        // Check if not expired
        if (!entry.expires || entry.expires > now) {
          const key = fullKey.substring(namespacePrefix.length);
          result.set(key, {
            value: entry.value as string | null,
            expires: entry.expires,
            createdAt: entry.createdAt,
          });
        }
      }
    }

    return Promise.resolve(result);
  }

  getEntryCount(namespace?: string): Promise<number> {
    if (!namespace) {
      return Promise.resolve(this.cache.size);
    }

    const namespacePrefix = `${namespace}:`;
    const now = getTimeNow();
    let count = 0;

    for (const [fullKey, entry] of this.cache.entries()) {
      if (fullKey.startsWith(namespacePrefix)) {
        if (!entry.expires || entry.expires > now) {
          count++;
        }
      }
    }

    return Promise.resolve(count);
  }

  async getAverageEntrySize(namespace?: string): Promise<number> {
    const totalSize = await this.getTotalSize(namespace);
    const entryCount = await this.getEntryCount(namespace);
    return entryCount > 0 ? totalSize / entryCount : 0;
  }

  getTotalSize(namespace?: string): Promise<number> {
    if (!namespace) {
      return Promise.resolve(this.currentSize);
    }

    const namespacePrefix = `${namespace}:`;
    const now = getTimeNow();
    let totalSize = 0;

    for (const [fullKey, entry] of this.cache.entries()) {
      if (fullKey.startsWith(namespacePrefix)) {
        if (!entry.expires || entry.expires > now) {
          totalSize += entry.size;
        }
      }
    }

    return Promise.resolve(totalSize);
  }

  getAllNamespaces(): Promise<string[]> {
    const namespaces = new Set<string>();
    const now = getTimeNow();

    for (const [fullKey, entry] of this.cache.entries()) {
      if (!entry.expires || entry.expires > now) {
        const namespace = fullKey.split(":")[0];
        namespaces.add(namespace);
      }
    }

    return Promise.resolve(Array.from(namespaces).sort());
  }

  async getDetailedStats(namespace?: string): Promise<DetailedCacheStatistics> {
    const entryCount = await this.getEntryCount(namespace);
    const totalSize = await this.getTotalSize(namespace);
    const avgSize = await this.getAverageEntrySize(namespace);

    let stats: NamespaceStats;
    if (namespace) {
      stats = this.getOrCreateNamespaceStats(namespace);
    } else {
      stats = this.globalStats;
    }

    const hitRate = calculateHitRate(stats.hits, stats.misses);

    // Calculate size distribution
    let largest = 0, smallest = Infinity;
    const prefix = namespace ? `${namespace}:` : "";
    const now = getTimeNow();

    for (const [fullKey, entry] of this.cache.entries()) {
      if (!prefix || fullKey.startsWith(prefix)) {
        if (!entry.expires || entry.expires > now) {
          largest = Math.max(largest, entry.size);
          smallest = Math.min(smallest, entry.size);
        }
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
    const entryCount = await this.getEntryCount(namespace);
    const totalSize = await this.getTotalSize(namespace);
    const averageEntrySize = await this.getAverageEntrySize(namespace);

    let stats: NamespaceStats;
    if (namespace) {
      stats = this.getOrCreateNamespaceStats(namespace);
    } else {
      stats = this.globalStats;
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

  resetStats(namespace?: string): void {
    if (namespace) {
      const stats = this.namespaceStats.get(namespace);
      if (stats) {
        const newStats = createNamespaceStats();
        newStats.createdTime = stats.createdTime; // Preserve creation time
        this.namespaceStats.set(namespace, newStats);
      }
    } else {
      // Reset global stats
      const createdTime = this.globalStats.createdTime;
      this.globalStats = createNamespaceStats();
      this.globalStats.createdTime = createdTime;

      // Reset all namespace stats
      for (const [ns, stats] of this.namespaceStats.entries()) {
        const newStats = createNamespaceStats();
        newStats.createdTime = stats.createdTime; // Preserve creation time
        this.namespaceStats.set(ns, newStats);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Queue operations — in-process FIFO using a Map of arrays
  // ---------------------------------------------------------------------------

  private queues: Map<string, string[]> = new Map();

  /**
   * Append a value to the tail of an in-process queue.
   * Safe without a mutex because Deno/JS is single-threaded.
   */
  // deno-lint-ignore require-await
  async enqueue(queueName: string, value: string): Promise<void> {
    const q = this.queues.get(queueName) ?? [];
    q.push(value);
    this.queues.set(queueName, q);
  }

  /**
   * Pop a value from the head of an in-process queue.
   * Returns null if the queue is empty.
   * Array.shift() is atomic in single-threaded Deno.
   */
  // deno-lint-ignore require-await
  async dequeue(queueName: string): Promise<string | null> {
    const q = this.queues.get(queueName);
    if (!q || q.length === 0) return null;
    return q.shift() ?? null;
  }

  /**
   * Return the current length of an in-process queue.
   */
  // deno-lint-ignore require-await
  async queueLength(queueName: string): Promise<number> {
    return this.queues.get(queueName)?.length ?? 0;
  }

  // deno-lint-ignore require-await
  async acquireLock(lockKey: string, token: string, ttlMs: number): Promise<boolean> {
    const now = getTimeNow();
    const existing = this.locks.get(lockKey);
    if (existing && existing.expiresAt > now) {
      return false;
    }
    this.locks.set(lockKey, { token, expiresAt: now + ttlMs });
    return true;
  }

  // deno-lint-ignore require-await
  async releaseLock(lockKey: string, token: string): Promise<boolean> {
    const existing = this.locks.get(lockKey);
    if (!existing || existing.token !== token) {
      return false;
    }
    this.locks.delete(lockKey);
    return true;
  }

  close(): Promise<void> {
    this.stopCleanupTask();
    this.cache.clear();
    this.queues.clear();
    this.locks.clear();
    this.currentSize = 0;
    return Promise.resolve();
  }

  // Additional methods specific to memory cache
  getMemoryUsage(): { used: number; max: number; percentage: number } {
    return {
      used: this.currentSize,
      max: this.maxSize,
      percentage: (this.currentSize / this.maxSize) * 100,
    };
  }

  getEvictionStats(namespace?: string): { evictions: number } {
    const stats = namespace ? this.getOrCreateNamespaceStats(namespace) : this.globalStats;

    return { evictions: stats.evictions || 0 };
  }
}
