/**
 * @file services/tracing/span-collector.ts
 * @description Span Collector service module (tracing)
 */
/**
 * Span Collector Service
 *
 * In-memory span collector for request-scoped trace collection.
 * Collects spans during request lifecycle and flushes at completion.
 *
 * Features:
 * - In-memory storage (no Deno KV needed - simpler and faster)
 * - Request-scoped (spans collected during request, flushed immediately)
 * - Automatic error-only collection (no configuration needed)
 * - Hybrid storage: BetterStack (alerts) + PostgreSQL (audit)
 * - Serverless-compatible (no timers, flushes before response)
 */

import type { FormattedSpan, FormattedTraceData, Span, TraceContext } from "@interfaces/tracing.ts";
import { formatSpan, formatTraceForBetterStack } from "./betterstack-formatter.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { envConfig } from "@config/env.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";
import { eq } from "@deps";

/** Max attempts to find the (fire-and-forget) trace row before giving up. */
const LATE_SPAN_MAX_ATTEMPTS = 6;

/** Delay between attempts to find the trace row (ms). */
const LATE_SPAN_RETRY_DELAY_MS = 150;

/**
 * SpanCollector options
 */
export interface SpanCollectorOptions {
  /** Retention period for database traces in days (default: 30 days) */
  dbRetentionDays?: number;
}

/**
 * Collector statistics
 */
export interface CollectorStats {
  /** Total number of active traces */
  totalTraces: number;

  /** Total number of spans collected */
  totalSpans: number;

  /** Number of traces with errors */
  errorTraces: number;

  /** Average spans per trace */
  averageSpansPerTrace: number;
}

/**
 * SpanCollector - In-memory span collector
 *
 * Collects spans in memory during request lifecycle.
 * No persistence needed since we flush immediately before response.
 *
 * Serverless-compatible:
 * - Request-scoped in-memory storage
 * - Immediate flush before response
 * - No timers or background processes
 */
export class SpanCollector {
  private static instance: SpanCollector;

  // In-memory storage: Map<traceId, Span[]>
  private spans: Map<string, Span[]> = new Map();

  private dbRetentionDays: number;

  private constructor(options: SpanCollectorOptions = {}) {
    this.dbRetentionDays = options.dbRetentionDays || 30; // 30 days default retention
  }

  static getInstance(options?: SpanCollectorOptions): SpanCollector {
    if (!SpanCollector.instance) {
      SpanCollector.instance = new SpanCollector(options);
    }
    return SpanCollector.instance;
  }

  /**
   * Collect a span for a trace
   * Stores span in memory
   *
   * @param span - The span to collect
   */
  collectSpan(span: Span): void {
    const existingSpans = this.spans.get(span.traceId) || [];
    existingSpans.push(span);
    this.spans.set(span.traceId, existingSpans);
  }

  /**
   * Get all collected spans for a trace
   *
   * @param traceId - The trace ID
   * @returns Array of collected spans
   */
  getCollectedSpans(traceId: string): Span[] {
    return this.spans.get(traceId) || [];
  }

  /**
   * Persist a span that finished AFTER the trace was already flushed.
   *
   * Streaming responses (e.g. media-stream / file downloads) keep producing
   * their body long after the request handler returns and the trace row has
   * been written. This appends such a "late" span onto the existing trace row
   * so it appears in the AdminUI timeline, and folds its work time into the
   * persisted trace duration.
   *
   * The initial trace save (`saveTraceToDatabase`) is fire-and-forget, so for
   * very short streams the row may not exist yet — we retry briefly before
   * giving up. Failures are swallowed: tracing must never break streaming.
   *
   * @param traceId - The trace the late span belongs to.
   * @param span - The completed late span.
   */
  async persistLateSpan(traceId: string, span: Span): Promise<void> {
    try {
      const db = getGlobalDB();
      const formatted = formatSpan(span);
      const addedDuration = formatted.duration ?? 0;

      for (let attempt = 0; attempt < LATE_SPAN_MAX_ATTEMPTS; attempt++) {
        const [row] = await db
          .select()
          .from(globalTables.traceLogs)
          .where(eq(globalTables.traceLogs.traceId, traceId))
          .limit(1);

        if (row) {
          const traceData = (row.traceData ?? {}) as FormattedTraceData;
          const spans: FormattedSpan[] = Array.isArray(traceData.spans) ? traceData.spans : [];
          spans.push(formatted);

          traceData.spans = spans;
          traceData.spanCount = spans.length;
          traceData.duration = Math.round(((traceData.duration ?? 0) + addedDuration) * 100) / 100;

          await db
            .update(globalTables.traceLogs)
            .set({
              traceData,
              spanCount: spans.length,
              duration: Math.round((row.duration ?? 0) + addedDuration),
            })
            .where(eq(globalTables.traceLogs.traceId, traceId));
          return;
        }

        // Row not written yet (initial save is async) — wait and retry.
        await new Promise((resolve) => setTimeout(resolve, LATE_SPAN_RETRY_DELAY_MS));
      }
    } catch {
      // Silent failure - no logging to avoid circular dependency
    }
  }

  /**
   * Send trace data directly to BetterStack
   * No logging here to avoid circular dependencies
   *
   * Downgrades log level from "error" to "info" for known threat IPs.
   * This reduces alert fatigue when bots/malicious IPs trigger errors.
   *
   * @private
   * @param traceData - Formatted trace data with proper typing
   * @param context - The trace context (needed for threat IP check)
   */
  private async sendToBetterStack(traceData: FormattedTraceData, context: TraceContext): Promise<void> {
    if (!envConfig.isProduction || !envConfig.logger.key) {
      return;
    }
    try {
      // Downgrade log level for known threat IPs to reduce alert fatigue
      // Bots hitting endpoints and triggering errors is expected behavior
      const level = context.isKnownThreatIP ? "info" : "error";
      const prefix = context.isKnownThreatIP ? "[Threat IP] " : "";

      const logEntry = {
        dt: new Date().toISOString(),
        level,
        message: `${prefix}Trace completed with error on endpoint ${
          traceData.spans.find((s) => s.parentSpanId === null)?.name ?? traceData.spans[0].name
        }`,
        trace: traceData,
        // Add threat IP metadata for filtering in BetterStack
        threatIP: context.isKnownThreatIP || false,
        threatCategory: context.threatCategory,
      };

      await fetch(envConfig.logger.url!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${envConfig.logger.key}`,
        },
        body: JSON.stringify(logEntry),
      });
    } catch {
      // Silent failure - don't log errors to avoid circular dependency
    }
  }

  /**
   * Save error trace to database for long-term persistence
   * Part of hybrid storage strategy: local DB + BetterStack
   *
   * @private
   * @param context - The trace context
   * @param spans - All collected spans
   * @param traceData - Formatted trace data with proper typing
   */
  private async saveTraceToDatabase(
    context: TraceContext,
    spans: Span[],
    traceData: FormattedTraceData,
  ): Promise<void> {
    try {
      const db = getGlobalDB();

      // Calculate expiration timestamp (current time + retention period)
      const expiresAt = Math.floor(Date.now() / 1000) + (this.dbRetentionDays * 24 * 60 * 60);

      // Extract error message from first error span or breadcrumb
      let errorMessage: string | undefined;
      const errorSpan = spans.find((s) => s.status === "error" && s.error);
      if (errorSpan?.error) {
        errorMessage = errorSpan.error.message;
      } else {
        const errorBreadcrumb = context.breadcrumbs.find((b) => b.level === "error");
        if (errorBreadcrumb) {
          errorMessage = errorBreadcrumb.message;
        }
      }

      await databaseCreateWithRetry(async (newId) => {
        await db.insert(globalTables.traceLogs).values({
          id: newId,
          traceId: context.traceId,
          instanceId: context.instanceId || "unknown",
          userId: context.userId,
          correlationId: context.correlationId,
          requestId: context.requestId,
          sessionId: context.sessionId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          errorCount: context.errorCount,
          errorMessage: errorMessage?.substring(0, 500),
          duration: Math.round((traceData.duration as number) || 0),
          spanCount: spans.length,
          breadcrumbCount: context.breadcrumbs.length,
          traceData: traceData,
          expiresAt,
        });
        return newId;
      }, generateIdRandom);

      // Silent success - no logging to avoid circular dependency
    } catch {
      // Silent failure - no logging to avoid circular dependency
    }
  }

  /**
   * Flush spans for a specific trace
   * Hybrid strategy: sends to BetterStack AND saves to database if trace has errors
   *
   * @param context - The trace context (passed from middleware)
   */
  // deno-lint-ignore require-await
  async flushTrace(context: TraceContext): Promise<void> {
    try {
      const spans = this.getCollectedSpans(context.traceId);

      if (spans.length === 0) {
        this.cleanup(context.traceId);
        return;
      }

      const traceData = formatTraceForBetterStack(context, spans);

      // Send to BetterStack directly (avoid circular dependency with logger)
      this.sendToBetterStack(traceData, context);

      // Save to database for long-term persistence
      this.saveTraceToDatabase(context, spans, traceData);

      this.cleanup(context.traceId);
    } catch {
      // Silent failure - no logging to avoid circular dependency
    }
  }

  /**
   * Clean up in-memory trace data
   *
   * @private
   * @param traceId - The trace ID to clean up
   */
  private cleanup(traceId: string): void {
    this.spans.delete(traceId);
  }

  /**
   * Clear all collected data
   * Used for cleanup or testing
   */
  clear(): void {
    this.spans.clear();
  }
}

/**
 * Get the singleton SpanCollector instance
 *
 * @param options - Optional configuration
 * @returns The SpanCollector instance
 */
export function getSpanCollector(
  options?: SpanCollectorOptions,
): SpanCollector {
  return SpanCollector.getInstance(options);
}
