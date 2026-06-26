/**
 * @file services/shared/event-emitter-pubsub.service.ts
 * @description In-memory Pub/Sub implementation using Node's EventEmitter
 *
 * This is the fallback implementation for single-instance deployments
 * where Redis is not available. Events are only delivered to connections
 * on the same process.
 */

import { EventEmitter } from "@deps";
import type { IPubSubService } from "@interfaces/pubsub.ts";

/**
 * In-memory Pub/Sub service using Node's EventEmitter
 *
 * Suitable for single-instance deployments. Does NOT work for
 * horizontally scaled deployments - use RedisPubSubService instead.
 */
export class EventEmitterPubSubService implements IPubSubService {
  private emitter = new EventEmitter();
  private subscriptions: Map<string, (message: string) => void> = new Map();

  /**
   * Publish a message to a channel
   * Synchronously delivers to all local subscribers
   */
  // deno-lint-ignore require-await
  async publish(channel: string, message: string): Promise<void> {
    this.emitter.emit(channel, message);
  }

  /**
   * Subscribe to a channel
   * Stores the callback reference for later cleanup
   */
  // deno-lint-ignore require-await
  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    // Store the callback for proper cleanup later
    this.subscriptions.set(channel, callback);
    this.emitter.on(channel, callback);
  }

  /**
   * Unsubscribe from a channel
   * Removes the stored callback reference
   */
  // deno-lint-ignore require-await
  async unsubscribe(channel: string): Promise<void> {
    const callback = this.subscriptions.get(channel);
    if (callback) {
      this.emitter.off(channel, callback);
      this.subscriptions.delete(channel);
    }
  }

  /**
   * Close all subscriptions and cleanup resources
   */
  // deno-lint-ignore require-await
  async close(): Promise<void> {
    // Remove all listeners for tracked subscriptions
    for (const [channel, callback] of this.subscriptions) {
      this.emitter.off(channel, callback);
    }
    this.subscriptions.clear();
    // Remove any remaining listeners
    this.emitter.removeAllListeners();
  }
}
