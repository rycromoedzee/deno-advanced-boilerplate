/**
 * @file services/shared/sse.types.ts
 * @description Shared types for SSE (Server-Sent Events) infrastructure
 */

/**
 * Represents an SSE connection with optional filters
 */
export interface SSEConnection<TFilters = unknown> {
  controller: ReadableStreamDefaultController<Uint8Array>;
  userId: string;
  environmentId: string;
  filters?: TFilters;
}

/**
 * Represents an SSE event payload
 */
export interface SSEEvent<TData = unknown> {
  data: TData;
  userId: string;
  environmentId: string;
}

/**
 * Options for creating an SSE response
 */
export interface SSEResponseOptions<TFilters> {
  service: {
    registerConnection: (
      controller: ReadableStreamDefaultController<Uint8Array>,
      userId: string,
      environmentId: string,
      filters?: TFilters,
    ) => string;
    unregisterConnection: (connectionId: string) => void;
    sendHeartbeat: (connectionId: string) => void;
  };
  userId: string;
  environmentId: string;
  filters?: TFilters;
  heartbeatIntervalMs?: number;
}
