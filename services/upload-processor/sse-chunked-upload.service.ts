/**
 * @file services/upload-processor/sse-chunked-upload.service.ts
 * @description SSE service for broadcasting chunked upload assembly progress events.
 *
 * Pattern mirrors sse-move-events.service.ts. Events are keyed by sessionId.
 * Pending events are stored for up to 60 seconds so clients that connect after
 * the background worker has already emitted events still receive them.
 */

import { getTimeNow } from "@utils/shared/time.ts";
import { getSSEChunkedUploadService } from "./singletons.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChunkedUploadEventType =
  | "assembling" // Assembly background task started
  | "completed" // Document created successfully
  | "failed" // Assembly failed
  | "heartbeat"; // Keep-alive ping

export interface ChunkedUploadSSEEvent {
  type: ChunkedUploadEventType;
  sessionId: string;
  timestamp: number;
  data: {
    /** Populated when type === "completed" */
    documentId?: string;
    /** Populated when type === "failed" */
    errorMessage?: string;
    /** Human-readable status string */
    status?: string;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SSEChunkedUploadService {
  private connections: Map<string, Set<ReadableStreamDefaultController<Uint8Array>>> = new Map();
  private pendingEvents: Map<string, ChunkedUploadSSEEvent[]> = new Map();
  private readonly PENDING_EVENTS_TTL_MS = 60 * 1000;

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  registerConnection(sessionId: string, controller: ReadableStreamDefaultController<Uint8Array>): void {
    if (!this.connections.has(sessionId)) {
      this.connections.set(sessionId, new Set());
    }
    this.connections.get(sessionId)!.add(controller);

    // Deliver any events that fired before the client connected
    this.deliverPendingEvents(sessionId, controller);
  }

  unregisterConnection(sessionId: string, controller: ReadableStreamDefaultController<Uint8Array>): void {
    const set = this.connections.get(sessionId);
    if (set) {
      set.delete(controller);
      if (set.size === 0) {
        this.connections.delete(sessionId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  broadcastEvent(
    sessionId: string,
    type: ChunkedUploadEventType,
    data: ChunkedUploadSSEEvent["data"] = {},
  ): void {
    const event: ChunkedUploadSSEEvent = {
      type,
      sessionId,
      timestamp: getTimeNow(),
      data,
    };

    const connections = this.connections.get(sessionId);

    if (!connections || connections.size === 0) {
      this.storePendingEvent(sessionId, event);
      return;
    }

    const dead: ReadableStreamDefaultController<Uint8Array>[] = [];

    for (const controller of connections) {
      try {
        this.sendEvent(controller, event);
      } catch (_) {
        dead.push(controller);
      }
    }

    for (const d of dead) {
      this.unregisterConnection(sessionId, d);
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private sendEvent(
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: ChunkedUploadSSEEvent,
  ): void {
    const payload = JSON.stringify(event);
    controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
  }

  private storePendingEvent(sessionId: string, event: ChunkedUploadSSEEvent): void {
    if (!this.pendingEvents.has(sessionId)) {
      this.pendingEvents.set(sessionId, []);
    }
    const list = this.pendingEvents.get(sessionId)!;
    list.push(event);

    setTimeout(() => {
      const current = this.pendingEvents.get(sessionId);
      if (current) {
        const idx = current.indexOf(event);
        if (idx !== -1) current.splice(idx, 1);
        if (current.length === 0) this.pendingEvents.delete(sessionId);
      }
    }, this.PENDING_EVENTS_TTL_MS);
  }

  private deliverPendingEvents(
    sessionId: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    const events = this.pendingEvents.get(sessionId);
    if (!events || events.length === 0) return;

    for (const event of events) {
      try {
        this.sendEvent(controller, event);
      } catch (_) {
        break;
      }
    }

    this.pendingEvents.delete(sessionId);
  }
}

// Singleton getter now lives in ./singletons.ts (re-exported from index.ts).

// ---------------------------------------------------------------------------
// Stream factory (called by the route handler)
// ---------------------------------------------------------------------------

/**
 * Create a ReadableStream that delivers SSE events for the given upload session.
 * Automatically sends a heartbeat comment every 30 seconds to keep the
 * connection alive through proxies.
 */
export function createChunkedUploadSSEStream(sessionId: string): ReadableStream<Uint8Array> {
  const sseService = getSSEChunkedUploadService();
  let pingInterval: number | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  return new ReadableStream({
    start(controller) {
      streamController = controller;
      sseService.registerConnection(sessionId, controller);

      pingInterval = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: ping\n\n`));
        } catch (_) {
          if (pingInterval !== undefined) clearInterval(pingInterval);
          if (streamController) sseService.unregisterConnection(sessionId, streamController);
        }
      }, 30_000) as unknown as number;
    },

    cancel() {
      if (pingInterval !== undefined) clearInterval(pingInterval);
      if (streamController) sseService.unregisterConnection(sessionId, streamController);
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience broadcast helper (used by the background worker)
// ---------------------------------------------------------------------------

export function broadcastChunkedUploadEvent(
  sessionId: string,
  type: ChunkedUploadEventType,
  data: ChunkedUploadSSEEvent["data"] = {},
): void {
  getSSEChunkedUploadService().broadcastEvent(sessionId, type, data);
}
