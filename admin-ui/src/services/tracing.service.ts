/**
 * Tracing service for fetching and filtering trace data
 */

import type { components } from "@/types/api.generated";
import type { CompletedTrace, OperationType, Span, TraceFilter } from "@/types/tracing";
import { http } from "./http";

/** Trace search response (mirrors GET /__trace-insights/data → AdminTraceSearchResponse). */
type TracesResponse = components["schemas"]["AdminTraceSearchResponse"];

/** Trace stats response (mirrors GET /__trace-insights/stats → AdminTraceStats). */
type TraceStatsResponse = components["schemas"]["AdminTraceStats"];

/**
 * Raw `trace_logs` DB row returned by `/trace/:id` (mirrors AdminTraceDetail).
 * The UI's `CompletedTrace` is projected from `traceData` below; the raw row is
 * NOT a CompletedTrace (per known drift: AdminTraceDetail is the raw DB row).
 */
type StoredTrace = components["schemas"]["AdminTraceDetail"];

class TracingService {
  private readonly BASE_PATH = "/api/internal/__trace-insights";

  /**
   * Get all traces from API
   */
  async getTraces(params?: {
    limit?: number;
    offset?: number;
    userId?: string;
    instanceId?: string;
    startDate?: string;
    endDate?: string;
    searchQuery?: string;
  }): Promise<TracesResponse> {
    try {
      return await http.get<TracesResponse>(`${this.BASE_PATH}/data`, { params });
    } catch (error) {
      console.error("Failed to fetch traces:", error);
      return {
        traces: [],
        total: 0,
        limit: params?.limit || 50,
        offset: params?.offset || 0,
      };
    }
  }

  /**
   * Get trace statistics from API
   */
  async getStats(): Promise<TraceStatsResponse | null> {
    try {
      return await http.get<TraceStatsResponse>(`${this.BASE_PATH}/stats`);
    } catch (error) {
      console.error("Failed to fetch trace stats:", error);
      return null;
    }
  }

  /**
   * Get a single trace by ID from API
   */
  async getTraceById(traceId: string): Promise<CompletedTrace | null> {
    try {
      const trace = await http.get<StoredTrace>(`${this.BASE_PATH}/trace/${traceId}`);

      // `traceData` is an opaque JSON blob on the raw row; narrow it to the
      // projected fields we need to build a CompletedTrace.
      const data = trace.traceData as {
        rootSpanId?: string;
        spans?: Span[];
        breadcrumbs?: components["schemas"]["AdminBreadcrumb"][];
      } | null;

      // Transform database format to CompletedTrace if needed
      if (data) {
        const attrs = data.spans?.[0]?.attributes as
          | { "http.method"?: string; "http.path"?: string; "http.status_code"?: number }
          | undefined;
        return {
          traceId: trace.traceId,
          rootSpanId: data.rootSpanId ?? "",
          startTime: Number(trace.createdAt) * 1000,
          endTime: Number(trace.createdAt) * 1000 + trace.duration,
          duration: trace.duration,
          status: trace.errorCount > 0 ? "error" : "ok",
          userId: trace.userId ?? undefined,
          httpMethod: attrs?.["http.method"],
          httpPath: attrs?.["http.path"],
          httpStatusCode: attrs?.["http.status_code"],
          spans: data.spans ?? [],
          breadcrumbs: data.breadcrumbs ?? [],
          errorCount: trace.errorCount,
          spanCount: trace.spanCount,
          tags: [],
        };
      }

      return null;
    } catch (error) {
      console.error("Failed to fetch trace detail:", error);
      return null;
    }
  }

  /**
   * Filter traces based on filter criteria
   */
  filterTraces(traces: CompletedTrace[], filters: TraceFilter): CompletedTrace[] {
    let filtered = [...traces];

    // Search filter (trace ID, user ID, operation name)
    if (filters.searchQuery) {
      const searchLower = filters.searchQuery.toLowerCase();
      filtered = filtered.filter((trace) => {
        return (
          trace.traceId.toLowerCase().includes(searchLower) ||
          trace.userId?.toLowerCase().includes(searchLower) ||
          trace.httpPath?.toLowerCase().includes(searchLower) ||
          trace.httpMethod?.toLowerCase().includes(searchLower) ||
          trace.spans.some((span) => span.name.toLowerCase().includes(searchLower))
        );
      });
    }

    // Error status filter
    if (filters.errorStatus !== "all") {
      if (filters.errorStatus === "errors") {
        filtered = filtered.filter((trace) => trace.status === "error");
      } else if (filters.errorStatus === "warnings") {
        // Warnings are traces with duration > 1000ms but no errors
        filtered = filtered.filter(
          (trace) => trace.status === "ok" && trace.duration > 1000,
        );
      }
    }

    // Operation type filter
    if (filters.operationTypes.length > 0) {
      filtered = filtered.filter((trace) => trace.spans.some((span) => filters.operationTypes.includes(span.operationType)));
    }

    // Duration threshold filter
    if (filters.durationThreshold > 0) {
      filtered = filtered.filter((trace) => trace.duration >= filters.durationThreshold);
    }

    // Date range filter - start date
    if (filters.startDate) {
      const startTime = new Date(filters.startDate).getTime();
      filtered = filtered.filter((trace) => trace.startTime >= startTime);
    }

    // Date range filter - end date
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      const endTime = endDate.getTime();
      filtered = filtered.filter((trace) => trace.startTime <= endTime);
    }

    return filtered;
  }

  /**
   * Get operation type options for filters
   */
  getOperationTypeOptions(): { value: OperationType; label: string }[] {
    return [
      { value: "http.server", label: "HTTP Server" },
      { value: "http.client", label: "HTTP Client" },
      { value: "db.query", label: "Database Query" },
      { value: "db.transaction", label: "Database Transaction" },
      { value: "cache.get", label: "Cache Get" },
      { value: "cache.set", label: "Cache Set" },
      { value: "cache.delete", label: "Cache Delete" },
      { value: "service", label: "Service" },
      { value: "handler", label: "Handler" },
      { value: "auth", label: "Authentication" },
      { value: "encryption", label: "Encryption" },
      { value: "storage", label: "Storage" },
    ];
  }

  /**
   * Get error status options for filters
   */
  getErrorStatusOptions(): { value: "all" | "errors" | "warnings"; label: string }[] {
    return [
      { value: "all", label: "All Traces" },
      { value: "errors", label: "Errors Only" },
      { value: "warnings", label: "Warnings (Slow)" },
    ];
  }

  /**
   * Calculate statistics from traces
   */
  calculateStats(traces: CompletedTrace[]) {
    const totalTraces = traces.length;
    const errorTraces = traces.filter((t) => t.status === "error").length;
    const totalDuration = traces.reduce((sum, t) => sum + t.duration, 0);
    const avgDuration = totalTraces > 0 ? Math.round(totalDuration / totalTraces) : 0;

    return {
      totalTraces,
      errorTraces,
      avgDuration,
      successRate: totalTraces > 0 ? ((totalTraces - errorTraces) / totalTraces * 100).toFixed(1) + "%" : "0%",
    };
  }
}

export const tracingService = new TracingService();
