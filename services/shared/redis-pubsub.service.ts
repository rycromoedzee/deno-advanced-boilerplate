/**
 * @file services/shared/redis-pubsub.service.ts
 * @description Redis-based Pub/Sub implementation for distributed SSE messaging
 *
 * This implementation supports horizontally scaled deployments by using
 * Redis Pub/Sub to broadcast events across all instances.
 *
 * Can use an existing Redis connection from the cache system or create
 * its own if needed.
 */

import { type Redis, redisDbConnect } from "@deps";
import { envConfig } from "@config/env.ts";
import type { IPubSubService } from "@interfaces/pubsub.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

/**
 * Redis subscriber interface for async iteration
 */
interface RedisSubscriber {
  receive(): AsyncIterable<{ message: string }>;
}

/**
 * Configuration for RedisPubSubService
 */
export interface RedisPubSubConfig {
  /** Existing Redis connection to use for publishing (optional) */
  publisher?: Redis;
  /** Existing Redis connection to use for subscribing (optional) */
  subscriber?: Redis;
  /** Whether the service owns the connections (should close on cleanup) */
  ownsConnections?: boolean;
}

/**
 * Redis-based Pub/Sub service for distributed deployments
 *
 * Uses separate connections for publishing and subscribing.
 * All instances receive messages published to subscribed channels.
 *
 * Can reuse existing Redis connections from the cache system to avoid
 * creating unnecessary additional connections.
 */
export class RedisPubSubService implements IPubSubService {
  private publisher: Redis | null;
  private subscriber: Redis | null;
  private activeSubscriptions: Map<string, RedisSubscriber> = new Map();
  private ownsConnections: boolean;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelayMs = 1000;

  /**
   * Create a new Redis Pub/Sub service
   *
   * @param config - Configuration options including optional existing connections
   */
  constructor(config: RedisPubSubConfig = {}) {
    this.publisher = config.publisher || null;
    this.subscriber = config.subscriber || null;
    this.ownsConnections = config.ownsConnections ?? !config.publisher;
  }

  /**
   * Initialize Redis connections lazily on first use (only if not provided)
   */
  private async ensureConnected(): Promise<void> {
    if (this.publisher && this.subscriber) {
      return;
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      let attempts = 0;
      while (this.isConnecting && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
      if (this.publisher && this.subscriber) {
        return;
      }
      throw new Error("Redis Pub/Sub connection timeout");
    }

    this.isConnecting = true;

    try {
      const host = envConfig.cache.redisHost || "localhost";
      const port = parseInt(envConfig.cache.redisPort || "6379");
      const password = envConfig.cache.redisPassword?.trim() || undefined;

      // Create publisher connection
      this.publisher = await redisDbConnect({
        hostname: host,
        port,
        password,
      });

      // Create separate subscriber connection (required by Redis)
      this.subscriber = await redisDbConnect({
        hostname: host,
        port,
        password,
      });

      this.ownsConnections = true;
      this.reconnectAttempts = 0;

      await useLogger(LoggerLevels.info, {
        message: "Redis Pub/Sub service connected",
        section: loggerAppSections.INTERNAL,
        messageKey: "redis_pubsub.connected",
        details: { host, port, ownsConnections: this.ownsConnections },
      });
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Failed to connect Redis Pub/Sub service",
        section: loggerAppSections.INTERNAL,
        messageKey: "redis_pubsub.connection_error",
        raw: error,
      });
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Publish a message to a channel
   * All instances subscribed to the channel will receive the message
   */
  async publish(channel: string, message: string): Promise<void> {
    try {
      await this.ensureConnected();
      if (!this.publisher) {
        throw new Error("Redis publisher not connected");
      }
      await this.publisher.publish(channel, message);
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Failed to publish Redis message",
        section: loggerAppSections.INTERNAL,
        messageKey: "redis_pubsub.publish_error",
        details: { channel },
        raw: error,
      });
      // Don't throw - publishing should be fire-and-forget
    }
  }

  /**
   * Subscribe to a channel
   * Sets up async message handling for the channel
   */
  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    try {
      await this.ensureConnected();
      if (!this.subscriber) {
        throw new Error("Redis subscriber not connected");
      }

      // Check if already subscribed to this channel
      if (this.activeSubscriptions.has(channel)) {
        await useLogger(LoggerLevels.debug, {
          message: "Already subscribed to channel",
          section: loggerAppSections.INTERNAL,
          messageKey: "redis_pubsub.already_subscribed",
          details: { channel },
        });
        return;
      }

      const subscriber = await this.subscriber.subscribe(channel);
      this.activeSubscriptions.set(channel, subscriber);

      // Start processing messages in the background
      this.processMessages(channel, subscriber, callback);
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Failed to subscribe to Redis channel",
        section: loggerAppSections.INTERNAL,
        messageKey: "redis_pubsub.subscribe_error",
        details: { channel },
        raw: error,
      });
      throw error;
    }
  }

  /**
   * Process incoming messages for a subscription
   * Runs in the background until unsubscribed or connection closes
   */
  private async processMessages(
    channel: string,
    subscriber: RedisSubscriber,
    callback: (message: string) => void,
  ): Promise<void> {
    try {
      for await (const { message } of subscriber.receive()) {
        try {
          callback(message);
        } catch (callbackError) {
          await useLogger(LoggerLevels.warn, {
            message: "Error in Redis Pub/Sub callback",
            section: loggerAppSections.INTERNAL,
            messageKey: "redis_pubsub.callback_error",
            details: { channel },
            raw: callbackError,
          });
        }
      }
    } catch (error) {
      // Only log if we're still supposed to be subscribed
      if (this.activeSubscriptions.has(channel)) {
        await useLogger(LoggerLevels.warn, {
          message: "Redis subscription stream ended unexpectedly",
          section: loggerAppSections.INTERNAL,
          messageKey: "redis_pubsub.stream_ended",
          details: { channel },
          raw: error,
        });

        // Attempt to reconnect if under max attempts and we own connections
        if (this.ownsConnections && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => {
            this.activeSubscriptions.delete(channel);
            this.subscribe(channel, callback).catch(() => {
              // Error already logged in subscribe
            });
          }, this.reconnectDelayMs * this.reconnectAttempts);
        }
      }
    }
  }

  /**
   * Unsubscribe from a channel
   * Note: Deno Redis doesn't have an explicit unsubscribe method.
   * We remove the subscription from tracking, which will allow the
   * message processing loop to exit naturally.
   */
  async unsubscribe(channel: string): Promise<void> {
    const subscriber = this.activeSubscriptions.get(channel);
    if (!subscriber) {
      return;
    }

    try {
      // Remove from active subscriptions to stop message processing
      this.activeSubscriptions.delete(channel);

      await useLogger(LoggerLevels.debug, {
        message: "Unsubscribed from Redis channel",
        section: loggerAppSections.INTERNAL,
        messageKey: "redis_pubsub.unsubscribed",
        details: { channel },
      });
    } catch (error) {
      await useLogger(LoggerLevels.warn, {
        message: "Error unsubscribing from Redis channel",
        section: loggerAppSections.INTERNAL,
        messageKey: "redis_pubsub.unsubscribe_error",
        details: { channel },
        raw: error,
      });
    }
  }

  /**
   * Close all connections and cleanup
   * Only closes connections if this service owns them
   */
  async close(): Promise<void> {
    // Clear all active subscriptions
    this.activeSubscriptions.clear();

    // Only close connections if we own them (not borrowed from cache)
    if (this.ownsConnections) {
      if (this.subscriber) {
        try {
          await this.subscriber.quit();
        } catch {
          // Ignore errors during cleanup
        }
        this.subscriber = null;
      }

      if (this.publisher) {
        try {
          await this.publisher.quit();
        } catch {
          // Ignore errors during cleanup
        }
        this.publisher = null;
      }

      await useLogger(LoggerLevels.info, {
        message: "Redis Pub/Sub service closed",
        section: loggerAppSections.INTERNAL,
        messageKey: "redis_pubsub.closed",
      });
    } else {
      // Just clear references if we don't own the connections
      this.subscriber = null;
      this.publisher = null;

      await useLogger(LoggerLevels.debug, {
        message: "Redis Pub/Sub service released (connections not owned)",
        section: loggerAppSections.INTERNAL,
        messageKey: "redis_pubsub.released",
      });
    }
  }
}
