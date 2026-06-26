/**
 * @file services/background-tasks/providers/cache-queue.provider.ts
 * @description Queue provider that uses the cache service's queue operations
 *
 * This provider wraps the GlobalCacheService's enqueue/dequeue methods
 * to provide atomic FIFO queue operations for background tasks.
 *
 * The cache service handles the underlying implementation:
 * - Redis: RPUSH/LPOP (atomic)
 * - Deno KV: Atomic transactions
 * - Memory: Array operations (single-threaded)
 */

import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import type { BackgroundTask, TaskQueueProvider } from "@interfaces/background-task.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

const QUEUE_NAME = "default";

/**
 * Queue provider that uses the cache service's built-in queue operations.
 *
 * This is the recommended provider as it leverages the existing cache
 * infrastructure and automatically works with whatever cache backend
 * is configured (Redis, Deno KV, or Memory).
 */
export class CacheQueueProvider implements TaskQueueProvider {
  /**
   * Add a task to the queue
   * Serializes the task to JSON and appends to the queue
   */
  async enqueue(task: BackgroundTask): Promise<void> {
    const cache = await getCache();
    const serialized = JSON.stringify(task);
    await cache.enqueue(
      `${CACHE_NAMESPACES.BACKGROUND_TASKS.QUEUE}:${QUEUE_NAME}`,
      serialized,
    );
  }

  /**
   * Remove and return the next task from the queue (atomic)
   * Returns null if queue is empty
   *
   * The cache service ensures atomic dequeue operations:
   * - Redis: LPOP (atomic)
   * - Deno KV: Atomic transactions
   * - Memory: Array.shift (single-threaded, no race conditions)
   */
  async dequeue(): Promise<BackgroundTask | null> {
    const cache = await getCache();
    const serialized = await cache.dequeue(
      `${CACHE_NAMESPACES.BACKGROUND_TASKS.QUEUE}:${QUEUE_NAME}`,
    );

    if (!serialized) {
      return null;
    }

    try {
      return JSON.parse(serialized) as BackgroundTask;
    } catch (error) {
      useLogger(LoggerLevels.error, {
        message: "Failed to parse dequeued task",
        messageKey: "background_tasks.dequeue_parse_error",
        section: loggerAppSections.INTERNAL,
        raw: error,
      });
      return null;
    }
  }

  /**
   * Peek at the next task without removing it
   * Note: This is not natively supported by cache queues,
   * so we dequeue and re-enqueue if needed
   */
  async peek(): Promise<BackgroundTask | null> {
    // Cache queues don't support peek natively
    // Dequeue and re-enqueue to simulate peek
    const task = await this.dequeue();
    if (task) {
      await this.enqueue(task);
    }
    return task;
  }

  /**
   * Get the current queue length
   */
  async length(): Promise<number> {
    const cache = await getCache();
    const length = await cache.queueLength(
      `${CACHE_NAMESPACES.BACKGROUND_TASKS.QUEUE}:${QUEUE_NAME}`,
    );
    return length;
  }

  /**
   * Clear all tasks from the queue
   * Note: This is not natively supported, so we dequeue all items
   */
  async clear(): Promise<void> {
    const cache = await getCache();
    // Dequeue all items until empty
    while (await cache.dequeue(`${CACHE_NAMESPACES.BACKGROUND_TASKS.QUEUE}:${QUEUE_NAME}`)) {
      // Continue until queue is empty
    }
  }

  /**
   * Close queue connections
   * No-op for cache-based provider as the cache service manages connections
   */
  async close(): Promise<void> {
    // No-op - cache service manages its own connections
  }
}
