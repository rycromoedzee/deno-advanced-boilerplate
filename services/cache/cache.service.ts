/**
 * @file services/cache/cache.service.ts
 * @description Global cache service with statistics
 */
import { redisDbConnect } from "@deps";
import { envConfig } from "@config/env.ts";
import { CacheEntry, CacheLockOptions, CacheOptions, CacheProvider, CacheStatistics, DetailedCacheStatistics } from "@interfaces/cache.ts";
import { DenoKVCacheProvider } from "./deno-kv-cache.provider.ts";
import { RedisCacheProvider } from "./redis-cache.provider.ts";
import { MultiTierCacheProvider } from "./multi-tier-cache.provider.ts";
import { MemoryCacheProvider } from "./memory-cache.provider.ts";
import { DurableCacheStore } from "./durable-cache.store.ts";
import { policyFor } from "./cache.config.ts";
import { traced, tracedSync } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { sleep } from "./cache-utils.ts";
import { getTimeNow, getTimeNowForStorage } from "@utils/shared/index.ts";

/**
 * Global cache service with statistics tracking
 */
export class GlobalCacheService {
  private provider: CacheProvider;
  private isMultiTier: boolean;
  private readonly durableEnabled: boolean;
  private readonly durableStore: DurableCacheStore;

  constructor(
    provider: CacheProvider,
    opts?: { durableEnabled?: boolean; durableStore?: DurableCacheStore },
  ) {
    this.provider = provider;
    this.isMultiTier = provider instanceof MultiTierCacheProvider;
    this.durableEnabled = opts?.durableEnabled ?? false;
    // Injectable for tests; production always uses the default store (global DB).
    this.durableStore = opts?.durableStore ?? new DurableCacheStore();
  }

  /**
   * Liveness probe: actively round-trips the cache backing store via the provider.
   * Returns true if reachable, false otherwise. Used by health checks.
   */
  async ping(): Promise<boolean> {
    return await this.provider.ping();
  }

  /**
   * Log a durable-store (Turso) failure without ever rejecting.
   *
   * The durable tier is a best-effort backing store: read-through and write
   * paths degrade gracefully on a backing-store error (matching the legacy
   * bespoke refresh-token path) so a Turso blip can never fail an auth request
   * or a cache.set. Only `namespace` is logged — never `key`/`value`. `useLogger`
   * is async; it is awaited inside its own guard so a logging-backend failure
   * can never propagate out of the degrade path.
   */
  private async logDurableFailure(
    operation: string,
    messageKey: string,
    namespace: string,
    error: unknown,
  ): Promise<void> {
    try {
      await useLogger(LoggerLevels.warn, {
        message: `Durable cache ${operation} failed; degrading to provider-only`,
        messageKey,
        section: loggerAppSections.INTERNAL, // no CACHE member exists on loggerAppSections
        details: {
          namespace, // never log key/value
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } catch {
      // Swallow logging-backend failure so a durable degrade can never reject.
    }
  }

  /**
   * Get value from cache
   * @param namespace Cache namespace
   * @param key Cache key
   * @returns Cached value or null if not found
   */
  async get<T>(namespace: string, key: string): Promise<T | null> {
    return await traced("GlobalCacheService.get", "cache.get", async (span) => {
      span.attributes["cache_namespace"] = namespace;
      span.attributes["cache_key"] = key;

      const cached = await this.provider.get<T>(namespace, key);
      if (cached !== null) {
        span.attributes["found"] = true;
        return cached; // fast path: provider hit (L1 -> L2)
      }

      // Durable read-through: only for allow-listed namespaces behind the flag.
      // The DB is the source of truth for cold reads so an instance that has never
      // seen a key (eviction/restart/other region) can repopulate it.
      if (!this.durableEnabled) {
        span.attributes["found"] = false;
        return null;
      }
      const policy = policyFor(namespace);
      if (!policy) {
        span.attributes["found"] = false;
        return null;
      }

      // Graceful-degrade: the durable tier is best-effort. A backing-store
      // (Turso) error must never fail the request — treat it as a miss and fall
      // through to provider-only behavior, matching the legacy bespoke
      // refresh-token read-through (session-validate.service.ts:261-295).
      try {
        const row = await this.durableStore.get<T>(namespace, key, policy);
        if (!row) {
          span.attributes["found"] = false;
          return null;
        }

        const nowSec = getTimeNowForStorage();
        if (row.expiresAt !== null && row.expiresAt <= nowSec) {
          // Lazy-delete the expired durable row; treat as a miss (expiry honored).
          await this.durableStore.delete(namespace, key, policy);
          span.attributes["found"] = false;
          span.attributes["durable_expired"] = true;
          return null;
        }

        // Warm the cache for the value's REMAINING lifetime. Write-loop guard: warm
        // via this.provider.set (never this.set) so repopulation does not re-persist
        // to the DB. MultiTierCacheProvider.get warms L1 the same direct way.
        const ttl = row.expiresAt !== null ? row.expiresAt - nowSec : undefined;
        await this.provider.set(namespace, key, row.value, ttl !== undefined ? { ttl } : undefined);
        span.attributes["found"] = true;
        span.attributes["durable_hit"] = true;
        return row.value;
      } catch (error) {
        span.attributes["found"] = false;
        span.attributes["durable_error"] = true;
        await this.logDurableFailure("read-through", "cache.durable_read_failed", namespace, error);
        return null;
      }
    });
  }

  /**
   * Atomically get and delete a value from cache
   * @param namespace Cache namespace
   * @param key Cache key
   * @returns Cached value or null if not found
   */
  async getAndDelete<T>(namespace: string, key: string): Promise<T | null> {
    return await traced("GlobalCacheService.getAndDelete", "cache.delete", async (span) => {
      span.attributes["cache_namespace"] = namespace;
      span.attributes["cache_key"] = key;

      let value: T | null = await this.provider.getAndDelete<T>(namespace, key);

      if (this.durableEnabled) {
        const policy = policyFor(namespace);
        if (policy) {
          // Single-use semantics: if the provider had nothing, deliver the durable
          // value exactly once (honoring expiry), then ALWAYS delete the durable row
          // so the value cannot resurrect from the DB on a later read.
          if (value === null) {
            const row = await this.durableStore.get<T>(namespace, key, policy);
            if (row) {
              const nowSec = getTimeNowForStorage();
              if (row.expiresAt !== null && row.expiresAt <= nowSec) {
                await this.durableStore.delete(namespace, key, policy);
                span.attributes["found"] = false;
                span.attributes["durable_expired"] = true;
                return null;
              }
              value = row.value;
            }
          }
          await this.durableStore.delete(namespace, key, policy);
        }
      }

      span.attributes["found"] = value !== null;
      return value;
    });
  }

  /**
   * Get all entries from a namespace
   * @param namespace Cache namespace
   * @returns Map of all entries in the namespace
   */
  getAllFromNamespace(
    namespace: string,
  ): Promise<Map<string, CacheEntry<string | null>>> {
    return traced("GlobalCacheService.getAllFromNamespace", "cache.get", async (span) => {
      span.attributes["cache_namespace"] = namespace;

      const result = await this.provider.getAllInNamespace(namespace);
      span.attributes["entry_count"] = result.size;
      span.attributes["success"] = true;
      return result;
    });
  }

  /**
   * Set value in cache
   * @param namespace Cache namespace
   * @param key Cache key
   * @param value Value to cache
   * @param options Cache options
   */
  async set<T>(
    namespace: string,
    key: string,
    value: T,
    options?: CacheOptions,
  ): Promise<void> {
    return await traced("GlobalCacheService.set", "cache.set", async (span) => {
      span.attributes["cache_namespace"] = namespace;
      span.attributes["cache_key"] = key;
      span.attributes["has_options"] = !!options;
      if (options?.ttl) {
        span.attributes["ttl"] = options.ttl;
      }

      await this.provider.set(namespace, key, value, options);
      span.attributes["success"] = true;

      // Durable write-through for allow-listed namespaces (behind the flag).
      if (!this.durableEnabled) return;
      const policy = policyFor(namespace);
      if (!policy) return;

      const expiresAt = options?.ttl ? getTimeNowForStorage() + options.ttl : null;
      if (policy.writeMode === "sync") {
        // Must-survive namespaces (auth): persist before set() resolves.
        // Graceful-degrade: a durable-write error must NOT fail the cache.set —
        // the provider write already succeeded, so the value is live for this
        // request; durability becomes best-effort until the backing store
        // recovers (parity with session-create.service.ts:317-324, which
        // swallowed the repository.save error).
        try {
          await this.durableStore.set(namespace, key, value, expiresAt, policy);
        } catch (error) {
          span.attributes["durable_error"] = true;
          await this.logDurableFailure("sync-write", "cache.durable_write_failed", namespace, error);
        }
      } else {
        // Write-behind: never block or fail the cache set on a durable write.
        this.durableStore.set(namespace, key, value, expiresAt, policy).catch((error) =>
          this.logDurableFailure("write-behind", "cache.durable_write_failed", namespace, error)
        );
      }
    });
  }

  /**
   * Delete value from cache
   * @param namespace Cache namespace
   * @param key Cache key
   */
  async delete(namespace: string, key: string): Promise<void> {
    return await traced("GlobalCacheService.delete", "cache.delete", async (span) => {
      span.attributes["cache_namespace"] = namespace;
      span.attributes["cache_key"] = key;

      await this.provider.delete(namespace, key);
      // MANDATORY cascade: the DB is the invalidation source of truth — deleting the
      // durable row guarantees no region can repopulate stale data from a surviving copy.
      // Unlike the read/sync-write paths, invalidation does NOT graceful-degrade: a
      // swallowed durable delete would let a stale (e.g. revoked) value resurrect from
      // the DB on the next cold read. The error propagates so the caller learns the
      // invalidation did not fully land (no-resurrection guard, see plans/durable-cache-layer.md §17).
      if (this.durableEnabled) {
        const policy = policyFor(namespace);
        if (policy) await this.durableStore.delete(namespace, key, policy);
      }
    });
  }

  async deletePattern(namespace: string, pattern: string): Promise<void> {
    return await traced("GlobalCacheService.deletePattern", "cache.delete", async (span) => {
      span.attributes["cache_namespace"] = namespace;
      span.attributes["pattern"] = pattern;

      await this.provider.deletePattern(namespace, pattern);
      if (this.durableEnabled) {
        const policy = policyFor(namespace);
        if (policy) await this.durableStore.deletePattern(namespace, pattern, policy);
      }
      span.attributes["success"] = true;
    });
  }

  async clearNamespace(namespace: string): Promise<void> {
    return await traced("GlobalCacheService.clearNamespace", "cache.delete", async (span) => {
      span.attributes["cache_namespace"] = namespace;

      await this.provider.clearNamespace(namespace);
      if (this.durableEnabled) {
        const policy = policyFor(namespace);
        if (policy) await this.durableStore.clearNamespace(namespace, policy);
      }
      span.attributes["success"] = true;
    });
  }

  /**
   * Execute a function while holding a distributed lock.
   * Throws if the lock cannot be acquired within the wait timeout.
   */
  async withLock<T>(
    lockKey: string,
    fn: () => Promise<T>,
    options: CacheLockOptions = {},
  ): Promise<T> {
    const ttlMs = options.ttlMs ?? 5000;
    const waitTimeoutMs = options.waitTimeoutMs ?? 2000;
    const retryDelayMs = options.retryDelayMs ?? 50;

    const token = crypto.randomUUID();
    const start = getTimeNow();

    while ((getTimeNow() - start) < waitTimeoutMs) {
      const acquired = await this.provider.acquireLock(lockKey, token, ttlMs);
      if (acquired) {
        try {
          return await fn();
        } finally {
          const released = await this.provider.releaseLock(lockKey, token);
          if (!released) {
            useLogger(LoggerLevels.warn, {
              message: "Cache lock release failed",
              messageKey: "cache.lock.release_failed",
              section: loggerAppSections.INTERNAL,
              details: { lockKey },
            });
          }
        }
      }

      const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(retryDelayMs / 2)));
      await sleep(retryDelayMs + jitter);
    }

    throw new Error(`Failed to acquire cache lock: ${lockKey}`);
  }

  // Statistics methods
  getStats(namespace?: string): Promise<CacheStatistics> {
    return this.provider.getStats(namespace);
  }

  getDetailedStats(namespace?: string): Promise<DetailedCacheStatistics> {
    return this.provider.getDetailedStats(namespace);
  }

  getEntryCount(namespace?: string): Promise<number> {
    return this.provider.getEntryCount(namespace);
  }

  getAverageEntrySize(namespace?: string): Promise<number> {
    return this.provider.getAverageEntrySize(namespace);
  }

  getTotalSize(namespace?: string): Promise<number> {
    return this.provider.getTotalSize(namespace);
  }

  getAllNamespaces(): Promise<string[]> {
    return this.provider.getAllNamespaces();
  }

  resetStats(namespace?: string): void {
    this.provider.resetStats(namespace);
  }

  close(): Promise<void> {
    return this.provider.close();
  }

  // ---------------------------------------------------------------------------
  // Queue operations — atomic FIFO backed by the active cache provider
  // ---------------------------------------------------------------------------

  /**
   * Atomically append a serialized string value to a named queue.
   * Delegates to the provider's enqueue implementation:
   *   - Redis  → RPUSH (O(1), atomic)
   *   - Deno KV → optimistic-lock head/tail transaction
   *   - Memory  → Array.push (single-threaded, no mutex needed)
   *   - MultiTier → delegates to durable L2 tier only
   *
   * Throws if the underlying provider does not support queue operations.
   */
  async enqueue(queueName: string, value: string): Promise<void> {
    return await traced("GlobalCacheService.enqueue", "cache.set", async (span) => {
      span.attributes["queue_name"] = queueName;
      if (!this.provider.enqueue) {
        throw new Error(`Cache provider does not support queue operations (enqueue)`);
      }
      await this.provider.enqueue(queueName, value);
      span.attributes["success"] = true;
    });
  }

  /**
   * Atomically pop and return the oldest value from a named queue (FIFO).
   * Returns null if the queue is empty.
   * Delegates to the provider's dequeue implementation:
   *   - Redis  → LPOP (O(1), atomic)
   *   - Deno KV → optimistic-lock head/tail transaction
   *   - Memory  → Array.shift (single-threaded, no mutex needed)
   *   - MultiTier → delegates to durable L2 tier only
   */
  async dequeue(queueName: string): Promise<string | null> {
    return await traced("GlobalCacheService.dequeue", "cache.get", async (span) => {
      span.attributes["queue_name"] = queueName;
      if (!this.provider.dequeue) {
        throw new Error(`Cache provider does not support queue operations (dequeue)`);
      }
      const result = await this.provider.dequeue(queueName);
      span.attributes["found"] = result !== null;
      return result;
    });
  }

  /**
   * Return the current number of items in a named queue without consuming any.
   * Returns 0 if the provider does not support queue operations.
   */
  async queueLength(queueName: string): Promise<number> {
    return await traced("GlobalCacheService.queueLength", "cache.get", async (span) => {
      span.attributes["queue_name"] = queueName;
      if (!this.provider.queueLength) return 0;
      const length = await this.provider.queueLength(queueName);
      span.attributes["length"] = length;
      return length;
    });
  }

  // Multi-tier specific methods
  getMultiTierStats(namespace?: string) {
    if (this.isMultiTier) {
      return (this.provider as MultiTierCacheProvider).getMultiTierStats(
        namespace,
      );
    }
    return null;
  }

  getL1MemoryUsage() {
    if (this.isMultiTier) {
      return (this.provider as MultiTierCacheProvider).getL1MemoryUsage();
    }
    return null;
  }

  getL1EvictionStats(namespace?: string) {
    if (this.isMultiTier) {
      return (this.provider as MultiTierCacheProvider).getL1EvictionStats(
        namespace,
      );
    }
    return null;
  }

  async warmupL1Cache(namespaces?: string[], maxEntriesPerNamespace?: number) {
    return await tracedWithServiceErrorHandling(
      "GlobalCacheService.warmupL1Cache",
      {
        service: "GlobalCacheService",
        method: "warmupL1Cache",
        section: loggerAppSections.INTERNAL,
        details: { isMultiTier: this.isMultiTier },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["is_multi_tier"] = this.isMultiTier;
        span.attributes["has_namespaces"] = !!namespaces;
        if (namespaces) {
          span.attributes["namespace_count"] = namespaces.length;
        }
        if (maxEntriesPerNamespace) {
          span.attributes["max_entries_per_namespace"] = maxEntriesPerNamespace;
        }

        if (this.isMultiTier) {
          const result = await (this.provider as MultiTierCacheProvider).warmupL1Cache(
            namespaces,
            maxEntriesPerNamespace,
          );
          span.attributes["success"] = true;
          return result;
        }
        span.attributes["skipped"] = true;
      },
    );
  }

  getConfiguration() {
    if (this.isMultiTier) {
      return (this.provider as MultiTierCacheProvider).getConfiguration();
    }
    return null;
  }

  // Cache invalidation methods for external use (e.g., cache bus)
  async invalidateKey(namespace: string, key: string) {
    return await traced("GlobalCacheService.invalidateKey", "cache.delete", async (span) => {
      span.attributes["cache_namespace"] = namespace;
      span.attributes["cache_key"] = key;
      span.attributes["is_multi_tier"] = this.isMultiTier;

      if (this.isMultiTier) {
        await (this.provider as MultiTierCacheProvider).invalidateKey(
          namespace,
          key,
        );
        span.attributes["success"] = true;
        return;
      }
      await this.delete(namespace, key);
      span.attributes["success"] = true;
    });
  }

  async invalidatePattern(namespace: string, pattern: string) {
    return await traced("GlobalCacheService.invalidatePattern", "cache.delete", async (span) => {
      span.attributes["cache_namespace"] = namespace;
      span.attributes["pattern"] = pattern;
      span.attributes["is_multi_tier"] = this.isMultiTier;

      if (this.isMultiTier) {
        await (this.provider as MultiTierCacheProvider).invalidatePattern(
          namespace,
          pattern,
        );
        span.attributes["success"] = true;
        return;
      }
      await this.deletePattern(namespace, pattern);
      span.attributes["success"] = true;
    });
  }

  // Cache bus status for monitoring
  getCacheBusStatus() {
    if (this.isMultiTier) {
      const provider = this.provider as MultiTierCacheProvider;
      // We'll need to add a method to get bus status from the provider
      return provider.getCacheBusStatus?.() || null;
    }
    return null;
  }

  /**
   * Get the underlying Redis connection for Pub/Sub use
   * Returns null if not using Redis backend
   *
   * This allows the Pub/Sub service to reuse the existing Redis connection
   * instead of creating a new one.
   */
  getRedisConnection(): { publisher: unknown; subscriber: unknown } | null {
    if (this.isMultiTier) {
      const provider = this.provider as MultiTierCacheProvider;
      return provider.getRedisConnection?.() || null;
    }
    // Check if provider is directly a RedisCacheProvider
    if (this.provider instanceof RedisCacheProvider) {
      return this.provider.getRedisConnection();
    }
    return null;
  }
}

export async function initializeCache(
  enableMultiTier?: boolean,
): Promise<GlobalCacheService> {
  return await tracedWithServiceErrorHandling(
    "initializeCache",
    {
      service: "GlobalCacheService",
      method: "initializeCache",
      section: loggerAppSections.INTERNAL,
      details: { enableMultiTier },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async (span) => {
      span.attributes["enable_multi_tier"] = enableMultiTier ?? "default";

      // Always check NODE_ENV directly (not envConfig) to ensure test mode is detected
      // even if envConfig was initialized before NODE_ENV was set
      const nodeEnv = Deno.env.get("NODE_ENV");
      const isTest = nodeEnv === "test";
      span.attributes["is_test"] = isTest;

      // Use MemoryCacheProvider directly in test environment (no Deno KV required)
      if (isTest) {
        // Force single-tier memory cache in tests (no multi-tier)
        const memoryProvider = tracedSync("initializeCache.createMemoryProvider", "service", (providerSpan) => {
          const provider = new MemoryCacheProvider({
            maxSize: envConfig.cache.l1MaxSize,
            maxEntries: envConfig.cache.l1MaxEntries,
          });
          providerSpan.attributes["provider_type"] = "memory";
          providerSpan.attributes["success"] = true;
          return provider;
        });
        // Don't log in test mode to avoid noise
        span.attributes["provider_type"] = "memory";
        span.attributes["cache_type"] = "single-tier";
        return new GlobalCacheService(memoryProvider);
      }

      // Use environment config if not explicitly specified
      const useMultiTier = enableMultiTier ?? envConfig.cache.enableMultiTier;
      const isUseRedis = envConfig.cache.isRedisEnabled;
      span.attributes["use_multi_tier"] = useMultiTier;
      span.attributes["use_redis"] = isUseRedis;

      if (isUseRedis) {
        const redisHost = envConfig.cache.redisHost!;
        const redisPort = parseInt(envConfig.cache.redisPort!);
        const redisPassword = envConfig.cache.redisPassword;
        const redisDb = parseInt(envConfig.cache.redisDb!);

        try {
          const redis = await traced("initializeCache.connectRedis", "service", async (redisSpan) => {
            redisSpan.attributes["host"] = redisHost;
            redisSpan.attributes["port"] = redisPort;
            redisSpan.attributes["db"] = redisDb;
            redisSpan.attributes["has_password"] = !!redisPassword;

            const connectTimeoutMs = envConfig.cache.redisConnectTimeoutMs;
            redisSpan.attributes["connect_timeout_ms"] = connectTimeoutMs;

            // Race the connect against a timeout so a stalled/cold handshake
            // fails fast into the Deno KV fallback instead of hanging the first
            // cache operation (and the request that triggers it).
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error(`Redis connect timed out after ${connectTimeoutMs}ms`)),
                connectTimeoutMs,
              );
            });

            try {
              const connection = await Promise.race([
                redisDbConnect({
                  hostname: redisHost,
                  port: redisPort,
                  password: redisPassword ? redisPassword : undefined,
                  db: redisDb,
                  maxRetryCount: 3,
                }),
                timeout,
              ]);
              redisSpan.attributes["success"] = true;
              return connection;
            } finally {
              if (timeoutId !== undefined) clearTimeout(timeoutId);
            }
          });

          const l2Provider = tracedSync("initializeCache.createRedisProvider", "service", (providerSpan) => {
            const provider = new RedisCacheProvider(redis);
            providerSpan.attributes["provider_type"] = "redis";
            providerSpan.attributes["success"] = true;
            return provider;
          });

          if (useMultiTier) {
            console.log(
              `Successfully connected to Redis cache with multi-tier support`,
            );
            const provider = tracedSync("initializeCache.createMultiTierProvider", "service", (providerSpan) => {
              const multiTierProvider = new MultiTierCacheProvider(l2Provider, {
                l1MaxSize: envConfig.cache.l1MaxSize,
                l1MaxEntries: envConfig.cache.l1MaxEntries,
              });
              providerSpan.attributes["provider_type"] = "multi-tier-redis";
              providerSpan.attributes["success"] = true;
              return multiTierProvider;
            });
            const service = new GlobalCacheService(provider, { durableEnabled: envConfig.cache.durableEnabled });

            // Warm up L1 cache with hot data
            setTimeout(async () => {
              try {
                await service.warmupL1Cache();
                console.log(`L1 cache warmed up successfully`);
              } catch (error) {
                console.warn(`Failed to warm up L1 cache:`, error);
              }
            }, envConfig.cache.warmupDelaySeconds * 1000);

            span.attributes["cache_type"] = "multi-tier-redis";
            span.attributes["success"] = true;
            return service;
          } else {
            console.log(`Successfully connected to Redis cache (single-tier)`);
            span.attributes["cache_type"] = "single-tier-redis";
            span.attributes["success"] = true;
            return new GlobalCacheService(l2Provider, { durableEnabled: envConfig.cache.durableEnabled });
          }
        } catch (error) {
          useLogger(LoggerLevels.error, {
            message: "Failed to connect to Redis: Connection failed. Using fallback cache",
            section: loggerAppSections.INTERNAL,
            messageKey: "admin_ui.serve_failed",
            details: {
              error: error instanceof Error ? error.message : String(error),
              hostname: redisHost,
              port: redisPort,
              password: !!redisPassword,
              db: redisDb,
            },
          });
          span.attributes["redis_connection_failed"] = true;

          const l2Provider = tracedSync("initializeCache.createDenoKVProvider", "service", (providerSpan) => {
            const provider = new DenoKVCacheProvider();
            providerSpan.attributes["provider_type"] = "deno-kv";
            providerSpan.attributes["success"] = true;
            return provider;
          });

          if (useMultiTier) {
            console.log(`Using Deno KV cache with multi-tier support`);
            const provider = tracedSync("initializeCache.createMultiTierDenoKVProvider", "service", (providerSpan) => {
              const multiTierProvider = new MultiTierCacheProvider(l2Provider, {
                l1MaxSize: Math.floor(envConfig.cache.l1MaxSize / 3), // Smaller L1 for fallback, but still beneficial (2000x+ faster)
                l1MaxEntries: Math.floor(envConfig.cache.l1MaxEntries / 2),
                l1LargeValueThreshold: envConfig.cache.l1LargeValueThresholdKB * 1024,
                l1TtlCleanupInterval: envConfig.cache.ttlCleanupIntervalMinutes * 60 *
                  1000,
              });
              providerSpan.attributes["provider_type"] = "multi-tier-deno-kv";
              providerSpan.attributes["success"] = true;
              return multiTierProvider;
            });
            span.attributes["cache_type"] = "multi-tier-deno-kv-fallback";
            span.attributes["success"] = true;
            return new GlobalCacheService(provider, { durableEnabled: envConfig.cache.durableEnabled });
          } else {
            console.log(`Using Deno KV cache (single-tier)`);
            span.attributes["cache_type"] = "single-tier-deno-kv-fallback";
            span.attributes["success"] = true;
            return new GlobalCacheService(l2Provider, { durableEnabled: envConfig.cache.durableEnabled });
          }
        }
      } else {
        // Double-check test mode in case we somehow reached here
        const nodeEnv = Deno.env.get("NODE_ENV");
        const isTest = nodeEnv === "test";
        if (isTest) {
          // Should not reach here in test mode, but double-check
          const memoryProvider = tracedSync("initializeCache.createMemoryProviderFallback", "service", (providerSpan) => {
            const provider = new MemoryCacheProvider({
              maxSize: envConfig.cache.l1MaxSize,
              maxEntries: envConfig.cache.l1MaxEntries,
            });
            providerSpan.attributes["provider_type"] = "memory";
            providerSpan.attributes["success"] = true;
            return provider;
          });
          span.attributes["cache_type"] = "memory-fallback";
          span.attributes["success"] = true;
          return new GlobalCacheService(memoryProvider);
        }

        const l2Provider = tracedSync("initializeCache.createDenoKVProvider", "service", (providerSpan) => {
          const provider = new DenoKVCacheProvider();
          providerSpan.attributes["provider_type"] = "deno-kv";
          providerSpan.attributes["success"] = true;
          return provider;
        });

        if (useMultiTier) {
          console.log(`Using Deno KV cache with multi-tier support`);
          const provider = tracedSync("initializeCache.createMultiTierDenoKVProvider", "service", (providerSpan) => {
            const multiTierProvider = new MultiTierCacheProvider(l2Provider, {
              l1MaxSize: Math.floor(envConfig.cache.l1MaxSize / 2), // Smaller L1 for dev, but still provides 2000x+ speedup
              l1MaxEntries: Math.floor(envConfig.cache.l1MaxEntries / 2),
              l1LargeValueThreshold: envConfig.cache.l1LargeValueThresholdKB * 1024,
              l1TtlCleanupInterval: envConfig.cache.ttlCleanupIntervalMinutes * 60 *
                1000,
            });
            providerSpan.attributes["provider_type"] = "multi-tier-deno-kv";
            providerSpan.attributes["success"] = true;
            return multiTierProvider;
          });
          span.attributes["cache_type"] = "multi-tier-deno-kv";
          span.attributes["success"] = true;
          return new GlobalCacheService(provider, { durableEnabled: envConfig.cache.durableEnabled });
        } else {
          console.log(`Using Deno KV cache (single-tier)`);
          span.attributes["cache_type"] = "single-tier-deno-kv";
          span.attributes["success"] = true;
          return new GlobalCacheService(l2Provider, { durableEnabled: envConfig.cache.durableEnabled });
        }
      }
    },
  );
}
