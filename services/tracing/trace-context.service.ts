/**
 * @file services/tracing/trace-context.service.ts
 * @description Trace Context service (tracing)
 */
import { AsyncLocalStorage, bytesToHex, randomBytes } from "@deps";
import type { Breadcrumb, BreadcrumbCategory, OperationType, Span, TraceContext } from "@interfaces/tracing.ts";

/**
 * Per-async-chain storage for the currently active span ID.
 * Isolated via asyncLocalStorage.run(), so concurrent spans (e.g. Promise.all)
 * each see their own parent rather than sharing a mutable stack.
 */
const activeSpanStorage = new AsyncLocalStorage<string>();
import type { LogContext } from "@interfaces/context.ts";
import { getSpanCollector } from "./span-collector.ts";

/**
 * The global AsyncLocalStorage instance for trace context
 */
const traceStorage = new AsyncLocalStorage<TraceContext>();

/**
 * TraceContextService
 *
 * Simplified error-focused tracing service. Manages trace context, spans, and breadcrumbs
 * using AsyncLocalStorage for automatic context propagation across async operations.
 *
 * Key Features:
 * - Automatic context propagation via AsyncLocalStorage
 * - Hierarchical span tracking with parent-child relationships
 * - Breadcrumb collection for event trails
 * - Error-only storage (only sends traces with errors to BetterStack)
 * - Integration with existing LogContext
 *
 * @example
 * ```typescript
 * const traceService = getTraceContext();
 * const context = traceService.initializeTrace(logContext);
 *
 * await traceService.run(context, async () => {
 *   const span = traceService.startSpan('operation', 'service');
 *   try {
 *     // ... operation code
 *     span.status = 'ok';
 *   } finally {
 *     await traceService.finishSpan(span);
 *   }
 * });
 * ```
 */
export class TraceContextService {
  private static instance: TraceContextService;

  static getInstance(): TraceContextService {
    if (!TraceContextService.instance) {
      TraceContextService.instance = new TraceContextService();
    }
    return TraceContextService.instance;
  }

  /**
   * Generate a unique trace ID (16 bytes = 32 hex chars)
   * Compatible with W3C Trace Context format
   */
  generateTraceId(): string {
    return bytesToHex(randomBytes(16));
  }

  /**
   * Generate a unique span ID (8 bytes = 16 hex chars)
   * Compatible with W3C Trace Context format
   */
  generateSpanId(): string {
    return bytesToHex(randomBytes(8));
  }

  /**
   * Initialize trace context for a new request
   * Extends existing LogContext with tracing fields
   *
   * @param logContext - The existing log context from the request
   * @returns Complete trace context with tracing fields
   */
  initializeTrace(logContext: LogContext): TraceContext {
    const traceId = this.generateTraceId();
    const rootSpanId = this.generateSpanId();

    const context: TraceContext = {
      correlationId: logContext.correlationId,
      requestId: logContext.requestId,
      userId: logContext.userId,
      ipAddress: logContext.ipAddress,
      userAgent: logContext.userAgent,
      sessionId: logContext.sessionId,
      parentCorrelationId: logContext.parentCorrelationId,
      instanceId: logContext.instanceId,

      traceId,
      rootSpanId,
      activeSpanStack: [],
      breadcrumbs: [],
      traceStartTime: performance.now(),
      hasError: false,
      errorCount: 0,
    };

    return context;
  }

  /**
   * Get current trace context from AsyncLocalStorage
   *
   * @returns Current trace context or undefined if not in a traced context
   */
  getContext(): TraceContext | undefined {
    return traceStorage.getStore();
  }

  /**
   * Run code within trace context
   * Wraps the callback in AsyncLocalStorage context
   *
   * @param context - The trace context to run with
   * @param callback - The function to execute within the context
   * @returns The result of the callback
   */
  run<T>(
    context: TraceContext,
    callback: () => T | Promise<T>,
  ): T | Promise<T> {
    return traceStorage.run(context, callback);
  }

  /**
   * Run code with the given span as the active parent for any child spans.
   * Uses AsyncLocalStorage so concurrent spans (Promise.all) each inherit the
   * correct parent instead of accidentally inheriting a sibling's span.
   */
  runWithSpan<T>(
    span: Span,
    callback: () => T | Promise<T>,
  ): T | Promise<T> {
    return activeSpanStorage.run(span.spanId, callback);
  }

  /**
   * Start a new span
   * Creates a span with proper parent-child relationship based on active span stack
   *
   * @param name - Human-readable name for the span (e.g., 'db.query.users')
   * @param operationType - Type of operation ('http', 'db', 'cache', 'service', 'handler')
   * @param attributes - Optional attributes to attach to the span
   * @returns The created span
   */
  startSpan(
    name: string,
    operationType: OperationType,
    attributes: Record<string, unknown> = {},
    customStartTime?: number, // Optional: use trace start time for root span
  ): Span {
    const context = this.getContext();
    if (!context) {
      // Return no-op span if not in traced context
      return this.createNoOpSpan(name);
    }

    // Get parent from per-chain storage (isolated per async context, not a shared stack)
    const parentSpanId = activeSpanStorage.getStore() ?? null;

    // Use custom startTime if provided (for root span), otherwise current time
    const startTime = customStartTime !== undefined ? customStartTime : performance.now();

    const span: Span = {
      spanId: this.generateSpanId(),
      traceId: context.traceId,
      parentSpanId,
      name,
      operationType,
      startTime,
      attributes,
      status: "unset",
      events: [],
    };

    // Add to active span stack
    context.activeSpanStack.push(span.spanId);

    return span;
  }

  /**
   * Finish a span
   * Calculates duration and removes from active span stack
   *
   * @param span - The span to finish
   */
  finishSpan(span: Span): void {
    const context = this.getContext();
    if (!context) return;

    span.endTime = performance.now();
    span.duration = span.endTime - span.startTime;

    // Remove from active span stack
    const index = context.activeSpanStack.indexOf(span.spanId);
    if (index > -1) {
      context.activeSpanStack.splice(index, 1);
    }

    // Collect span in memory
    const collector = getSpanCollector();
    collector.collectSpan(span);
  }

  /**
   * Add a breadcrumb to the current trace
   * Breadcrumbs are lightweight event markers without duration tracking
   *
   * @param category - Category of the breadcrumb ('http', 'auth', 'db', 'cache', 'navigation')
   * @param message - Descriptive message for the event
   * @param level - Severity level ('debug', 'info', 'warning', 'error')
   * @param data - Optional additional data
   */
  addBreadcrumb(
    category: BreadcrumbCategory,
    message: string,
    level: "debug" | "info" | "warning" | "error",
    data?: Record<string, unknown>,
  ): void {
    const context = this.getContext();
    if (!context) return;

    const breadcrumb: Breadcrumb = {
      timestamp: performance.now() - context.traceStartTime,
      category,
      message,
      level,
      data,
    };

    context.breadcrumbs.push(breadcrumb);
  }

  /**
   * Record an exception in the current trace
   * Marks the trace as having an error
   *
   * @param error - The error that occurred
   */
  recordException(error: Error | unknown): void {
    const context = this.getContext();
    if (!context) return;

    context.hasError = true;
    context.errorCount++;

    // Add error breadcrumb
    this.addBreadcrumb(
      "error",
      error instanceof Error ? error.message : String(error),
      "error",
      {
        name: error instanceof Error ? error.name : "UnknownError",
        stack: error instanceof Error && error.stack ? error.stack.split("\n").slice(0, 5).join("\n") : undefined,
      },
    );
  }

  /**
   * Get the current trace ID
   *
   * @returns The trace ID or empty string if not in a traced context
   */
  getTraceId(): string {
    const context = this.getContext();
    return context?.traceId || "";
  }

  /**
   * Get all collected spans for the current trace
   * Used for error logging to send complete trace to BetterStack
   *
   * @returns Array of collected spans for current trace
   */
  getCollectedSpans(): Span[] {
    const context = this.getContext();
    if (!context) return [];

    const collector = getSpanCollector();
    return collector.getCollectedSpans(context.traceId);
  }

  /**
   * Flush spans for the current trace
   * Only sends to BetterStack if trace has errors (automatic error-only filtering)
   *
   * @param context - The trace context to flush
   */
  async flushSpans(context: TraceContext): Promise<void> {
    const collector = getSpanCollector();
    await collector.flushTrace(context);
  }

  /**
   * Create a no-op span for when not in traced context
   *
   * @private
   * @param name - The span name
   * @returns A no-op span that does nothing
   */
  private createNoOpSpan(name: string): Span {
    return {
      spanId: "",
      traceId: "",
      parentSpanId: null,
      name,
      operationType: "noop",
      startTime: 0,
      attributes: {},
      status: "unset",
      events: [],
    };
  }
}

/**
 * Get the singleton TraceContextService instance
 *
 * @returns The TraceContextService instance
 */
export function getTraceContext(): TraceContextService {
  return TraceContextService.getInstance();
}
