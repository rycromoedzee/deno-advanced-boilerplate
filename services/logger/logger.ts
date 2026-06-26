/**
 * @file services/logger/logger.ts
 * @description Logger service module (logger)
 */
import { Logger } from "@deps";
import type { HonoContext } from "@deps";
import { envConfig } from "@config/env.ts";
import { getInstanceId } from "@utils/instance-id.ts";
import { type LogContext, type LogEntry, loggerAppSections, LoggerLevels, type LoggerOptions } from "@logger/types.ts";
import { useLogFormatter } from "@logger/log-formatter.service.ts";
import { useLogContext } from "@logger/log-context.service.ts";
import { getTraceContext } from "@services/tracing/index.ts";

const logger = new Logger();

/**
 * Resolve the ambient request/background LogContext from AsyncLocalStorage.
 *
 * This lets every `useLogger()` call automatically pick up correlationId,
 * requestId, userId, etc. that were captured by the LogContext middleware
 * (or by `runWithBackgroundContext`), without callers having to thread a
 * HonoContext through every handler and service.
 *
 * Safe to call before the LogContext singleton is initialized (early startup)
 * or outside any `storage.run()` scope (some background tasks) — it simply
 * returns `undefined` in those cases.
 */
function resolveAmbientLogContext(): LogContext | undefined {
  try {
    return useLogContext().getContext();
  } catch {
    return undefined;
  }
}

// =====================
// Main Logger
// =====================
async function useLogger(
  level: LoggerLevels,
  options: LoggerOptions,
  isShowExtraInfo = true,
  isSimpleLog = false,
): Promise<void> {
  const {
    message,
    section,
    messageKey,
    details = {},
    meta = {},
    raw,
    context,
  } = options;

  // Fall back to the ambient AsyncLocalStorage context so every log call is
  // automatically enriched with correlationId/requestId/userId without callers
  // passing a HonoContext. An explicitly provided context always wins.
  const resolvedContext = context ?? resolveAmbientLogContext();

  // Enhanced error logging with complete trace context
  let enhancedDetails = { ...details };

  // If this is an error-level log, include complete trace information
  if (level === LoggerLevels.error || level === LoggerLevels.critical) {
    const traceService = getTraceContext();
    const traceContext = traceService.getContext();

    if (traceContext?.hasError) {
      // Get all collected spans for this trace (from current context)
      const collectedSpans = await traceService.getCollectedSpans();

      // Add complete trace information to log details
      enhancedDetails = {
        ...details,
        trace: {
          traceId: traceContext.traceId,
          rootSpanId: traceContext.rootSpanId,
          duration: performance.now() - traceContext.traceStartTime,
          hasError: traceContext.hasError,
          errorCount: traceContext.errorCount,
          spanCount: collectedSpans.length,
          // Complete span tree with all timing and attributes
          spans: collectedSpans.map((span) => ({
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            operationType: span.operationType,
            duration: span.duration,
            status: span.status,
            attributes: span.attributes,
            error: span.error,
            events: span.events,
          })),
          // Complete breadcrumb trail showing what led to error
          breadcrumbs: traceContext.breadcrumbs,
          // Active operation stack at time of error
          activeSpans: traceContext.activeSpanStack,
          // User context
          userId: traceContext.userId,
          correlationId: traceContext.correlationId,
          requestId: traceContext.requestId,
        },
      };

      // Note: Cleanup is handled automatically by SpanCollector after flush
      // No need to manually clear spans here
    }
  }

  const formatter = useLogFormatter();

  // Create log entry for console without trace data
  const consoleLogEntry = formatter.formatLogEntry(
    level,
    message,
    section,
    messageKey,
    {
      details,
      meta,
      raw,
      context: resolvedContext,
    },
  );

  // Create log entry for BetterStack with trace data
  const stackLogEntry = formatter.formatLogEntry(
    level,
    message,
    section,
    messageKey,
    {
      details: enhancedDetails,
      meta,
      raw,
      context: resolvedContext,
    },
  );

  if (section !== "LOG_TRACE") {
    console.log(formatter.prettyPrint(consoleLogEntry, isShowExtraInfo, isSimpleLog));
  }

  await SendLogToBetterStack(stackLogEntry);
}

function useLoggerGenerateLogContext(honoContext: HonoContext) {
  const contextService = useLogContext();
  return contextService.getContextFromHono(honoContext);
}

/**
 * Convenience function for logging security events
 */
async function useLogSecurityEvent(
  level: LoggerLevels,
  event: string,
  severity: "low" | "medium" | "high" | "critical",
  section: loggerAppSections,
  messageKey: string,
  details: Record<string, unknown> = {},
  context?: LogContext,
  isSimpleLog = false,
): Promise<void> {
  const formatter = useLogFormatter();
  const logEntry = formatter.formatSecurityLog(
    level,
    event,
    severity,
    section,
    messageKey,
    details,
    context ?? resolveAmbientLogContext(),
  );

  if (section !== "LOG_TRACE") {
    console.log(formatter.prettyPrint(logEntry, true, isSimpleLog));
  }

  await SendLogToBetterStack(logEntry);
}

/**
 * Convenience function for logging performance metrics
 */
async function useLogPerformance(
  operation: string,
  duration: number,
  section: loggerAppSections,
  messageKey: string,
  details: Record<string, unknown> = {},
  context?: LogContext,
  isSimpleLog = false,
): Promise<void> {
  const formatter = useLogFormatter();
  const logEntry = formatter.formatPerformanceLog(
    operation,
    duration,
    section,
    messageKey,
    details,
    context ?? resolveAmbientLogContext(),
  );

  if (section !== "LOG_TRACE") {
    console.log(formatter.prettyPrint(logEntry, true, isSimpleLog));
  }

  await SendLogToBetterStack(logEntry);
}

async function SendLogToBetterStack(logEntry: LogEntry) {
  // Only ship logs when fully configured. Force-unwrapping a missing URL or
  // sending without a key just produces hanging requests and noisy errors.
  if (!envConfig.isProduction || !envConfig.logger.key || !envConfig.logger.url) {
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

  try {
    const enrichedEntry: LogEntry = {
      ...logEntry,
      instanceId: getInstanceId(),
    };

    await fetch(envConfig.logger.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${envConfig.logger.key}`,
      },
      body: useLogFormatter().toJSON(enrichedEntry),
      signal: controller.signal,
    });
  } catch (err) {
    // A timeout aborts the fetch and surfaces as an AbortError. That is an
    // expected transient condition for a best-effort log shipper, so keep it
    // quiet rather than emitting a full error + stack trace.
    if (err instanceof DOMException && err.name === "AbortError") {
      logger.warn({
        message: "Timed out sending log to Better Stack",
      });
    } else {
      logger.error({
        message: "Failed to send log to Better Stack",
        error: err,
      });
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export { loggerAppSections, useLogger, useLoggerGenerateLogContext, useLogPerformance, useLogSecurityEvent };
