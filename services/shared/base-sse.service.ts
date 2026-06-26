/**
 * @file services/shared/base-sse.service.ts
 * @description Generic base class for SSE (Server-Sent Events) services
 *
 * Refactored to use the Pub/Sub abstraction for distributed messaging.
 * Supports both Redis (distributed) and EventEmitter (local) backends.
 */

import type { SSEConnection, SSEEvent } from "./sse.types.ts";
import type { IPubSubService } from "@interfaces/pubsub.ts";

/**
 * Generic base class for SSE services
 * @template TData - Type of data being streamed
 * @template TFilters - Type of filters for the connection
 */
export abstract class BaseSSEService<TData, TFilters = Record<string, unknown>> {
  protected connections: Map<string, SSEConnection<TFilters>> = new Map();
  protected connectionCounter = 0;
  protected readonly eventName: string;
  protected readonly connectionPrefix: string;
  protected readonly maxConnections = 10000;
  protected readonly maxConnectionsPerUser = 10;
  private pubSub: IPubSubService | null = null;
  private isSubscribed = false;
  private subscriptionPromise: Promise<void> | null = null;

  /**
   * @param eventName - Name of the event channel to subscribe to
   * @param connectionPrefix - Prefix for connection IDs
   */
  constructor(eventName: string, connectionPrefix: string) {
    this.eventName = eventName;
    this.connectionPrefix = connectionPrefix;
    // Initialize Pub/Sub synchronously (will create new connection if needed)
    // For better connection reuse, call initializePubSub() after construction
    this.initializeSubscription();
  }

  /**
   * Initialize Pub/Sub with connection reuse from cache
   * Call this after construction for optimal connection management
   */
  async initializePubSub(): Promise<void> {
    if (this.pubSub && this.isSubscribed) {
      return;
    }

    const { getPubSubService } = await import("./pubsub.factory.ts");
    this.pubSub = await getPubSubService();
    await this.initializeSubscription();
  }

  /**
   * Initialize subscription to the Pub/Sub channel
   * Messages received are deserialized and passed to handleEvent
   */
  // deno-lint-ignore require-await
  private async initializeSubscription(): Promise<void> {
    if (this.isSubscribed || !this.pubSub) return;

    if (this.subscriptionPromise) {
      return this.subscriptionPromise;
    }

    this.subscriptionPromise = this.pubSub.subscribe(this.eventName, (message: string) => {
      try {
        const event = JSON.parse(message) as SSEEvent<TData>;
        this.handleEvent(event);
      } catch (error) {
        console.error(`Failed to parse SSE event for ${this.eventName}:`, error);
      }
    }).then(() => {
      this.isSubscribed = true;
    }).catch((error) => {
      console.error(`Failed to subscribe to ${this.eventName}:`, error);
      this.subscriptionPromise = null;
      throw error;
    });

    return this.subscriptionPromise;
  }

  /**
   * Register a new SSE connection
   */
  registerConnection(
    controller: ReadableStreamDefaultController<Uint8Array>,
    userId: string,
    environmentId: string,
    filters?: TFilters,
  ): string {
    if (this.connections.size >= this.maxConnections) {
      try {
        controller.close();
      } catch (_error) {
        // Ignore close errors
      }
      console.warn(`SSE connection limit reached for ${this.eventName}`);
      return "";
    }

    if (this.getUserConnectionCount(userId, environmentId) >= this.maxConnectionsPerUser) {
      try {
        controller.close();
      } catch (_error) {
        // Ignore close errors
      }
      console.warn(`SSE per-user connection limit reached for userId=${userId} on ${this.eventName}`);
      return "";
    }

    const connectionId = `${this.connectionPrefix}-${++this.connectionCounter}-${Date.now()}`;
    this.connections.set(connectionId, { controller, userId, environmentId, filters });
    this.sendEvent(controller, "connected", {});
    return connectionId;
  }

  /**
   * Unregister an SSE connection
   */
  unregisterConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  /**
   * Send heartbeat to a specific connection
   */
  sendHeartbeat(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        connection.controller.enqueue(
          new TextEncoder().encode(`: heartbeat\n\n`),
        );
      } catch (_error) {
        this.unregisterConnection(connectionId);
      }
    }
  }

  /**
   * Get total active connections
   */
  getTotalConnections(): number {
    return this.connections.size;
  }

  /**
   * Get connections for a specific user
   */
  getUserConnectionCount(userId: string, environmentId: string): number {
    let count = 0;
    for (const connection of this.connections.values()) {
      if (connection.userId === userId && connection.environmentId === environmentId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Close all connections for a user
   */
  closeUserConnections(userId: string, environmentId: string): void {
    const connectionsToClose: string[] = [];

    for (const [connectionId, connection] of this.connections.entries()) {
      if (connection.userId === userId && connection.environmentId === environmentId) {
        connectionsToClose.push(connectionId);
        try {
          connection.controller.close();
        } catch (_error) {
          // Ignore errors when closing
        }
      }
    }

    for (const connectionId of connectionsToClose) {
      this.connections.delete(connectionId);
    }
  }

  /**
   * Clean up all connections (useful for shutdown)
   */
  cleanup(): void {
    for (const [_connectionId, connection] of this.connections.entries()) {
      try {
        connection.controller.close();
      } catch (_error) {
        // Ignore errors
      }
    }
    this.connections.clear();
    if (this.pubSub) {
      this.pubSub.unsubscribe(this.eventName).catch(() => {});
    }
  }

  /**
   * Broadcast data to all matching connections via Pub/Sub
   * This ensures all instances (not just this one) receive the event
   */
  broadcast(data: TData, userId: string, environmentId: string): void {
    const event: SSEEvent<TData> = {
      data,
      userId,
      environmentId,
    };

    // Publish to the Pub/Sub channel for distributed delivery
    if (this.pubSub) {
      this.pubSub.publish(this.eventName, JSON.stringify(event)).catch((error) => {
        console.error(`Failed to broadcast to ${this.eventName}:`, error);
      });
    }
  }

  /**
   * Handle incoming events and broadcast to appropriate connections
   * This is called when a message is received from the Pub/Sub channel
   */
  private async handleEvent(event: SSEEvent<TData>): Promise<void> {
    const closedConnections: string[] = [];

    await Promise.all(
      [...this.connections.entries()].map(async ([connectionId, connection]) => {
        if (!this.shouldDeliverToConnection(event.data, connection, event)) {
          return;
        }

        // Check permission if the subclass requires it
        const hasPermission = await this.checkPermission(event.data, connection);
        if (!hasPermission) {
          return;
        }

        try {
          this.sendData(connection.controller, event.data);
        } catch (_error) {
          closedConnections.push(connectionId);
        }
      }),
    );

    // Clean up closed connections
    for (const connectionId of closedConnections) {
      this.unregisterConnection(connectionId);
    }
  }

  /**
   * Check if the connection has permission to receive this event
   * Override in subclasses to implement permission checks
   * @returns true if the connection should receive the event
   */
  // deno-lint-ignore require-await
  protected async checkPermission(
    _data: TData,
    _connection: SSEConnection<TFilters>,
  ): Promise<boolean> {
    // Default: deny access - subclasses MUST explicitly grant permission
    // This follows the secure-by-default principle
    console.warn(
      `SSE service ${this.constructor.name} did not override checkPermission - denying by default`,
    );
    return false;
  }

  /**
   * Send a custom SSE event (with event type)
   */
  protected sendEvent(
    controller: ReadableStreamDefaultController<Uint8Array>,
    eventType: string,
    data: unknown,
  ): void {
    const dataStr = JSON.stringify(data);
    controller.enqueue(
      new TextEncoder().encode(`event: ${eventType}\ndata: ${dataStr}\n\n`),
    );
  }

  /**
   * Send SSE data (default message type)
   */
  protected sendData(
    controller: ReadableStreamDefaultController<Uint8Array>,
    data: unknown,
  ): void {
    const dataStr = JSON.stringify(data);
    controller.enqueue(
      new TextEncoder().encode(`data: ${dataStr}\n\n`),
    );
  }

  /**
   * Override to implement domain-specific filter matching
   */
  protected abstract matchesFilters(data: TData, filters: TFilters): boolean;

  /**
   * Override for additional delivery logic (e.g., environment checks)
   */
  protected shouldDeliverToConnection(
    data: TData,
    connection: SSEConnection<TFilters>,
    event: SSEEvent<TData>,
  ): boolean {
    if (connection.environmentId !== event.environmentId) {
      return false;
    }
    if (connection.filters && !this.matchesFilters(data, connection.filters)) {
      return false;
    }
    return true;
  }
}
