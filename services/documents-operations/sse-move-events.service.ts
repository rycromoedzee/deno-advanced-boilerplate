/**
 * @file services/documents/sse-move-events.service.ts
 * @description SSE service for broadcasting move operation events
 */

import type { MoveOperationSSEEvent, MoveOperationSSEEventType, MoveOperationStatusType } from "@interfaces/move-operations.ts";
import { getTimeNow } from "@utils/shared/time.ts";

/**
 * SSE connection manager for move operations
 */
class SSEMoveEventService {
  private connections: Map<string, Set<ReadableStreamDefaultController>> = new Map();
  private pendingEvents: Map<string, MoveOperationSSEEvent[]> = new Map();
  private readonly PENDING_EVENTS_TTL = 60 * 1000; // 60 seconds

  /**
   * Register a new SSE connection for an operation
   */
  registerConnection(
    operationId: string,
    controller: ReadableStreamDefaultController,
  ): void {
    if (!this.connections.has(operationId)) {
      this.connections.set(operationId, new Set());
    }
    this.connections.get(operationId)!.add(controller);

    // Deliver any pending events for this operation
    // (includes move_started if operation already began)
    this.deliverPendingEvents(operationId, controller);
  }

  /**
   * Unregister an SSE connection
   */
  unregisterConnection(
    operationId: string,
    controller: ReadableStreamDefaultController,
  ): void {
    const connections = this.connections.get(operationId);
    if (connections) {
      connections.delete(controller);
      if (connections.size === 0) {
        this.connections.delete(operationId);
      }
    }
  }

  /**
   * Broadcast an event to all connections for an operation
   */
  broadcastEvent(
    operationId: string,
    eventType: MoveOperationSSEEventType,
    data: Partial<MoveOperationStatusType>,
  ): void {
    const event: MoveOperationSSEEvent = {
      type: eventType,
      operationId,
      timestamp: getTimeNow(),
      data,
    };

    const connections = this.connections.get(operationId);

    // If no connections, store event as pending for future delivery
    if (!connections || connections.size === 0) {
      this.storePendingEvent(operationId, event);
      return;
    }

    const closedConnections: ReadableStreamDefaultController[] = [];

    for (const controller of connections) {
      try {
        this.sendEvent(controller, event);
      } catch (_error) {
        // Connection closed, mark for removal
        closedConnections.push(controller);
      }
    }

    // Clean up closed connections
    for (const controller of closedConnections) {
      this.unregisterConnection(operationId, controller);
    }
  }

  /**
   * Send an SSE event to a single controller
   */
  private sendEvent(
    controller: ReadableStreamDefaultController,
    event: MoveOperationSSEEvent,
  ): void {
    const data = JSON.stringify(event);
    controller.enqueue(
      new TextEncoder().encode(`data: ${data}\n\n`),
    );
  }

  /**
   * Get connection count for an operation
   */
  getConnectionCount(operationId: string): number {
    return this.connections.get(operationId)?.size || 0;
  }

  /**
   * Get total active connections
   */
  getTotalConnections(): number {
    let total = 0;
    for (const connections of this.connections.values()) {
      total += connections.size;
    }
    return total;
  }

  /**
   * Close all connections for an operation
   */
  closeOperationConnections(operationId: string): void {
    const connections = this.connections.get(operationId);
    if (connections) {
      for (const controller of connections) {
        try {
          controller.close();
        } catch (_error) {
          // Ignore errors when closing
        }
      }
      this.connections.delete(operationId);
    }
  }

  /**
   * Clean up all connections (useful for shutdown)
   */
  cleanup(): void {
    for (const [_operationId, connections] of this.connections.entries()) {
      for (const controller of connections) {
        try {
          controller.close();
        } catch (_error) {
          // Ignore errors
        }
      }
    }
    this.connections.clear();
    this.pendingEvents.clear();
  }

  /**
   * Store an event for delivery when a connection is established
   */
  private storePendingEvent(
    operationId: string,
    event: MoveOperationSSEEvent,
  ): void {
    if (!this.pendingEvents.has(operationId)) {
      this.pendingEvents.set(operationId, []);
    }

    const events = this.pendingEvents.get(operationId)!;
    events.push(event);

    // Auto-cleanup pending events after TTL
    setTimeout(() => {
      const currentEvents = this.pendingEvents.get(operationId);
      if (currentEvents) {
        const index = currentEvents.indexOf(event);
        if (index !== -1) {
          currentEvents.splice(index, 1);
        }
        // Remove the array if empty
        if (currentEvents.length === 0) {
          this.pendingEvents.delete(operationId);
        }
      }
    }, this.PENDING_EVENTS_TTL);
  }

  /**
   * Deliver pending events to a newly connected client
   */
  private deliverPendingEvents(
    operationId: string,
    controller: ReadableStreamDefaultController,
  ): void {
    const events = this.pendingEvents.get(operationId);
    if (!events || events.length === 0) {
      return;
    }

    // Send all pending events in order
    for (const event of events) {
      try {
        this.sendEvent(controller, event);
      } catch (_error) {
        // Connection already closed, ignore
        break;
      }
    }

    // Clear pending events after delivery
    this.pendingEvents.delete(operationId);
  }
}

// Singleton instance
let sseEventServiceInstance: SSEMoveEventService | null = null;

/**
 * Get singleton instance of SSE Move Event Service
 */
export function getSSEMoveEventService(): SSEMoveEventService {
  if (!sseEventServiceInstance) {
    sseEventServiceInstance = new SSEMoveEventService();
  }
  return sseEventServiceInstance;
}

/**
 * Create an SSE stream for move operation updates
 */
export function createMoveOperationSSEStream(
  operationId: string,
): ReadableStream<Uint8Array> {
  const sseService = getSSEMoveEventService();
  let pingInterval: ReturnType<typeof setInterval> | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  return new ReadableStream({
    start(controller) {
      // Store controller reference
      streamController = controller;

      // Register connection
      sseService.registerConnection(operationId, controller);

      // Send ping every 30 seconds to keep connection alive
      pingInterval = setInterval(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(`: ping\n\n`),
          );
        } catch (_error) {
          // Connection closed
          if (pingInterval !== undefined) {
            clearInterval(pingInterval);
          }
          sseService.unregisterConnection(operationId, controller);
        }
      }, 30000);
    },
    cancel() {
      // Cleanup on cancel
      if (pingInterval !== undefined) {
        clearInterval(pingInterval);
      }
      if (streamController) {
        sseService.unregisterConnection(operationId, streamController);
      }
    },
  });
}

/**
 * Helper function to broadcast move operation events
 */
export async function broadcastMoveEvent(
  operationId: string,
  eventType: MoveOperationSSEEventType,
  status: Partial<MoveOperationStatusType>,
): Promise<void> {
  const sseService = getSSEMoveEventService();
  await sseService.broadcastEvent(operationId, eventType, status);
}
