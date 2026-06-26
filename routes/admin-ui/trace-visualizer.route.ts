/**
 * @file routes/admin-ui/trace-visualizer.route.ts
 * @description Trace Visualizer route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/index.ts";

// ============================================================================
// Shared sub-schemas — model the handler's ACTUAL response shapes.
// Source of truth: handlers/admin-ui/trace-visualizer.handler.ts +
// interfaces/tracing.ts (backend) + db/schema/global/services.ts (trace_logs row).
// ============================================================================

const AdminSpanStatus = z.enum(["ok", "error", "unset"]);

const AdminBreadcrumbLevel = z.enum(["debug", "info", "warning", "error"]);

const AdminBreadcrumbCategory = z.enum([
  "http",
  "auth",
  "db",
  "cache",
  "service",
  "handler",
  "navigation",
  "user-action",
  "error",
]);

// Backed by interfaces/tracing.ts OperationType. NOTE: the backend interface
// includes "background" which the hand-written admin-ui/src/types/tracing.ts
// omits — the backend interface wins (spans may carry it).
const AdminOperationType = z.enum([
  "http.server",
  "http.client",
  "db.query",
  "db.transaction",
  "cache.get",
  "cache.set",
  "cache.delete",
  "service",
  "handler",
  "auth",
  "encryption",
  "storage",
  "background",
  "noop",
]);

const AdminSpanEvent = z
  .object({
    timestamp: z.number().openapi({
      description: "Timestamp when the event occurred (performance.now(), ms)",
      example: 1719340800123.456,
    }),
    name: z.string().openapi({
      description: "Event name / description",
      example: "cache.miss",
    }),
    attributes: z.record(z.string(), z.unknown()).optional().openapi({
      description: "Optional event attributes",
      example: { key: "user_42", ttl: 300 },
    }),
  })
  .openapi("AdminSpanEvent");

const AdminSpanError = z
  .object({
    name: z.string().openapi({
      description: "Error name / type",
      example: "TypeError",
    }),
    message: z.string().openapi({
      description: "Error message",
      example: "Cannot read properties of undefined (reading 'id')",
    }),
    stack: z.string().optional().openapi({
      description: "Optional stack trace",
      example: "TypeError: Cannot read properties of undefined...\n    at handler (file.ts:42:17)",
    }),
  })
  .openapi("AdminSpanError");

const AdminSpan = z
  .object({
    spanId: z.string().openapi({
      description: "Unique identifier for this span",
      example: "span_01J9X3KQ2HRE8MZW6VY5D4TBSC",
    }),
    traceId: z.string().openapi({
      description: "Trace ID this span belongs to",
      example: "trace_01J9X3KQ2HRE8MZW6VY5D4TBSC",
    }),
    parentSpanId: z.string().nullable().openapi({
      description: "Parent span ID (null for the root span)",
      example: null,
    }),
    name: z.string().openapi({
      description: "Human-readable name of the operation",
      example: "GET /api/documents",
    }),
    operationType: AdminOperationType.openapi({
      description: "Type of operation being performed",
      example: "http.server",
    }),
    startTime: z.number().openapi({
      description: "Start time in milliseconds (performance.now())",
      example: 1719340800000,
    }),
    endTime: z.number().optional().openapi({
      description: "End time in milliseconds (performance.now())",
      example: 1719340800421,
    }),
    duration: z.number().optional().openapi({
      description: "Duration in milliseconds",
      example: 421.7,
    }),
    attributes: z.record(z.string(), z.unknown()).openapi({
      description: "Attributes / metadata about the span",
      example: { "http.method": "GET", "http.path": "/api/documents", "http.status_code": 200 },
    }),
    status: AdminSpanStatus.openapi({
      description: "Current status of the span",
      example: "ok",
    }),
    error: AdminSpanError.optional().openapi({
      description: "Error information if the span failed",
    }),
    events: z.array(AdminSpanEvent).openapi({
      description: "Events that occurred during span execution",
      example: [],
    }),
  })
  .openapi("AdminSpan");

const AdminBreadcrumb = z
  .object({
    timestamp: z.number().openapi({
      description: "Timestamp when the breadcrumb was recorded (performance.now(), ms)",
      example: 1719340800150.2,
    }),
    category: AdminBreadcrumbCategory.openapi({
      description: "Category of the breadcrumb",
      example: "auth",
    }),
    message: z.string().openapi({
      description: "Human-readable message",
      example: "Session token validated",
    }),
    level: AdminBreadcrumbLevel.openapi({
      description: "Severity level",
      example: "info",
    }),
    data: z.record(z.string(), z.unknown()).optional().openapi({
      description: "Optional additional data",
      example: { userId: "user_42" },
    }),
  })
  .openapi("AdminBreadcrumb");

// CompletedTrace — the projected shape the data handler builds per row.
const AdminCompletedTrace = z
  .object({
    traceId: z.string().openapi({
      description: "Unique trace identifier",
      example: "trace_01J9X3KQ2HRE8MZW6VY5D4TBSC",
    }),
    rootSpanId: z.string().openapi({
      description: "Root span ID",
      example: "span_01J9X3KQ2HRE8MZW6VY5D4TBSC",
    }),
    startTime: z.number().openapi({
      description: "Trace start time as a Unix timestamp in milliseconds",
      example: 1719340800000,
    }),
    endTime: z.number().openapi({
      description: "Trace end time as a Unix timestamp in milliseconds",
      example: 1719340800421,
    }),
    duration: z.number().openapi({
      description: "Total duration in milliseconds",
      example: 421,
    }),
    status: z.enum(["ok", "error"]).openapi({
      description: "Overall trace status (error when errorCount > 0)",
      example: "ok",
    }),
    userId: z.string().optional().openapi({
      description: "Requesting user ID, when authenticated",
      example: "user_42",
    }),
    ipAddress: z.string().optional().openapi({
      description: "Client IP address",
      example: "203.0.113.54",
    }),
    userAgent: z.string().optional().openapi({
      description: "Client User-Agent string",
      example: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }),
    httpMethod: z.string().optional().openapi({
      description: "HTTP method, pulled from the http.server span attributes",
      example: "GET",
    }),
    httpPath: z.string().optional().openapi({
      description: "HTTP path, pulled from the http.server span attributes",
      example: "/api/documents",
    }),
    httpStatusCode: z.number().optional().openapi({
      description: "HTTP response status code, pulled from the http.server span attributes",
      example: 200,
    }),
    spans: z.array(AdminSpan).openapi({
      description: "All spans collected during the trace",
    }),
    breadcrumbs: z.array(AdminBreadcrumb).openapi({
      description: "All breadcrumbs collected during the trace",
    }),
    errorCount: z.number().openapi({
      description: "Number of errors recorded in the trace",
      example: 0,
    }),
    spanCount: z.number().openapi({
      description: "Number of spans in the trace",
      example: 7,
    }),
    tags: z.array(z.string()).openapi({
      description: "Tags for indexing / filtering (currently always empty)",
      example: [],
    }),
  })
  .openapi("AdminCompletedTrace");

// ============================================================================
// Response envelopes
// ============================================================================

// GET /__trace-insights/data
const AdminTraceSearchResponse = z
  .object({
    traces: z.array(AdminCompletedTrace).openapi({
      description: "Traces ordered by creation time descending",
    }),
    total: z.number().openapi({
      description: "Total number of traces matching the filters (for pagination)",
      example: 1284,
    }),
    limit: z.number().openapi({
      description: "Maximum number of traces returned in this page",
      example: 100,
    }),
    offset: z.number().openapi({
      description: "Number of traces skipped (for pagination)",
      example: 0,
    }),
  })
  .openapi("AdminTraceSearchResponse");

// GET /__trace-insights/stats
const AdminTraceStats = z
  .object({
    global: z
      .object({
        totalTraces: z.number().openapi({
          description: "Total number of stored traces",
          example: 48213,
        }),
        totalErrors: z.number().openapi({
          description: "Total number of errors across all traces",
          example: 312,
        }),
        avgDuration: z.number().openapi({
          description: "Average trace duration in milliseconds",
          example: 187.4,
        }),
        totalSpans: z.number().openapi({
          description: "Total number of spans across all traces",
          example: 331904,
        }),
        errorRate: z.string().openapi({
          description: "Overall error rate as a percentage string (1 decimal place)",
          example: "0.6%",
        }),
      })
      .openapi("AdminTraceStatsGlobal"),
    recent24h: z
      .object({
        traces: z.number().openapi({
          description: "Number of traces recorded in the last 24 hours",
          example: 5217,
        }),
        errors: z.number().openapi({
          description: "Number of errors recorded in the last 24 hours",
          example: 41,
        }),
        errorRate: z.string().openapi({
          description: "24-hour error rate as a percentage string (1 decimal place)",
          example: "0.8%",
        }),
      })
      .openapi("AdminTraceStatsRecent"),
    instances: z
      .array(
        z
          .object({
            instanceId: z.string().openapi({
              description: "Instance identifier (server / process) that produced the traces",
              example: "inst_eu-west-1a-7",
            }),
            traceCount: z.number().openapi({
              description: "Number of traces produced by this instance",
              example: 1820,
            }),
            errorCount: z.number().openapi({
              description: "Number of errors produced by this instance",
              example: 23,
            }),
            errorRate: z.string().openapi({
              description: "Instance error rate as a percentage string (1 decimal place)",
              example: "1.3%",
            }),
          })
          .openapi("AdminTraceStatsInstance"),
      )
      .openapi({
        description: "Top 10 instances by trace count, ordered by trace count descending",
      }),
  })
  .openapi("AdminTraceStats");

// GET /__trace-insights/trace/{traceId}
// The detail handler returns the raw trace_logs DB row (spread) plus a
// redundant explicit traceData copy — NOT a CompletedTrace. traceData is the
// stored JSON blob containing the spans, breadcrumbs, and trace metadata.
const AdminTraceDetail = z
  .object({
    id: z.string().openapi({
      description: "Primary key of the trace_logs row",
      example: "tl_01J9X3KQ2HRE8MZW6VY5D4TBSC",
    }),
    traceId: z.string().openapi({
      description: "Unique trace identifier",
      example: "trace_01J9X3KQ2HRE8MZW6VY5D4TBSC",
    }),
    instanceId: z.string().openapi({
      description: "Instance identifier that produced the trace",
      example: "inst_eu-west-1a-7",
    }),
    userId: z.string().nullable().openapi({
      description: "Requesting user ID, if authenticated",
      example: "user_42",
    }),
    correlationId: z.string().nullable().openapi({
      description: "Correlation ID linking related requests/traces",
      example: "corr_01J9X3KQ2HRE8MZW6VY5D4TBSC",
    }),
    requestId: z.string().nullable().openapi({
      description: "Per-request identifier",
      example: "req_01J9X3KQ2HRE8MZW6VY5D4TBSC",
    }),
    sessionId: z.string().nullable().openapi({
      description: "Session identifier, if present",
      example: "sess_01J9X3KQ2HRE8MZW6VY5D4TBSC",
    }),
    ipAddress: z.string().nullable().openapi({
      description: "Client IP address",
      example: "203.0.113.54",
    }),
    userAgent: z.string().nullable().openapi({
      description: "Client User-Agent string",
      example: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }),
    errorCount: z.number().openapi({
      description: "Number of errors recorded in the trace",
      example: 1,
    }),
    errorMessage: z.string().nullable().openapi({
      description: "Top-level error message for the trace, if any",
      example: "TypeError: Cannot read properties of undefined (reading 'id')",
    }),
    duration: z.number().openapi({
      description: "Total trace duration in milliseconds",
      example: 421,
    }),
    spanCount: z.number().openapi({
      description: "Number of spans in the trace",
      example: 7,
    }),
    breadcrumbCount: z.number().openapi({
      description: "Number of breadcrumbs in the trace",
      example: 12,
    }),
    traceData: z.record(z.string(), z.unknown()).openapi({
      description:
        "Full stored trace payload — the JSON blob written at trace completion. Contains rootSpanId, duration, errorCount, spanCount, breadcrumbCount, spans[], breadcrumbs[], and trace metadata. (Returned twice by the handler: once via the row spread and once explicitly.)",
      example: {
        traceId: "trace_01J9X3KQ2HRE8MZW6VY5D4TBSC",
        rootSpanId: "span_01J9X3KQ2HRE8MZW6VY5D4TBSC",
        duration: 421,
        hasError: true,
        errorCount: 1,
        spanCount: 7,
        breadcrumbCount: 12,
        spans: [],
        breadcrumbs: [],
      },
    }),
    createdAt: z.number().openapi({
      description: "Row creation time as a Unix timestamp in seconds",
      example: 1719340800,
    }),
    expiresAt: z.number().nullable().openapi({
      description: "Optional TTL expiration as a Unix timestamp in seconds",
      example: 1719945600,
    }),
  })
  .openapi("AdminTraceDetail");

/**
 * Route: Get all traces with optional filtering
 */
export const traceVisualizerDataRoute = createRoute({
  method: "get",
  path: "/__trace-insights/data",
  tags: [OpenAPITags.admin],
  summary: "Search traces",
  operationId: "traceSearch",
  description: `List stored traces with optional filtering.

**Behavior:** Reads from the global trace log and supports filtering by \`limit\`, \`offset\`, \`userId\`, \`instanceId\`, \`startDate\`, \`endDate\`, and a \`searchQuery\` (matched against traceId, userId, HTTP path, and HTTP method). Returns traces ordered by creation time descending, projected into a completed-trace shape with HTTP details pulled from the \`http.server\` span, plus the total count for pagination.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (reads the shared/global trace log; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "List of traces with filtering support",
      content: {
        "application/json": {
          schema: AdminTraceSearchResponse,
        },
      },
    },
    500: {
      description: "Failed to fetch traces",
    },
  },
});

/**
 * Route: Get trace statistics
 */
export const traceVisualizerStatsRoute = createRoute({
  method: "get",
  path: "/__trace-insights/stats",
  tags: [OpenAPITags.admin],
  summary: "Get trace stats",
  operationId: "traceStatsGet",
  description: `Return aggregate trace statistics.

**Behavior:** Computes global totals (trace count, total errors, average duration, total spans, overall error rate), a 24-hour recent window (traces, errors, error rate), and a per-instance breakdown (top 10 instances by trace count with error counts and rates).
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (aggregates the shared/global trace log; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Trace statistics and analytics",
      content: {
        "application/json": {
          schema: AdminTraceStats,
        },
      },
    },
    500: {
      description: "Failed to fetch trace statistics",
    },
  },
});

/**
 * Route: Get single trace by ID
 */
export const traceVisualizerDetailRoute = createRoute({
  method: "get",
  path: "/__trace-insights/trace/{traceId}",
  tags: [OpenAPITags.admin],
  summary: "Get trace span",
  operationId: "traceSpanGet",
  description: `Fetch a single trace and its full detail by ID.

**Behavior:** Looks up the trace log row by \`traceId\` and returns the complete record, including the full \`traceData\` (all spans and breadcrumbs). Returns 404 when no trace matches the ID.
**Auth:** internal tool
**Permissions:** none
**Notes:** Internal-only, global (reads the shared/global trace log; not tenant-scoped).`,
  security: [{ internalToolKeyAuth: [] }],
  responses: {
    200: {
      description: "Single trace detail",
      content: {
        "application/json": {
          schema: AdminTraceDetail,
        },
      },
    },
    400: {
      description: "Trace ID is required",
    },
    404: {
      description: "Trace not found",
    },
    500: {
      description: "Failed to fetch trace detail",
    },
  },
});
