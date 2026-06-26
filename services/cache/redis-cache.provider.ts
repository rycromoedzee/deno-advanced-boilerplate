/**
 * @file services/cache/redis-cache.provider.ts
 * @description Redis-based cache provider for production
 */

import { type Redis, redisDbConnect } from "@deps";
import { CacheEntry, CacheOptions, CacheProvider, CacheStatistics, DetailedCacheStatistics } from "@interfaces/cache.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { envConfig } from "@config/env.ts";
import { AppHttpException } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import {
  batchArray,
  calculateHitRate,
  createCacheKey,
  createNamespaceStats,
  getByteLength,
  type NamespaceStats,
  safeJsonParse,
  safeJsonStringify,
} from "./cache-utils.ts";
import { getInstanceId } from "@utils/instance-id.ts";

// NamespaceStats is now imported from cache-utils.ts

interface CacheInvalidationMessage {
  type: "invalidate_key" | "invalidate_pattern" | "clear_namespace";
  namespace: string;
  key?: string;
  pattern?: string;
  timestamp: number;
  instanceId: string;
}

interface RedisSubscriber {
  receive(): AsyncIterable<{ message: string }>;
}

export class RedisCacheProvider implements CacheProvider {
  private redis: Redis;
  private subscriberRedis: Redis | null = null;
  private isConnected = false;
  private namespaceStats: Map<string, NamespaceStats> = new Map();
  private globalStats: NamespaceStats;

  // Cache bus properties
  private instanceId: string;
  private isListening = false;
  private channelName = "cache_invalidation";
  private cacheInvalidationCallbacks: Set<
    (namespace: string, key?: string, pattern?: string) => Promise<void>
  > = new Set();

  constructor(redis: Redis, subscriberRedis?: Redis, instanceId?: string) {
    this.redis = redis;
    this.subscriberRedis = subscriberRedis || null;
    this.isConnected = true;
    this.instanceId = instanceId || getInstanceId();
    this.globalStats = createNamespaceStats();

    // Initialize cache bus if enabled.
    //
    // The bus exists solely to keep per-instance L1 (memory) caches in sync via
    // pub/sub invalidation, and its only consumer is the L1 invalidation callback
    // registered by MultiTierCacheProvider. With multi-tier disabled there is no
    // L1 to invalidate, so the subscriber connection and pub/sub traffic would be
    // pure overhead with zero registered callbacks. Gate it on both flags.
    if (envConfig.cache.enableCacheBus && envConfig.cache.enableMultiTier) {
      this.initializeCacheBus();
    }
  }

  private getRedisKey(namespace: string, key: string): string {
    return createCacheKey(namespace, key);
  }

  /**
   * Initialize cache bus for multi-instance synchronization
   */
  private async initializeCacheBus(): Promise<void> {
    try {
      // Create a separate subscriber connection if not provided
      if (!this.subscriberRedis) {
        const redisPassword = envConfig.cache.redisPassword;
        const hasPassword = redisPassword && redisPassword.length > 0;

        this.subscriberRedis = await redisDbConnect({
          hostname: envConfig.cache.redisHost || "localhost",
          port: parseInt(envConfig.cache.redisPort || "6379"),
          ...(hasPassword && { password: redisPassword }),
        });
      }

      await this.startListening();
      console.log(`CACHE => Bus initialized`);
    } catch (error) {
      console.warn("Failed to initialize cache bus:", error);
    }
  }

  /**
   * Start listening for cache invalidation messages
   */
  private async startListening(): Promise<void> {
    if (!this.isConnected || this.isListening || !this.subscriberRedis) return;

    try {
      this.isListening = true;

      const subscriber = await this.subscriberRedis.subscribe(this.channelName);

      this.handleIncomingMessages(subscriber);
    } catch (error) {
      console.error("Cache bus listener error:", error);
      this.isListening = false;

      setTimeout(() => {
        if (this.isConnected) {
          this.startListening();
        }
      }, envConfig.cache.busRetryDelaySeconds * 1000);
    }
  }

  /**
   * Handle incoming cache invalidation messages
   */
  private async handleIncomingMessages(
    subscriber: RedisSubscriber,
  ): Promise<void> {
    try {
      for await (const message of subscriber.receive()) {
        if (!this.isListening || !this.isConnected) {
          break;
        }

        try {
          const data = JSON.parse(message.message) as CacheInvalidationMessage;
          if (data.instanceId === this.instanceId) {
            continue;
          }

          await this.handleInvalidationMessage(data);
        } catch (error) {
          console.warn("Failed to process cache invalidation message:", error);
        }
      }
    } catch (error) {
      if (this.isListening && this.isConnected) {
        console.error("Cache bus message handler error:", error);
      }
      this.isListening = false;

      // Attempt to restart
      setTimeout(() => {
        if (this.isConnected) {
          this.startListening();
        }
      }, envConfig.cache.busRetryDelaySeconds * 1000);
    }
  }

  /**
   * Handle cache invalidation messages from other instances
   */
  private async handleInvalidationMessage(
    message: CacheInvalidationMessage,
  ): Promise<void> {
    try {
      for (const callback of this.cacheInvalidationCallbacks) {
        await callback(message.namespace, message.key, message.pattern);
      }
    } catch (error) {
      console.warn(
        `Failed to handle cache invalidation for ${message.type}:`,
        error,
      );
    }
  }

  /**
   * Register a callback for cache invalidation events
   */
  onInvalidation(
    callback: (
      namespace: string,
      key?: string,
      pattern?: string,
    ) => Promise<void>,
  ): void {
    this.cacheInvalidationCallbacks.add(callback);
  }

  /**
   * Broadcast key invalidation to other instances
   */
  private async broadcastKeyInvalidation(
    namespace: string,
    key: string,
  ): Promise<void> {
    if (!this.isConnected || !envConfig.cache.enableCacheBus) return;

    const message: CacheInvalidationMessage = {
      type: "invalidate_key",
      namespace,
      key,
      timestamp: Date.now(),
      instanceId: this.instanceId,
    };

    try {
      await this.redis.publish(this.channelName, safeJsonStringify(message));
    } catch (error) {
      console.warn("Failed to broadcast key invalidation:", error);
    }
  }

  /**
   * Broadcast pattern invalidation to other instances
   */
  private async broadcastPatternInvalidation(
    namespace: string,
    pattern: string,
  ): Promise<void> {
    if (!this.isConnected || !envConfig.cache.enableCacheBus) return;

    const message: CacheInvalidationMessage = {
      type: "invalidate_pattern",
      namespace,
      pattern,
      timestamp: Date.now(),
      instanceId: this.instanceId,
    };

    try {
      await this.redis.publish(this.channelName, safeJsonStringify(message));
    } catch (error) {
      console.warn("Failed to broadcast pattern invalidation:", error);
    }
  }

  /**
   * Broadcast namespace clearing to other instances
   */
  private async broadcastNamespaceClear(namespace: string): Promise<void> {
    if (!this.isConnected || !envConfig.cache.enableCacheBus) return;

    const message: CacheInvalidationMessage = {
      type: "clear_namespace",
      namespace,
      timestamp: Date.now(),
      instanceId: this.instanceId,
    };

    try {
      await this.redis.publish(this.channelName, safeJsonStringify(message));
    } catch (error) {
      console.warn("Failed to broadcast namespace clear:", error);
    }
  }

  /**
   * Get cache bus status
   */
  getCacheBusStatus() {
    return {
      // Reflects the effective state: the bus only runs when multi-tier is also
      // enabled (see initializeCacheBus gating in the constructor).
      enabled: envConfig.cache.enableCacheBus && envConfig.cache.enableMultiTier,
      isListening: this.isListening,
      instanceId: this.instanceId,
      channelName: this.channelName,
      hasRedis: this.isConnected,
      callbackCount: this.cacheInvalidationCallbacks.size,
    };
  }

  // byteLength is now imported as getByteLength from cache-utils.ts

  async getKeySize(key: string): Promise<number> {
    try {
      // Use Redis' built-in memory calculation when available

      const memoryUsage = await this.redis.sendCommand("MEMORY", [
        "USAGE",
        key,
      ]);

      if (typeof memoryUsage === "number" && memoryUsage > 0) {
        return memoryUsage;
      }

      // Fallback to manual calculation
      const value = await this.redis.get(key);
      const keySize = getByteLength(key);
      const valueSize = value ? getByteLength(value) : 0;
      return keySize + valueSize;
    } catch (_error) {
      console.error("Error getting key size:", _error);
      return 0;
    }
  }

  private async safeKeysScan(
    pattern: string,
    limit?: number,
  ): Promise<string[]> {
    const scanLimit = limit || envConfig.cache.redisKeysScanLimit;
    if (!this.isConnected) return [];

    try {
      const keys: string[] = [];
      let cursor: number = 0;

      do {
        // Properly handle the scan result type
        const result = await this.redis.scan(
          cursor,
          {
            pattern: pattern,
            count: Math.min(1000, scanLimit - keys.length), // Don't fetch more than needed
          },
        ) as [string, string[]]; // Cast to correct type

        cursor = parseInt(result[0], 10); // Convert string cursor to number
        keys.push(...result[1]);

        // Early exit if we've reached the limit
        if (keys.length >= scanLimit) {
          break;
        }
      } while (cursor !== 0);

      return keys.slice(0, scanLimit);
    } catch (error) {
      console.error("Redis key scan error:", error);
      return [];
    }
  }

  async getAllInNamespace(
    namespace: string,
  ): Promise<Map<string, CacheEntry<string | null>>> {
    if (!this.isConnected) {
      return new Map();
    }

    try {
      const pattern = `${namespace}:*`;
      const keys = await this.safeKeysScan(pattern);

      if (keys.length === 0) {
        return new Map();
      }

      const values = await this.redis.mget(...keys);

      const result = new Map<string, CacheEntry<string | null>>();
      keys.forEach((redisKey, index) => {
        const value = values[index];
        const originalKey = redisKey.substring(namespace.length + 1);

        if (value) {
          try {
            const parsedValue = safeJsonParse(value, {
              value: null,
              createdAt: null,
              expires: null,
            });

            // Check if the stored value already has metadata structure
            const cacheEntry: CacheEntry<string | null> = {
              value: parsedValue.value,
              createdAt: parsedValue.createdAt || getTimeNow(),
              expires: parsedValue.expires || undefined,
            };

            result.set(originalKey, cacheEntry);
          } catch (parseError) {
            console.error(
              `Failed to parse JSON for key ${redisKey}:`,
              parseError,
            );
            const cacheEntry: CacheEntry<string | null> = {
              value: value,
              createdAt: 0,
              expires: 0,
            };
            result.set(originalKey, cacheEntry);
          }
        }
      });

      return result;
    } catch (error) {
      console.error("Redis getAllInNamespace error:", error);
      return new Map();
    }
  }

  /**
   * Liveness probe — issues a real Redis PING. Does NOT fail open: unlike get(),
   * a connection error rejects here and is converted to false, so a disconnected
   * backend is detected.
   */
  async ping(): Promise<boolean> {
    try {
      await this.redis.sendCommand("PING", []);
      return true;
    } catch {
      return false;
    }
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    if (!this.isConnected) {
      this.recordMiss(namespace);
      return null;
    }

    try {
      const redisKey = this.getRedisKey(namespace, key);
      const value = await this.redis.get(redisKey);

      if (!value) {
        this.recordMiss(namespace);
        return null;
      }

      this.recordHit(namespace);
      const parsedValue = safeJsonParse(value, { value: null });

      return parsedValue.value as T;
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error getting value from Redis cache",
        messageKey: "cache.redis.get.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });

      this.recordMiss(namespace);
      return null;
    }
  }

  async getAndDelete<T>(namespace: string, key: string): Promise<T | null> {
    if (!this.isConnected) {
      this.recordMiss(namespace);
      return null;
    }

    try {
      const redisKey = this.getRedisKey(namespace, key);
      const result = await this.redis.sendCommand("GETDEL", [redisKey]);

      if (!result) {
        this.recordMiss(namespace);
        return null;
      }

      this.recordHit(namespace);
      const parsedValue = safeJsonParse(result as string, { value: null });

      // Broadcast invalidation so other instances drop any stale L1 copy of
      // this key. GETDEL removes the key here, so other multi-tier instances
      // must evict their L1 entry to avoid serving a consumed single-use value.
      await this.broadcastKeyInvalidation(namespace, key);

      return parsedValue.value as T;
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error in Redis getAndDelete",
        messageKey: "cache.redis.get_and_delete.unexpected_error",
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
    if (!this.isConnected) return;
    try {
      const redisKey = this.getRedisKey(namespace, key);

      const cacheEntry = {
        value: value,
        createdAt: getTimeNow(),
        expires: options?.ttl ? getTimeNow() + (options?.ttl * 1000) : null,
      };

      const serialized = safeJsonStringify(cacheEntry);

      if (options?.ttl) {
        await this.redis.setex(redisKey, Math.floor(options.ttl), serialized);
      } else {
        await this.redis.set(redisKey, serialized);
      }

      // Broadcast invalidation so other instances drop any stale L1 copy of
      // this key. Without this, multi-tier L1 caches on other instances keep
      // serving the previous value until their TTL expires.
      await this.broadcastKeyInvalidation(namespace, key);
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error setting value in Redis cache",
        messageKey: "cache.redis.set.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      const redisKey = this.getRedisKey(namespace, key);
      await this.redis.del(redisKey);

      // Broadcast invalidation to other instances
      await this.broadcastKeyInvalidation(namespace, key);
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error deleting value from Redis cache",
        messageKey: "cache.redis.delete.unexpected_error",
        section: loggerAppSections.INTERNAL,
        details: { namespace, key },
        raw: error,
      });
    }
  }

  // sanitizePattern is now imported as sanitizeGlobPattern from cache-utils.ts

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

  private getOrCreateNamespaceStats(namespace: string): NamespaceStats {
    let stats = this.namespaceStats.get(namespace);
    if (!stats) {
      stats = createNamespaceStats();
      this.namespaceStats.set(namespace, stats);
    }
    return stats;
  }

  // calculateHitRate is now imported from cache-utils.ts

  async deletePattern(namespace: string, pattern: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      // For Redis SCAN, we need glob patterns, not regex patterns
      // Redis SCAN uses glob patterns natively, so just use the pattern as-is
      const redisPattern = `${namespace}:${pattern}`;
      const keys = await this.safeKeysScan(redisPattern);

      if (keys.length > 0) {
        const batchSize = envConfig.cache.redisBatchSize;
        const batches = batchArray(keys, batchSize);
        for (const batch of batches) {
          await this.redis.del(...batch);
        }

        // Broadcast pattern invalidation to other instances
        await this.broadcastPatternInvalidation(namespace, pattern);
      }
    } catch (error) {
      console.error("Redis deletePattern error:", error);
    }
  }

  async clearNamespace(namespace: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      const pattern = `${namespace}:*`;
      const keys = await this.safeKeysScan(pattern);

      if (keys.length > 0) {
        const batchSize = envConfig.cache.redisBatchSize;
        const batches = batchArray(keys, batchSize);
        for (const batch of batches) {
          await this.redis.del(...batch);
        }
      }

      // Reset statistics for the cleared namespace
      this.resetStats(namespace);

      // Broadcast namespace clear to other instances
      await this.broadcastNamespaceClear(namespace);
    } catch (error) {
      console.error("Redis clearNamespace error:", error);
    }
  }

  async getEntryCount(namespace?: string): Promise<number> {
    if (!this.isConnected) return 0;

    try {
      const pattern = namespace ? `${namespace}:*` : "*";
      const keys = await this.safeKeysScan(pattern);
      return keys.length;
    } catch (error) {
      console.error("Redis getEntryCount error:", error);
      return 0;
    }
  }

  async getAverageEntrySize(namespace?: string): Promise<number> {
    const totalSize = await this.getTotalSize(namespace);
    const entryCount = await this.getEntryCount(namespace);
    return entryCount > 0 ? totalSize / entryCount : 0;
  }

  async getTotalSize(namespace?: string): Promise<number> {
    if (!this.isConnected) return 0;

    try {
      const pattern = namespace ? `${namespace}:*` : "*";
      const keys = await this.safeKeysScan(
        pattern,
        envConfig.cache.redisMemoryScanLimit,
      ); // Limit for performance

      let totalSize = 0;

      // Process keys in batches
      const batchSize = envConfig.cache.redisBatchSize;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        const sizes = await Promise.all(
          batch.map((key) => this.getKeySize(key)),
        );
        totalSize += sizes.reduce((sum, size) => sum + size, 0);
      }

      return totalSize;
    } catch (error) {
      console.error("Redis getTotalSize error:", error);
      return 0;
    }
  }

  async getAllNamespaces(): Promise<string[]> {
    if (!this.isConnected) return [];

    try {
      const keys = await this.safeKeysScan(
        "*",
        envConfig.cache.redisKeysScanLimit,
      );
      const namespaces = new Set<string>();

      for (const key of keys) {
        const colonIndex = key.indexOf(":");
        if (colonIndex > 0) {
          const namespace = key.substring(0, colonIndex);
          namespaces.add(namespace);
        }
      }

      return Array.from(namespaces).sort();
    } catch (error) {
      console.error("Redis getAllNamespaces error:", error);
      return [];
    }
  }

  async getDetailedStats(namespace?: string): Promise<DetailedCacheStatistics> {
    const entryCount = await this.getEntryCount(namespace);
    const totalSize = await this.getTotalSize(namespace);
    const avgSize = await this.getAverageEntrySize(namespace);

    let hits: number, misses: number, createdTime: Date, lastResetTime: Date;

    if (namespace) {
      const stats = this.getOrCreateNamespaceStats(namespace);
      hits = stats.hits;
      misses = stats.misses;
      createdTime = stats.createdTime;
      lastResetTime = stats.lastResetTime;
    } else {
      hits = this.globalStats.hits;
      misses = this.globalStats.misses;
      createdTime = this.globalStats.createdTime;
      lastResetTime = this.globalStats.lastResetTime;
    }

    const hitRate = calculateHitRate(hits, misses);

    // Basic implementation - could be enhanced with more detailed analysis
    return {
      hits,
      misses,
      hitRate,
      entryCount,
      totalSize,
      averageEntrySize: avgSize,
      largestEntrySize: 0,
      smallestEntrySize: 0,
      namespace,
      lastResetTime,
      createdTime,
    };
  }

  async getStats(namespace?: string): Promise<CacheStatistics> {
    const entryCount = await this.getEntryCount(namespace);
    const totalSize = await this.getTotalSize(namespace);
    const averageEntrySize = await this.getAverageEntrySize(namespace);

    let hits: number, misses: number, createdTime: Date, lastResetTime: Date;

    if (namespace) {
      const stats = this.getOrCreateNamespaceStats(namespace);
      hits = stats.hits;
      misses = stats.misses;
      createdTime = stats.createdTime;
      lastResetTime = stats.lastResetTime;
    } else {
      hits = this.globalStats.hits;
      misses = this.globalStats.misses;
      createdTime = this.globalStats.createdTime;
      lastResetTime = this.globalStats.lastResetTime;
    }

    const hitRate = calculateHitRate(hits, misses);

    return {
      hits,
      misses,
      hitRate,
      entryCount,
      totalSize,
      averageEntrySize,
      namespace,
      lastResetTime,
      createdTime,
    };
  }

  resetStats(namespace?: string): void {
    const now = new Date();

    if (namespace) {
      // Reset specific namespace statistics
      const stats = this.namespaceStats.get(namespace);
      if (stats) {
        stats.hits = 0;
        stats.misses = 0;
        stats.lastResetTime = now;
      }
    } else {
      // Reset all statistics (global and all namespaces)
      this.globalStats.hits = 0;
      this.globalStats.misses = 0;
      this.globalStats.lastResetTime = now;

      // Reset all namespace statistics
      for (const stats of this.namespaceStats.values()) {
        stats.hits = 0;
        stats.misses = 0;
        stats.lastResetTime = now;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Queue operations — atomic FIFO using Redis list commands
  // ---------------------------------------------------------------------------

  /**
   * Atomically append a value to the tail of a Redis list queue.
   * Uses RPUSH which is O(1) and atomic.
   */
  async enqueue(queueName: string, value: string): Promise<void> {
    if (!this.isConnected) return;
    await this.redis.rpush(queueName, value);
  }

  /**
   * Atomically pop a value from the head of a Redis list queue.
   * Uses LPOP which is O(1) and atomic — safe for multi-instance consumers.
   * Returns null if the queue is empty.
   */
  async dequeue(queueName: string): Promise<string | null> {
    if (!this.isConnected) return null;
    const result = await this.redis.lpop(queueName);
    return result ?? null;
  }

  /**
   * Return the number of items currently in the queue.
   * Uses LLEN which is O(1).
   */
  async queueLength(queueName: string): Promise<number> {
    if (!this.isConnected) return 0;
    return await this.redis.llen(queueName);
  }

  async acquireLock(lockKey: string, token: string, ttlMs: number): Promise<boolean> {
    if (!this.isConnected) return false;
    const result = await this.redis.sendCommand("SET", [
      lockKey,
      token,
      "NX",
      "PX",
      ttlMs.toString(),
    ]);
    return result === "OK";
  }

  async releaseLock(lockKey: string, token: string): Promise<boolean> {
    if (!this.isConnected) return false;
    const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    const result = await this.redis.sendCommand("EVAL", [
      script,
      "1",
      lockKey,
      token,
    ]);
    return result === 1 || result === "1";
  }

  async close(): Promise<void> {
    if (this.isConnected) {
      // Stop listening first to prevent new message processing
      this.isListening = false;

      // Close subscriber connection first to stop message handler
      if (this.subscriberRedis) {
        try {
          await this.subscriberRedis.quit();
        } catch (error) {
          // Ignore quit errors during cleanup
          console.debug(
            "Subscriber Redis quit error (expected during cleanup):",
            error instanceof Error ? error.message : String(error),
          );
        }
        this.subscriberRedis = null;
      }

      // Then close main Redis connection
      try {
        await this.redis.quit();
      } catch (error) {
        // Ignore quit errors during cleanup
        console.debug(
          "Redis quit error (expected during cleanup):",
          error instanceof Error ? error.message : String(error),
        );
      }

      this.isConnected = false;
    }
  }

  /**
   * Get the underlying Redis connection for Pub/Sub use
   * This allows other services to reuse the same connection
   * instead of creating new ones
   *
   * @returns The Redis client instance and subscriber client (if available)
   */
  getRedisConnection(): {
    publisher: Redis;
    subscriber: Redis | null;
  } {
    return {
      publisher: this.redis,
      subscriber: this.subscriberRedis,
    };
  }
}
