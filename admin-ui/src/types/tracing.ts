/**
 * Tracing types for the admin UI.
 *
 * Backend-mirrored shapes (Span, CompletedTrace, Breadcrumb, and the enum unions)
 * are aliased to the generated OpenAPI types (`./api.generated.ts`) so the backend
 * contract is the single source of truth and contract drift fails at compile time.
 * UI-only display/construct types (TraceListItem, TraceFilter, TraceDetailView,
 * SpanNode, FilterOptions) remain hand-written.
 */

import type { components } from "./api.generated";

/* ------------------------------------------------------------------ */
/* Enum unions — derived from the generated Span/Breadcrumb schemas.    */
/* ------------------------------------------------------------------ */

/** Span status enumeration (mirrors AdminSpan.status). */
export type SpanStatus = components["schemas"]["AdminSpan"]["status"];

/** Breadcrumb level enumeration (mirrors AdminBreadcrumb.level). */
export type BreadcrumbLevel = components["schemas"]["AdminBreadcrumb"]["level"];

/** Breadcrumb category enumeration (mirrors AdminBreadcrumb.category). */
export type BreadcrumbCategory = components["schemas"]["AdminBreadcrumb"]["category"];

/**
 * Operation type enumeration for spans (mirrors AdminSpan.operationType).
 * NOTE: the backend also emits `"background"` spans; the generated union
 * includes it (the prior hand-written union did not).
 */
export type OperationType = components["schemas"]["AdminSpan"]["operationType"];

/* ------------------------------------------------------------------ */
/* Entity shapes — aliased to generated schemas.                        */
/* ------------------------------------------------------------------ */

/** Span event — an annotation within a span (mirrors AdminSpanEvent). */
export type SpanEvent = components["schemas"]["AdminSpanEvent"];

/** Error information captured in a span (mirrors AdminSpanError). */
export type SpanError = components["schemas"]["AdminSpanError"];

/** A single operation within a trace (mirrors AdminSpan). */
export type Span = components["schemas"]["AdminSpan"];

/** Lightweight event marker without duration (mirrors AdminBreadcrumb). */
export type Breadcrumb = components["schemas"]["AdminBreadcrumb"];

/**
 * Completed trace with all collected spans (mirrors AdminCompletedTrace).
 * This is the projected shape returned by the trace SEARCH endpoint and built
 * from the raw `AdminTraceDetail` row by tracing.service.ts → getTraceById().
 */
export type CompletedTrace = components["schemas"]["AdminCompletedTrace"];

/* ------------------------------------------------------------------ */
/* UI-only types (no backend mirror).                                   */
/* ------------------------------------------------------------------ */

/**
 * Trace list item for display in the trace list. Derived from a CompletedTrace
 * by the UI (TracingVisualizer.transformToListItem); not a backend shape.
 */
export interface TraceListItem {
  traceId: string;
  timestamp: string;
  sortableTimestamp: number;
  status: "error" | "warning" | "success";
  operationName: string;
  duration: number;
  spanCount: number;
  errorCount: number;
  userId?: string;
  ipAddress?: string;
  httpMethod?: string;
  httpPath?: string;
  httpStatusCode?: number;
  tags: string[];
}

/** Filter state for trace filtering. */
export interface TraceFilter {
  searchQuery: string;
  userIdFilter: string;
  errorStatus: "all" | "errors" | "warnings";
  operationTypes: OperationType[];
  durationThreshold: number;
  startDate: string;
  endDate: string;
}

/** Trace detail view with organized data (UI construct). */
export interface TraceDetailView {
  trace: CompletedTrace;
  overview: {
    duration: number;
    errorCount: number;
    spanCount: number;
    breadcrumbCount: number;
    userId?: string;
    httpMethod?: string;
    httpPath?: string;
    httpStatusCode?: number;
    startTime: string;
    endTime: string;
  };
  spanHierarchy: SpanNode[];
  breadcrumbs: Breadcrumb[];
}

/** Span node with children for hierarchical display (UI construct). */
export interface SpanNode {
  span: Span;
  children: SpanNode[];
  level: number;
}

/** Filter options for the UI. */
export interface FilterOptions {
  operationTypes: {
    value: OperationType;
    label: string;
  }[];
  errorStatusOptions: {
    value: "all" | "errors" | "warnings";
    label: string;
  }[];
}
