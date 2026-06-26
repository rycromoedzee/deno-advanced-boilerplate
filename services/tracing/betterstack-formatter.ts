/**
 * @file services/tracing/betterstack-formatter.ts
 * @description Betterstack Formatter service module (tracing)
 */
/**
 * BetterStack Formatter
 *
 * Converts trace data into BetterStack-compatible format for logging.
 * Ensures all trace information (spans, breadcrumbs, error context) is
 * properly serialized and structured for BetterStack ingestion.
 */

import type {
  Breadcrumb,
  FormattedBreadcrumb,
  FormattedSpan,
  FormattedSpanEvent,
  FormattedTraceData,
  Span,
  SpanEvent,
  TraceContext,
} from "@interfaces/tracing.ts";

/**
 * Format complete trace context for BetterStack logging
 *
 * @param context - The trace context to format
 * @param spans - All collected spans for this trace
 * @returns BetterStack-compatible trace object with proper typing
 */
export function formatTraceForBetterStack(
  context: TraceContext,
  spans: Span[],
): FormattedTraceData {
  const duration = performance.now() - context.traceStartTime;

  return {
    traceId: context.traceId,
    rootSpanId: context.rootSpanId,
    duration: Math.round(duration * 100) / 100, // Round to 2 decimal places
    hasError: context.hasError,
    errorCount: context.errorCount,
    spanCount: spans.length,
    breadcrumbCount: context.breadcrumbs.length,

    // User and request context
    userId: context.userId,
    correlationId: context.correlationId,
    requestId: context.requestId,
    sessionId: context.sessionId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,

    // Complete span tree with all timing and attributes (sorted chronologically)
    // Use index as tiebreaker to preserve insertion order when startTime is equal
    spans: spans
      .map((span, index) => ({ span, index }))
      .sort((a, b) => a.span.startTime - b.span.startTime || a.index - b.index)
      .map(({ span }) => formatSpan(span)),

    // Complete breadcrumb trail showing what led to error
    breadcrumbs: context.breadcrumbs.map(formatBreadcrumb),

    // Active operation stack at time of completion
    activeSpans: context.activeSpanStack,

    // Metadata
    traceStartTime: context.traceStartTime,
  };
}

/**
 * Format individual span for BetterStack
 *
 * @param span - The span to format
 * @returns Formatted span object with proper typing
 */
export function formatSpan(span: Span): FormattedSpan {
  return {
    spanId: span.spanId,
    traceId: span.traceId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    operationType: span.operationType,
    startTime: span.startTime,
    endTime: span.endTime,
    duration: span.duration ? Math.round(span.duration * 100) / 100 : undefined,
    status: span.status,
    attributes: sanitizeAttributes(span.attributes),
    error: span.error
      ? {
        name: span.error.name,
        message: span.error.message,
        stack: span.error.stack,
      }
      : undefined,
    events: span.events.map(formatSpanEvent),
    eventCount: span.events.length,
  };
}

/**
 * Format span event for BetterStack
 *
 * @param event - The span event to format
 * @returns Formatted event object with proper typing
 */
function formatSpanEvent(event: SpanEvent): FormattedSpanEvent {
  return {
    timestamp: event.timestamp,
    name: event.name,
    attributes: event.attributes ? sanitizeAttributes(event.attributes) : undefined,
  };
}

/**
 * Format breadcrumb for BetterStack
 *
 * @param breadcrumb - The breadcrumb to format
 * @returns Formatted breadcrumb object with proper typing
 */
export function formatBreadcrumb(breadcrumb: Breadcrumb): FormattedBreadcrumb {
  return {
    timestamp: breadcrumb.timestamp,
    category: breadcrumb.category,
    message: breadcrumb.message,
    level: breadcrumb.level,
    data: breadcrumb.data ? sanitizeAttributes(breadcrumb.data) : undefined,
  };
}

/**
 * Sanitize a single value for JSON serialization
 * Handles circular references, functions, and other non-serializable types
 *
 * @param value - The value to sanitize
 * @returns Sanitized value
 */
function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const type = typeof value;

  switch (type) {
    case "function":
      return "[Function]";
    case "symbol":
      return value.toString();
    case "bigint":
      return value.toString();
    case "object":
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      // Test if object is serializable
      try {
        JSON.stringify(value);
        return value;
      } catch {
        return "[Object]";
      }
    default:
      return value;
  }
}

/**
 * Sanitize attributes to ensure they're serializable
 * Handles circular references, functions, and other non-serializable types
 *
 * @param attributes - Attributes to sanitize
 * @returns Sanitized attributes
 */
function sanitizeAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attributes)) {
    try {
      sanitized[key] = sanitizeValue(value);
    } catch {
      sanitized[key] = "[Error serializing value]";
    }
  }

  return sanitized;
}
