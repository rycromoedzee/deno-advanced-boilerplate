/**
 * @file handlers/admin-ui/trace-visualizer.handler.ts
 * @description Trace Visualizer request handler
 */
/**
 * Trace Visualizer Handler
 *
 * Handlers for trace visualization endpoints
 * Provides access to stored error traces from PostgreSQL
 */

import type { HonoContext } from "@deps";
import { and, desc, eq, gte, HTTPException, lte, sql } from "@deps";

import type { Breadcrumb, CompletedTrace, Span } from "@interfaces/tracing.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";

/**
 * Get all traces with optional filtering
 */
export const traceVisualizerDataHandler = async (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();

    // Get query parameters for filtering
    const limit = parseInt(c.req.query("limit") || "100");
    const offset = parseInt(c.req.query("offset") || "0");
    const userId = c.req.query("userId");
    const instanceId = c.req.query("instanceId");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const searchQuery = c.req.query("searchQuery");

    // Build where conditions
    const conditions = [];

    if (userId) {
      conditions.push(eq(globalTables.traceLogs.userId, userId));
    }

    if (instanceId) {
      conditions.push(eq(globalTables.traceLogs.instanceId, instanceId));
    }

    if (startDate) {
      const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
      conditions.push(gte(globalTables.traceLogs.createdAt, startTimestamp));
    }

    if (endDate) {
      const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);
      conditions.push(lte(globalTables.traceLogs.createdAt, endTimestamp));
    }

    // Search query - matches traceId, userId, HTTP path/method
    if (searchQuery && searchQuery.trim()) {
      const searchPattern = `%${searchQuery.toLowerCase()}%`;
      conditions.push(
        sql`(
          LOWER(${globalTables.traceLogs.traceId}) LIKE ${searchPattern}
          OR LOWER(${globalTables.traceLogs.userId}) LIKE ${searchPattern}
          OR LOWER(${globalTables.traceLogs.traceData}->>'httpPath') LIKE ${searchPattern}
          OR LOWER(${globalTables.traceLogs.traceData}->>'httpMethod') LIKE ${searchPattern}
        )`,
      );
    }

    // Get total count first
    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(globalTables.traceLogs);

    const [countResult] = conditions.length > 0 ? await countQuery.where(and(...conditions)) : await countQuery;

    const totalCount = countResult?.count || 0;

    // Query traces with filters
    const query = db
      .select()
      .from(globalTables.traceLogs)
      .orderBy(desc(globalTables.traceLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const traces = conditions.length > 0 ? await query.where(and(...conditions)) : await query;

    // Transform to CompletedTrace format
    const completedTraces: CompletedTrace[] = traces.map((trace) => {
      const traceData = trace.traceData as Record<string, unknown>;
      const spans = (traceData.spans || []) as Span[];

      // Find the http.server span to get HTTP request details
      const httpServerSpan = spans.find((s) => s.operationType === "http.server");
      const spanAttrs = (httpServerSpan?.attributes || {}) as Record<string, unknown>;

      return {
        traceId: trace.traceId,
        rootSpanId: traceData.rootSpanId as string,
        startTime: Number(trace.createdAt) * 1000, // Convert to milliseconds
        endTime: Number(trace.createdAt) * 1000 + trace.duration,
        duration: trace.duration,
        status: trace.errorCount > 0 ? "error" : "ok",
        userId: trace.userId || undefined,
        ipAddress: trace.ipAddress || undefined,
        userAgent: trace.userAgent || undefined,
        httpMethod: spanAttrs["http.method"] as string || undefined,
        httpPath: spanAttrs["http.path"] as string || undefined,
        httpStatusCode: spanAttrs["http.status_code"] as number || undefined,
        spans: spans,
        breadcrumbs: (traceData.breadcrumbs || []) as Breadcrumb[],
        errorCount: trace.errorCount,
        spanCount: trace.spanCount,
        tags: [], // Can be enhanced later
      };
    });

    return c.json({
      traces: completedTraces,
      total: totalCount,
      limit,
      offset,
    });
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "Error fetching traces",
      messageKey: "trace_visualizer.fetch_error",
      section: loggerAppSections.TRACING,
      raw: error,
    });
    throw new HTTPException(500, { message: "Failed to fetch traces" });
  }
};

/**
 * Get trace statistics
 */
export const traceVisualizerStatsHandler = async (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const db = getGlobalDB();

    // Get total count and error count
    const [stats] = await db
      .select({
        totalTraces: sql<number>`count(*)`,
        totalErrors: sql<number>`sum(error_count)`,
        avgDuration: sql<number>`avg(duration)`,
        totalSpans: sql<number>`sum(span_count)`,
      })
      .from(globalTables.traceLogs);

    // Get instance breakdown
    const instanceStats = await db
      .select({
        instanceId: globalTables.traceLogs.instanceId,
        count: sql<number>`count(*)`,
        errorCount: sql<number>`sum(error_count)`,
      })
      .from(globalTables.traceLogs)
      .groupBy(globalTables.traceLogs.instanceId)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    // Get recent error rate (last 24 hours)
    const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
    const [recentStats] = await db
      .select({
        recentTraces: sql<number>`count(*)`,
        recentErrors: sql<number>`sum(error_count)`,
      })
      .from(globalTables.traceLogs)
      .where(gte(globalTables.traceLogs.createdAt, oneDayAgo));

    return c.json({
      global: {
        totalTraces: stats.totalTraces || 0,
        totalErrors: stats.totalErrors || 0,
        avgDuration: stats.avgDuration || 0,
        totalSpans: stats.totalSpans || 0,
        errorRate: stats.totalTraces > 0 ? ((stats.totalErrors / stats.totalTraces) * 100).toFixed(1) + "%" : "0%",
      },
      recent24h: {
        traces: recentStats.recentTraces || 0,
        errors: recentStats.recentErrors || 0,
        errorRate: recentStats.recentTraces > 0 ? ((recentStats.recentErrors / recentStats.recentTraces) * 100).toFixed(1) + "%" : "0%",
      },
      instances: instanceStats.map((inst) => ({
        instanceId: inst.instanceId,
        traceCount: inst.count,
        errorCount: inst.errorCount,
        errorRate: inst.count > 0 ? ((inst.errorCount / inst.count) * 100).toFixed(1) + "%" : "0%",
      })),
    });
  } catch (error) {
    useLogger(LoggerLevels.error, {
      message: "Error fetching trace stats",
      messageKey: "trace_visualizer.stats_error",
      section: loggerAppSections.TRACING,
      raw: error,
    });
    throw new HTTPException(500, { message: "Failed to fetch trace statistics" });
  }
};

/**
 * Get a single trace by ID
 */
export const traceVisualizerDetailHandler = async (c: HonoContext) => {
  if (c.req.method !== "GET") {
    throw new HTTPException(405, { message: "Method Not Allowed" });
  }

  try {
    const traceId = c.req.param("traceId");

    if (!traceId) {
      throw new HTTPException(400, { message: "Trace ID is required" });
    }

    const db = getGlobalDB();
    const [trace] = await db
      .select()
      .from(globalTables.traceLogs)
      .where(eq(globalTables.traceLogs.traceId, traceId))
      .limit(1);

    if (!trace) {
      throw new HTTPException(404, { message: "Trace not found" });
    }

    // Return the complete trace data
    return c.json({
      ...trace,
      traceData: trace.traceData, // Full trace data with spans and breadcrumbs
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    useLogger(LoggerLevels.error, {
      message: "Error fetching trace detail",
      messageKey: "trace_visualizer.detail_error",
      section: loggerAppSections.TRACING,
      details: { traceId: c.req.param("traceId") },
      raw: error,
    });
    throw new HTTPException(500, { message: "Failed to fetch trace detail" });
  }
};
