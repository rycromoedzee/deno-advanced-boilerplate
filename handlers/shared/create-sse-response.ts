/**
 * @file handlers/shared/create-sse-response.ts
 * @description Generic helper for creating SSE responses
 */

import type { SSEResponseOptions } from "@services/shared/sse.types.ts";

/**
 * Create a generic SSE response with proper headers and heartbeat
 */
export function createSSEResponse<TFilters>(options: SSEResponseOptions<TFilters>): Response {
  const { service, userId, environmentId, filters, heartbeatIntervalMs = 30000 } = options;
  let connectionId: string | undefined;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      try {
        connectionId = service.registerConnection(controller, userId, environmentId, filters);
        heartbeatInterval = setInterval(() => {
          if (connectionId) {
            service.sendHeartbeat(connectionId);
          }
        }, heartbeatIntervalMs);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      if (heartbeatInterval !== undefined) {
        clearInterval(heartbeatInterval);
      }
      if (connectionId) {
        service.unregisterConnection(connectionId);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
