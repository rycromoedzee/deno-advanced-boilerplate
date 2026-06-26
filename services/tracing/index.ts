/**
 * @file services/tracing/index.ts
 * @description Barrel exports for tracing services
 */
/**
 * Distributed Tracing Module
 *
 * Simplified error-focused distributed tracing for automatic error collection
 * with BetterStack integration.
 *
 * Key Features:
 * - Automatic context propagation via AsyncLocalStorage
 * - Hierarchical span tracking with parent-child relationships
 * - Breadcrumb collection for event trails
 * - Automatic error-only collection (no configuration needed)
 * - Integration with existing LogContext and BetterStack logging
 */

// ==========================================
// Service Exports
// ==========================================

export { getTraceContext, TraceContextService } from "./trace-context.service.ts";

export { getSpanCollector } from "./span-collector.ts";

// ==========================================
// Utility Exports
// ==========================================

export { traced, tracedSync } from "./span-utils.ts";

export { createStreamWorkSpan } from "./stream-span.ts";
export type { StreamWorkSpanOptions, StreamWorkSpanTracker } from "./stream-span.ts";
