/**
 * @file middleware/tracing.middleware.ts
 * @description Tracing middleware
 */
import type { HonoContext, HonoNext } from "@deps";
import { getTraceContext } from "@services/tracing/index.ts";
import { useLogContext } from "@logger/log-context.service.ts";
import { envConfig } from "@config/env.ts";
import { getClientIP, getIPSecurityCheck } from "@middleware/request-context.middleware.ts";

/**
 * Tracing Middleware
 *
 * Serverless-compatible distributed tracing for each request.
 * Automatically collects trace data and sends only error traces to BetterStack.
 *
 * **IMPORTANT**: This middleware MUST run AFTER LogContext middleware.
 *
 * Features:
 * - Creates root trace context with unique trace ID
 * - Starts root span for the HTTP request
 * - Automatically propagates context via AsyncLocalStorage
 * - Adds trace headers to response
 * - Records request method, path, and status code
 * - Creates breadcrumbs for request lifecycle
 * - Flushes spans immediately when request completes (serverless-compatible)
 * - Only sends error traces to BetterStack (automatic filtering)
 *
 * @example Middleware setup
 * ```typescript
 * import { createLogContextMiddleware } from '@logger/log-context.service.ts';
 * import { tracingMiddleware } from '@middleware/tracing.middleware.ts';
 *
 * app.use('*', createLogContextMiddleware()); // MUST be first
 * app.use('*', tracingMiddleware);            // Then tracing
 * ```
 */
/**
 * Paths to exclude from tracing (static assets, health checks, etc.)
 */
const EXCLUDED_PATHS = [
  /^\/static\//, // Static assets
  /^\/favicon\.ico$/, // Favicon
  /^\/robots\.txt$/, // Robots.txt
  /^\/health$/, // Health check endpoint
  /^\/internal\//, // Internal monitoring/debugging routes
  /^\/api\/internal\//, // Internal API routes
  /^\/__cache-insights/, // Cache visualizer (HTML + data + stats endpoints)
  /^\/\.well-known\//, // Well-known URIs (browser probes, etc.)
  /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i, // Asset files
];

/**
 * Check if a path should be excluded from tracing
 */
function shouldExcludeFromTracing(path: string): boolean {
  return EXCLUDED_PATHS.some((pattern) => pattern.test(path));
}

const MAX_ERROR_MESSAGE_LENGTH = 500;

function normalizeErrorMessage(message?: string): string | undefined {
  if (!message) return undefined;
  const trimmed = message.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_ERROR_MESSAGE_LENGTH) {
    return trimmed.slice(0, MAX_ERROR_MESSAGE_LENGTH);
  }
  return trimmed;
}

async function extractErrorDetails(res: Response): Promise<
  {
    message?: string;
    messageKey?: string;
  } | null
> {
  try {
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return null;
    }

    const payload = await res.clone().json();
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : undefined;
    const messageKey = typeof record.messageKey === "string" ? record.messageKey : undefined;

    if (!message && !messageKey) {
      return null;
    }

    return {
      message: normalizeErrorMessage(message),
      messageKey,
    };
  } catch {
    return null;
  }
}

export const tracingMiddleware = async (c: HonoContext, next: HonoNext) => {
  if (!envConfig.tracing.enabled) {
    return await next();
  }

  // Skip tracing for static assets and excluded paths
  if (shouldExcludeFromTracing(c.req.path)) {
    return await next();
  }

  // Use shared context from requestContextMiddleware (IP already extracted once)
  const clientIP = getClientIP(c);

  const traceService = getTraceContext();
  const logContextService = useLogContext();

  const logContext = logContextService.getContext();
  if (!logContext) {
    console.warn(
      "Tracing middleware: No log context found. Ensure LogContext middleware runs before tracing middleware.",
    );
    return await next();
  }

  // Initialize trace context extending log context
  const traceContext = traceService.initializeTrace(logContext);

  // Use pre-computed IP security check from requestContextMiddleware
  const ipSecurityCheck = getIPSecurityCheck(c);
  if (ipSecurityCheck) {
    if (ipSecurityCheck.action !== "allow") {
      traceContext.isKnownThreatIP = true;
      traceContext.threatCategory = ipSecurityCheck.category;
    }
    // Always propagate anonymizer/infrastructure flags for observability
    if (ipSecurityCheck.metadata?.isAnonymizer) {
      traceContext.isAnonymizer = true;
    }
    if (ipSecurityCheck.metadata?.isInfrastructure) {
      traceContext.isInfrastructure = true;
    }
  }

  c.header("Trace-ID", traceContext.traceId);
  c.header("Root-Span-ID", traceContext.rootSpanId);

  try {
    await traceService.run(traceContext, async () => {
      // Create root span INSIDE AsyncLocalStorage context
      const rootSpan = traceService.startSpan(
        `${c.req.method} ${c.req.path}`,
        "http.server",
        {
          "http.method": c.req.method,
          "http.path": c.req.path,
          "http.user_agent": c.req.header("user-agent") || "unknown",
          "http.host": c.req.header("host") || "unknown",
          "http.client_ip": clientIP || "unknown",
        },
        traceContext.traceStartTime,
      );

      traceService.addBreadcrumb(
        "http",
        `Request started: ${c.req.method} ${c.req.path}`,
        "info",
        {
          method: c.req.method,
          path: c.req.path,
          query: c.req.query(),
        },
      );

      await traceService.runWithSpan(rootSpan, async () => {
        try {
          await next();

          rootSpan.attributes["http.status_code"] = c.res.status;
          rootSpan.status = c.res.status < 400 ? "ok" : "error";

          // Mark trace as having error if HTTP status indicates error
          if (c.res.status >= 400) {
            if (!traceContext.hasError) {
              traceContext.hasError = true;
            }
            traceContext.errorCount++;

            const hasErrorBreadcrumb = traceContext.breadcrumbs.some((b) => b.level === "error");
            if (!rootSpan.error && !hasErrorBreadcrumb) {
              const errorDetails = await extractErrorDetails(c.res);
              const errorMessage = errorDetails?.message ?? `HTTP ${c.res.status} error`;

              rootSpan.error = {
                name: "HttpError",
                message: errorMessage,
                stack: undefined,
              };

              traceService.addBreadcrumb(
                "error",
                errorMessage,
                "error",
                {
                  status: c.res.status,
                  messageKey: errorDetails?.messageKey,
                },
              );
            }
          }

          traceService.addBreadcrumb(
            "http",
            `Response: ${c.res.status}`,
            c.res.status < 400 ? "info" : "error",
            {
              status: c.res.status,
            },
          );
        } catch (error) {
          rootSpan.status = "error";
          rootSpan.error = {
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          };

          traceService.recordException(error);

          traceService.addBreadcrumb(
            "error",
            `Error: ${error instanceof Error ? error.message : String(error)}`,
            "error",
            {
              error: error instanceof Error ? error.name : "UnknownError",
            },
          );

          throw error;
        } finally {
          // Finish span inside AsyncLocalStorage context so it gets collected
          traceService.finishSpan(rootSpan);
        }
      }); // end runWithSpan
    });

    // Flush trace immediately after request completes (serverless-compatible)
    // Pass context explicitly since we're outside AsyncLocalStorage context
    await traceService.flushSpans(traceContext);
  } catch (error) {
    // Re-throw error after trace is flushed
    throw error;
  }
};
