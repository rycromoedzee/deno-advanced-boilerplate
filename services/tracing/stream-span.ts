/**
 * @file services/tracing/stream-span.ts
 * @description Work-time tracing for lazy/streaming responses (tracing)
 */
/**
 * Stream Work Span
 *
 * Records how long the server actually spent *producing* a streaming response
 * body (e.g. decrypting file chunks), as opposed to how long the client took
 * to download it.
 *
 * Why this exists:
 * - The request tracing middleware finishes the root span and flushes the
 *   trace as soon as the handler returns the `Response` (i.e. when the
 *   `ReadableStream` is *created*). For lazy, pull-based streams the body is
 *   produced *after* that point, so the work never lands in the trace.
 * - The work is also interleaved with client back-pressure: a slow download
 *   does not mean slow decryption. Measuring at the response boundary would
 *   under-count (the source pre-decrypts during idle windows).
 *
 * Approach:
 * - Wrap the underlying stream `controller` and time only the work done inside
 *   each `pull()` invocation (storage reads + worker decryption). Time spent
 *   idle waiting for the consumer to drain is naturally excluded because
 *   `pull()` is not called while the source is back-pressured.
 * - On stream close/error/cancel, emit a "late" span and persist it onto the
 *   already-flushed trace row (see {@link SpanCollector.persistLateSpan}).
 *
 * The tracker is a no-op when created outside a traced request context.
 */

import type { OperationType, Span } from "@interfaces/tracing.ts";
import { getTraceContext } from "./trace-context.service.ts";
import { getSpanCollector } from "./span-collector.ts";

/**
 * Controller type produced/consumed by the work-timing wrapper.
 */
type StreamController = ReadableStreamDefaultController<Uint8Array>;

/**
 * Options for {@link createStreamWorkSpan}.
 */
export interface StreamWorkSpanOptions {
  /** Human-readable span name (e.g. `decrypt.stream`). */
  name: string;

  /** Span operation type (defaults to `encryption`). */
  operationType?: OperationType;

  /** Optional initial span attributes (never secrets/PII). */
  attributes?: Record<string, unknown>;
}

/**
 * Tracker returned by {@link createStreamWorkSpan}.
 */
export interface StreamWorkSpanTracker {
  /**
   * Wrap the real stream controller so that enqueued bytes are counted and
   * `close()` / `error()` finalize the span automatically.
   */
  wrapController(controller: StreamController): StreamController;

  /**
   * Mark the beginning of a `pull()` invocation. Returns a function that MUST
   * be called (e.g. in a `finally`) once the pull body settles, to accumulate
   * the elapsed work time.
   */
  beginWork(): () => void;

  /**
   * Finalize and persist the span. Idempotent. Normally triggered via the
   * wrapped controller's `close()`/`error()`; call directly from `cancel()`.
   */
  finalize(status?: "ok" | "error", error?: unknown, aborted?: boolean): void;
}

/** Round to 2 decimal places to match the existing trace formatting. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Create a work-time tracker for a lazy/streaming response body.
 *
 * @param options - Span naming and attributes.
 * @returns A {@link StreamWorkSpanTracker}; a no-op tracker when not inside a
 *   traced request.
 */
export function createStreamWorkSpan(options: StreamWorkSpanOptions): StreamWorkSpanTracker {
  const traceService = getTraceContext();
  const context = traceService.getContext();

  // Not inside a traced request (e.g. background job) — return a no-op tracker
  // so callers don't need to branch.
  if (!context) {
    return {
      wrapController: (controller) => controller,
      beginWork: () => () => {},
      finalize: () => {},
    };
  }

  const traceId = context.traceId;

  const span: Span = {
    spanId: traceService.generateSpanId(),
    traceId,
    // Attach to the root HTTP span so it renders as a top-level child in the
    // AdminUI timeline.
    parentSpanId: context.rootSpanId,
    name: options.name,
    operationType: options.operationType ?? "encryption",
    startTime: performance.now(),
    attributes: { ...(options.attributes ?? {}) },
    status: "unset",
    events: [],
  };

  let workMs = 0;
  let bytesProduced = 0;
  let chunkCount = 0;
  let finalized = false;

  // When the underlying source closes/errors from *inside* a pull() (e.g. the
  // single-chunk / final-chunk path), we must not finalize until that pull's
  // elapsed work has been added to workMs. So we defer finalization here and
  // flush it once the pull settles (see beginWork's returned callback).
  let pendingFinalize: { status: "ok" | "error"; error?: unknown } | null = null;

  const finalize = (status: "ok" | "error" = "ok", error?: unknown, aborted?: boolean): void => {
    if (finalized) return;
    finalized = true;

    span.endTime = performance.now();
    span.duration = round2(workMs);
    span.status = status;
    span.attributes["work_ms"] = round2(workMs);
    span.attributes["wall_clock_ms"] = round2(span.endTime - span.startTime);
    span.attributes["bytes_produced"] = bytesProduced;
    span.attributes["chunks"] = chunkCount;
    if (aborted) {
      span.attributes["aborted"] = true;
    }
    if (error) {
      span.error = {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
    }

    // Skip persisting streams that were created but never produced anything
    // (e.g. cancelled before the first pull) to avoid timeline noise.
    if (bytesProduced === 0 && chunkCount === 0 && status !== "error") {
      return;
    }

    // Fire-and-forget: tracing must never break or delay request streaming.
    void getSpanCollector().persistLateSpan(traceId, span);
  };

  const beginWork = (): () => void => {
    const start = performance.now();
    return () => {
      workMs += performance.now() - start;
      // Flush any close()/error() that happened during this pull, now that its
      // work time is accounted for.
      if (pendingFinalize) {
        const { status, error } = pendingFinalize;
        pendingFinalize = null;
        finalize(status, error);
      }
    };
  };

  const wrapController = (controller: StreamController): StreamController => {
    const wrapped: StreamController = {
      get desiredSize() {
        return controller.desiredSize;
      },
      enqueue: (chunk?: Uint8Array) => {
        if (chunk) {
          bytesProduced += chunk.byteLength;
          chunkCount++;
        }
        controller.enqueue(chunk);
      },
      close: () => {
        // Defer finalize until the current pull's work is recorded.
        if (!pendingFinalize) pendingFinalize = { status: "ok" };
        controller.close();
      },
      error: (reason?: unknown) => {
        if (!pendingFinalize) pendingFinalize = { status: "error", error: reason };
        controller.error(reason);
      },
    };
    return wrapped;
  };

  return { wrapController, beginWork, finalize };
}
