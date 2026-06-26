/**
 * @file services/shared/pubsub.factory.ts
 * @description Factory for creating the appropriate Pub/Sub service
 *
 * Selects between Redis-based (distributed) and EventEmitter-based (local)
 * Pub/Sub implementations based on configuration.
 *
 * When Redis is enabled, reuses the existing Redis connection from the cache
 * system to avoid creating unnecessary additional connections.
 */

import { envConfig } from "@config/env.ts";
import type { IPubSubService } from "@interfaces/pubsub.ts";
import { EventEmitterPubSubService } from "./event-emitter-pubsub.service.ts";
import { type RedisPubSubConfig, RedisPubSubService } from "./redis-pubsub.service.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getCache } from "@services/cache/index.ts";
import type { Redis } from "@deps";

let pubSubInstance: IPubSubService | null = null;

/**
 * Get the singleton Pub/Sub service instance
 *
 * Returns Redis-based implementation if Redis is enabled in config,
 * otherwise falls back to in-memory EventEmitter implementation.
 *
 * When using Redis, attempts to reuse the existing connection from
 * the cache system to minimize connection overhead.
 *
 * @returns The configured Pub/Sub service instance
 */
export async function getPubSubService(): Promise<IPubSubService> {
  if (pubSubInstance) {
    return pubSubInstance;
  }

  const isRedisEnabled = envConfig.cache.isRedisEnabled;

  if (isRedisEnabled) {
    try {
      // Try to get existing Redis connection from cache
      const cache = await getCache();
      const redisConnection = cache.getRedisConnection();

      if (redisConnection && redisConnection.publisher) {
        const config: RedisPubSubConfig = {
          publisher: redisConnection.publisher as Redis,
          subscriber: (redisConnection.subscriber || redisConnection.publisher) as Redis,
          ownsConnections: false, // Cache owns the connections
        };

        pubSubInstance = new RedisPubSubService(config);
      } else {
        // Fallback: create new connection (shouldn't happen normally)
        pubSubInstance = new RedisPubSubService();
      }
    } catch (error) {
      // If Redis fails, fall back to EventEmitter
      await useLogger(LoggerLevels.warn, {
        message: "Failed to initialize Redis Pub/Sub, falling back to EventEmitter",
        section: loggerAppSections.INTERNAL,
        messageKey: "pubsub.redis_fallback",
        raw: error,
      });

      pubSubInstance = new EventEmitterPubSubService();
    }
  } else {
    pubSubInstance = new EventEmitterPubSubService();
  }

  return pubSubInstance;
}

/**
 * Reset the Pub/Sub singleton (for testing)
 * @internal
 */
export function resetPubSubService(): void {
  pubSubInstance = null;
}

/**
 * Check if distributed Pub/Sub is being used
 * Useful for logging/monitoring purposes
 */
export function isDistributedPubSub(): boolean {
  return envConfig.cache.isRedisEnabled;
}
