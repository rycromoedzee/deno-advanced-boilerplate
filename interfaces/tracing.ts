/**
 * @file interfaces/tracing.ts
 * @description Tracing-related interface definitions
 */
/**
 * Distributed Tracing System - Type Definitions
 *
 * Simplified error-tracing focused type definitions.
 * Automatic error collection with BetterStack integration.
 */

// Import LogContext from shared location to avoid circular dependencies
import type { LogContext } from "@interfaces/context.ts";

/**
 * Span status enumeration
 */
export type SpanStatus = "ok" | "error" | "unset";

/**
 * Breadcrumb level enumeration
 */
export type BreadcrumbLevel = "debug" | "info" | "warning" | "error";

/**
 * Breadcrumb category enumeration
 */
export type BreadcrumbCategory =
  | "http"
  | "auth"
  | "db"
  | "cache"
  | "service"
  | "handler"
  | "navigation"
  | "user-action"
  | "error";

/**
 * Operation type enumeration for spans
 */
export type OperationType =
  | "http.server"
  | "http.client"
  | "db.query"
  | "db.transaction"
  | "cache.get"
  | "cache.set"
  | "cache.delete"
  | "service"
  | "handler"
  | "auth"
  | "encryption"
  | "storage"
  | "background"
  | "noop";

/**
 * Span event - represents an annotation within a span
 */
export interface SpanEvent {
  /** Timestamp when event occurred (performance.now()) */
  timestamp: number;

  /** Event name/description */
  name: string;

  /** Optional event attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Error information captured in a span
 */
export interface SpanError {
  /** Error name/type */
  name: string;

  /** Error message */
  message: string;

  /** Optional stack trace */
  stack?: string;
}

/**
 * Span interface - represents a single operation within a trace
 */
export interface Span {
  /** Unique identifier for this span */
  spanId: string;

  /** Trace ID this span belongs to */
  traceId: string;

  /** Parent span ID (null for root span) */
  parentSpanId: string | null;

  /** Human-readable name of the operation */
  name: string;

  /** Type of operation being performed */
  operationType: OperationType;

  /** Start time in milliseconds (performance.now()) */
  startTime: number;

  /** End time in milliseconds (performance.now()) */
  endTime?: number;

  /** Duration in milliseconds */
  duration?: number;

  /** Attributes/metadata about the span */
  attributes: Record<string, unknown>;

  /** Current status of the span */
  status: SpanStatus;

  /** Error information if span failed */
  error?: SpanError;

  /** Events that occurred during span execution */
  events: SpanEvent[];
}

/**
 * Breadcrumb - lightweight event marker without duration
 */
export interface Breadcrumb {
  /** Timestamp when breadcrumb was recorded (performance.now()) */
  timestamp: number;

  /** Category of the breadcrumb */
  category: BreadcrumbCategory;

  /** Human-readable message */
  message: string;

  /** Severity level */
  level: BreadcrumbLevel;

  /** Optional additional data */
  data?: Record<string, unknown>;
}

/**
 * TraceContext - extends LogContext with tracing fields
 *
 * This is the main context object that flows through the entire request
 * using AsyncLocalStorage. It contains all tracing information.
 */
export interface TraceContext extends LogContext {
  // Inherited from LogContext
  correlationId?: string;
  requestId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  parentCorrelationId?: string;
  instanceId?: string;

  // Tracing-specific fields

  /** Unique identifier for the entire trace */
  traceId: string;

  /** ID of the root span for this trace */
  rootSpanId: string;

  /** Stack of currently active span IDs (for parent-child relationships) */
  activeSpanStack: string[];

  /** Collection of breadcrumbs recorded during trace */
  breadcrumbs: Breadcrumb[];

  /** When the trace started (performance.now()) */
  traceStartTime: number;

  /** Whether an error occurred during this trace */
  hasError: boolean;

  /** Count of errors that occurred during trace */
  errorCount: number;

  // Threat Intelligence fields

  /** Whether this request came from a known threat IP (from threat intelligence lists) */
  isKnownThreatIP?: boolean;

  /** Category of threat if isKnownThreatIP is true (e.g., 'malicious', 'suspicious', 'spam') */
  threatCategory?: string;

  /** Whether this request came from an anonymizer network like Tor or VPN */
  isAnonymizer?: boolean;

  /** Whether this request came from datacenter/cloud infrastructure */
  isInfrastructure?: boolean;
}

/**
 * Completed trace with all collected spans
 */
export interface CompletedTrace {
  /** Unique trace identifier */
  traceId: string;

  /** Root span ID */
  rootSpanId: string;

  /** Start time (Unix timestamp) */
  startTime: number;

  /** End time (Unix timestamp) */
  endTime: number;

  /** Total duration in milliseconds */
  duration: number;

  /** Overall trace status */
  status: "ok" | "error";

  /** Request context */
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  httpMethod?: string;
  httpPath?: string;
  httpStatusCode?: number;

  /** All spans collected during trace */
  spans: Span[];

  /** All breadcrumbs collected during trace */
  breadcrumbs: Breadcrumb[];

  /** Number of errors in trace */
  errorCount: number;

  /** Number of spans in trace */
  spanCount: number;

  /** Tags for indexing/filtering */
  tags: string[];
}

/**
 * Formatted span event for BetterStack
 */
export interface FormattedSpanEvent {
  /** Timestamp when event occurred */
  timestamp: number;

  /** Event name/description */
  name: string;

  /** Optional event attributes (sanitized) */
  attributes?: Record<string, unknown>;
}

/**
 * Formatted span error for BetterStack
 */
export interface FormattedSpanError {
  /** Error name/type */
  name: string;

  /** Error message */
  message: string;

  /** Optional stack trace */
  stack?: string;
}

/**
 * Formatted span for BetterStack
 */
export interface FormattedSpan {
  /** Unique identifier for this span */
  spanId: string;

  /** Trace ID this span belongs to */
  traceId: string;

  /** Parent span ID */
  parentSpanId: string | null;

  /** Human-readable name of the operation */
  name: string;

  /** Type of operation being performed */
  operationType: OperationType;

  /** Start time in milliseconds */
  startTime: number;

  /** End time in milliseconds */
  endTime?: number;

  /** Duration in milliseconds (rounded) */
  duration?: number;

  /** Current status of the span */
  status: SpanStatus;

  /** Sanitized attributes/metadata about the span */
  attributes: Record<string, unknown>;

  /** Error information if span failed */
  error?: FormattedSpanError;

  /** Events that occurred during span execution */
  events: FormattedSpanEvent[];

  /** Number of events in this span */
  eventCount: number;
}

/**
 * Formatted breadcrumb for BetterStack
 */
export interface FormattedBreadcrumb {
  /** Timestamp when breadcrumb was recorded */
  timestamp: number;

  /** Category of the breadcrumb */
  category: BreadcrumbCategory;

  /** Human-readable message */
  message: string;

  /** Severity level */
  level: BreadcrumbLevel;

  /** Optional additional data (sanitized) */
  data?: Record<string, unknown>;
}

/**
 * Complete formatted trace data for BetterStack
 */
export interface FormattedTraceData {
  /** Unique trace identifier */
  traceId: string;

  /** Root span ID */
  rootSpanId: string;

  /** Total duration in milliseconds (rounded) */
  duration: number;

  /** Whether an error occurred during this trace */
  hasError: boolean;

  /** Count of errors that occurred during trace */
  errorCount: number;

  /** Number of spans in trace */
  spanCount: number;

  /** Number of breadcrumbs in trace */
  breadcrumbCount: number;

  /** User ID */
  userId?: string;

  /** Correlation ID */
  correlationId?: string;

  /** Request ID */
  requestId?: string;

  /** Session ID */
  sessionId?: string;

  /** IP address */
  ipAddress?: string;

  /** User agent string */
  userAgent?: string;

  /** Complete span tree with all timing and attributes (sorted chronologically) */
  spans: FormattedSpan[];

  /** Complete breadcrumb trail showing what led to error */
  breadcrumbs: FormattedBreadcrumb[];

  /** Active operation stack at time of completion */
  activeSpans: string[];

  /** When the trace started (performance.now()) */
  traceStartTime: number;
}
