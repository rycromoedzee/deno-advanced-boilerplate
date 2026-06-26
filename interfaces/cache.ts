/**
 * @file interfaces/cache.ts
 * @description Cache provider interfaces and types
 * These interfaces define the structure for cache operations and configuration
 */

/**
 * Cache entry structure with value and metadata
 * @template T The type of the cached value
 */
export interface CacheEntry<T> {
  value: T;
  expires?: number;
  createdAt: number;
}

/**
 * Cache operation options
 */
export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
}

/**
 * Cache lock operation options
 */
export interface CacheLockOptions {
  ttlMs?: number;
  waitTimeoutMs?: number;
  retryDelayMs?: number;
}

/**
 * Basic cache statistics
 */
export interface CacheStatistics {
  hits: number;
  misses: number;
  hitRate: number;
  entryCount: number;
  totalSize: number;
  averageEntrySize: number;
  namespace?: string;
  lastResetTime: Date;
  createdTime: Date;
}

/**
 * Extended cache statistics with additional metrics
 */
export interface DetailedCacheStatistics extends CacheStatistics {
  largestEntrySize: number;
  smallestEntrySize: number;
}

/**
 * Combined environment context — status, details, and feature flags
 */
export interface CachedEnvironmentContext {
  status: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  featureDocuments: boolean;
  featureEncryption: boolean;
  featurePublicSharing: boolean;
  featureNotes: boolean;
  featureKnowledgeBase: boolean;
}

/**
 * Cache provider interface defining core operations
 */
export interface CacheProvider {
  /**
   * Get a value from cache
   * @param namespace Cache namespace
   * @param key Cache key
   * @returns Cached value or null if not found
   */
  get<T>(namespace: string, key: string): Promise<T | null>;

  /**
   * Liveness probe — actively round-trips the backing store (Redis PING / KV
   * read; memory is always true). Returns true if reachable, false otherwise.
   * Unlike get(), this does NOT fail open, so a disconnected backend is detected.
   */
  ping(): Promise<boolean>;

  /**
   * Set a value in cache
   * @param namespace Cache namespace
   * @param key Cache key
   * @param value Value to cache
   * @param options Cache options
   */
  set<T>(
    namespace: string,
    key: string,
    value: T,
    options?: CacheOptions,
  ): Promise<void>;

  /**
   * Delete a specific cache entry
   * @param namespace Cache namespace
   * @param key Cache key
   */
  delete(namespace: string, key: string): Promise<void>;

  /**
   * Atomically get and delete a value from cache
   * Used for single-use tokens, challenges, etc.
   * @param namespace Cache namespace
   * @param key Cache key
   * @returns Cached value or null if not found
   */
  getAndDelete<T>(namespace: string, key: string): Promise<T | null>;

  /**
   * Delete entries matching a pattern
   * @param namespace Cache namespace
   * @param pattern Pattern to match
   */
  deletePattern(namespace: string, pattern: string): Promise<void>;

  /**
   * Clear all entries in a namespace
   * @param namespace Cache namespace
   */
  clearNamespace(namespace: string): Promise<void>;

  /**
   * Close cache connections
   */
  close(): Promise<void>;

  /**
   * Get all entries in a namespace
   * @param namespace Cache namespace
   * @returns Map of all entries
   */
  getAllInNamespace(
    namespace: string,
  ): Promise<Map<string, CacheEntry<string | null>>>;

  /**
   * Get entry count for namespace
   * @param namespace Optional namespace filter
   * @returns Number of entries
   */
  getEntryCount(namespace?: string): Promise<number>;

  /**
   * Get average entry size
   * @param namespace Optional namespace filter
   * @returns Average size in bytes
   */
  getAverageEntrySize(namespace?: string): Promise<number>;

  /**
   * Get total cache size
   * @param namespace Optional namespace filter
   * @returns Total size in bytes
   */
  getTotalSize(namespace?: string): Promise<number>;

  /**
   * Get all available namespaces
   * @returns Array of namespace strings
   */
  getAllNamespaces(): Promise<string[]>;

  /**
   * Get detailed statistics
   * @param namespace Optional namespace filter
   * @returns Detailed statistics
   */
  getDetailedStats(namespace?: string): Promise<DetailedCacheStatistics>;

  /**
   * Get basic statistics
   * @param namespace Optional namespace filter
   * @returns Basic statistics
   */
  getStats(namespace?: string): Promise<CacheStatistics>;

  /**
   * Reset statistics counters
   * @param namespace Optional namespace filter
   */
  resetStats(namespace?: string): void;

  /**
   * Acquire a distributed lock for a key.
   * Implementations should return true if the lock was acquired, false otherwise.
   * @param lockKey Lock key
   * @param token Unique token for lock ownership
   * @param ttlMs Lock TTL in milliseconds
   */
  acquireLock(lockKey: string, token: string, ttlMs: number): Promise<boolean>;

  /**
   * Release a distributed lock for a key.
   * Implementations should only release the lock if the token matches.
   * @param lockKey Lock key
   * @param token Unique token for lock ownership
   */
  releaseLock(lockKey: string, token: string): Promise<boolean>;

  /**
   * Atomically enqueue a value to a named queue (append to tail).
   * Used for background task queues and other FIFO workloads.
   * Optional — not all providers are required to implement this.
   * @param queueName Name of the queue
   * @param value Serialized string value to enqueue
   */
  enqueue?(queueName: string, value: string): Promise<void>;

  /**
   * Atomically dequeue a value from a named queue (pop from head).
   * Returns null if the queue is empty.
   * Optional — not all providers are required to implement this.
   * @param queueName Name of the queue
   * @returns Dequeued value or null if empty
   */
  dequeue?(queueName: string): Promise<string | null>;

  /**
   * Get the current length of a named queue.
   * Optional — not all providers are required to implement this.
   * @param queueName Name of the queue
   * @returns Number of items in the queue
   */
  queueLength?(queueName: string): Promise<number>;
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
  enableMultiTier?: boolean;
  isRedisEnabled?: boolean;
  redisHost?: string;
  redisPort?: string;
  redisPassword?: string;
  redisDb?: string;
  l1MaxSize?: number;
  l1MaxEntries?: number;
  warmupDelaySeconds?: number;
  ttlCleanupIntervalMinutes?: number;
  l1LargeValueThresholdKB?: number;
  enableCacheBus?: boolean;
  busRetryDelaySeconds?: number;
  redisKeysScanLimit?: number;
  redisMemoryScanLimit?: number;
  redisBatchSize?: number;
}

/**
 * Durability policy for a single cache namespace (shape only).
 *
 * The runtime registry of which namespaces are durable lives in
 * `services/cache/cache.config.ts` (`DURABLE_CACHE_POLICY`); this is just its
 * per-entry type.
 */
export interface DurableNamespacePolicy {
  /** Which physical DB the durable copy lives in. */
  scope: "global" | "tenant";
  /** sync = persist before set() resolves (auth/must-survive); async = write-behind, fire-and-forget. */
  writeMode: "sync" | "async";
  // TTL is taken from the CacheOptions passed to set(); the store persists the absolute expiry (now + ttl).
}

// The runtime CACHE_NAMESPACES registry now lives in services/cache/cache.config.ts
// (operational config, not a type). Import it via `@services/cache/index.ts`.
