/**
 * @file interfaces/pubsub.ts
 * @description Abstract interface for publish/subscribe messaging patterns
 *
 * This interface abstracts the underlying Pub/Sub implementation,
 * allowing the system to switch between in-memory EventEmitter and
 * distributed solutions like Redis based on configuration.
 */

/**
 * Interface for publish/subscribe messaging services
 *
 * Implementations can use different backends:
 * - EventEmitter (in-memory, single instance)
 * - Redis Pub/Sub (distributed, multi-instance)
 * - PostgreSQL LISTEN/NOTIFY (distributed, database-backed)
 */
export interface IPubSubService {
  /**
   * Publish a message to a channel
   *
   * @param channel - The channel to publish to
   * @param message - The message to publish (must be a string)
   * @returns Promise that resolves when the message is published
   */
  publish(channel: string, message: string): Promise<void>;

  /**
   * Subscribe to a channel and receive messages
   *
   * @param channel - The channel to subscribe to
   * @param callback - Function to call when a message is received
   * @returns Promise that resolves when subscribed
   */
  subscribe(channel: string, callback: (message: string) => void): Promise<void>;

  /**
   * Unsubscribe from a channel
   *
   * @param channel - The channel to unsubscribe from
   * @returns Promise that resolves when unsubscribed
   */
  unsubscribe(channel: string): Promise<void>;

  /**
   * Close all connections and cleanup resources
   *
   * @returns Promise that resolves when cleanup is complete
   */
  close(): Promise<void>;
}

/**
 * Type for the Pub/Sub factory configuration
 */
export interface PubSubConfig {
  /** Whether Redis is enabled for distributed Pub/Sub */
  isRedisEnabled: boolean;
  /** Redis host (required if isRedisEnabled is true) */
  redisHost?: string;
  /** Redis port (required if isRedisEnabled is true) */
  redisPort?: string;
  /** Redis password (optional) */
  redisPassword?: string;
  /** Redis database number (optional) */
  redisDb?: string;
}
