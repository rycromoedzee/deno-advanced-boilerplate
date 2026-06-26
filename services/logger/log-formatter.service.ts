/**
 * @file services/logger/log-formatter.service.ts
 * @description Log Formatter service (logger)
 */
import { type LogContext, type LogEntry, loggerAppSections, LoggerLevels } from "@logger/types.ts";

/**
 * Service for consistent log formatting across all services
 */
export class LogFormatterService {
  private static instance: LogFormatterService | null = null;

  private constructor() {}

  static getInstance(): LogFormatterService {
    if (!LogFormatterService.instance) {
      LogFormatterService.instance = new LogFormatterService();
    }
    return LogFormatterService.instance;
  }

  /**
   * Formats a log entry with consistent structure
   */
  formatLogEntry(
    level: LoggerLevels,
    message: string,
    section: loggerAppSections,
    messageKey: string,
    options: {
      details?: Record<string, unknown>;
      meta?: Record<string, unknown>;
      raw?: unknown;
      context?: LogContext;
    } = {},
  ): LogEntry {
    const { details = {}, meta = {}, raw, context = {} } = options;

    return {
      level,
      message,
      section,
      messageKey,
      details,
      meta: this.isPlainObject(meta) ? meta : { meta },
      raw,
      timestamp: new Date().toISOString(),
      correlationId: context.correlationId,
      requestId: context.requestId,
      userId: context.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    };
  }

  /**
   * Formats error logs with enhanced error information
   */
  formatErrorLog(
    error: Error | unknown,
    section: loggerAppSections,
    messageKey: string,
    context?: LogContext,
    additionalDetails?: Record<string, unknown>,
  ): LogEntry {
    const errorDetails: Record<string, unknown> = {
      ...additionalDetails,
    };

    if (error instanceof Error) {
      errorDetails.errorName = error.name;
      errorDetails.errorMessage = error.message;
      errorDetails.errorStack = error.stack;
    } else {
      errorDetails.error = error;
    }

    return this.formatLogEntry(
      LoggerLevels.error,
      error instanceof Error ? error.message : "Unknown error occurred",
      section,
      messageKey,
      {
        details: errorDetails,
        context,
        raw: error,
      },
    );
  }

  /**
   * Formats security event logs with enhanced security context
   */
  formatSecurityLog(
    level: LoggerLevels,
    event: string,
    severity: "low" | "medium" | "high" | "critical",
    section: loggerAppSections,
    messageKey: string,
    details: Record<string, unknown> = {},
    context?: LogContext,
  ): LogEntry {
    const securityDetails = {
      ...details,
      securityEvent: event,
      severity,
      timestamp: new Date().toISOString(),
    };

    return this.formatLogEntry(
      level,
      `Security Event: ${event}`,
      section,
      messageKey,
      {
        details: securityDetails,
        context,
        meta: {
          security: true,
          severity,
        },
      },
    );
  }

  /**
   * Formats performance logs with timing information
   */
  formatPerformanceLog(
    operation: string,
    duration: number,
    section: loggerAppSections,
    messageKey: string,
    details: Record<string, unknown> = {},
    context?: LogContext,
  ): LogEntry {
    const performanceDetails = {
      ...details,
      operation,
      duration,
      durationMs: `${duration}ms`,
    };

    return this.formatLogEntry(
      LoggerLevels.info,
      `Performance: ${operation} completed in ${duration}ms`,
      section,
      messageKey,
      {
        details: performanceDetails,
        context,
        meta: {
          performance: true,
          operation,
        },
      },
    );
  }

  /**
   * Pretty prints a log entry for console output
   */
  prettyPrint(logEntry: LogEntry, isShowExtraInfo = true, isSimpleLog = false): string {
    const timeStr = this.pad(
      this.dim(logEntry.timestamp),
      26,
    );
    const symbol = this.colorLevel(String(logEntry.level));
    const sectionStr = logEntry.section ? this.bold(this.bright(`[${logEntry.section}]`)) : "";
    const msgStr = logEntry.message ? String(logEntry.message) : "";

    let line = `${symbol} ${timeStr} ${sectionStr} | ${msgStr}`;

    // Add correlation info if available
    if (logEntry.correlationId || logEntry.requestId) {
      line += ` | `;
      if (logEntry.correlationId) {
        line += `\x1b[33mCID:\x1b[0m ${logEntry.correlationId} `;
      }
      if (logEntry.requestId) {
        line += `\x1b[33mRID:\x1b[0m ${logEntry.requestId}`;
      }
    }

    if (
      isShowExtraInfo && logEntry.details &&
      Object.keys(logEntry.details as object).length > 0
    ) {
      // Exclude trace from console output while keeping other details
      const { _trace, ...detailsWithoutTrace } = logEntry.details as Record<string, unknown>;

      // Only show details section if there are properties other than trace
      if (Object.keys(detailsWithoutTrace).length > 0) {
        line += `\n  \x1b[34mdetails:\x1b[0m \x1b[90m${this.safeStringify(detailsWithoutTrace)}\x1b[0m`;
      }
    }

    if (!isSimpleLog) {
      if (
        isShowExtraInfo && logEntry.meta &&
        Object.keys(logEntry.meta as object).length > 0
      ) {
        line += `\n  \x1b[35mmeta:\x1b[0m \x1b[90m${this.safeStringify(logEntry.meta)}\x1b[0m`;
      } else if (isShowExtraInfo) {
        line += `\n  \x1b[35mmeta:\x1b[0m \x1b[90m{}\x1b[0m`;
      }

      if (isShowExtraInfo && logEntry.raw) {
        const rawStr = this.safeStringify(logEntry.raw);
        line += `\n  \x1b[31mraw:\x1b[0m \x1b[90m${rawStr}\x1b[0m`;
      }

      // Add separator line for better readability between log entries
      line += `\n\x1b[90m${"─".repeat(80)}\x1b[0m`;
    }
    return line;
  }

  /**
   * Converts log entry to JSON for external logging services
   */
  toJSON(logEntry: LogEntry): string {
    return this.safeStringify(logEntry);
  }

  // Helper methods for formatting
  private isPlainObject(val: unknown): val is Record<string, unknown> {
    return typeof val === "object" && val !== null && !Array.isArray(val);
  }

  /**
   * Stringifies an arbitrary value for log output, ensuring `Error` instances
   * (which have non-enumerable `name`/`message`/`stack`) are fully serialized
   * instead of collapsing to `{}` or `{"code":""}`. Falls back to `String(value)`
   * if serialization throws (e.g. circular structures the replacer can't break).
   */
  private safeStringify(value: unknown): string {
    try {
      const out = JSON.stringify(value, this.errorReplacer());
      if (out === undefined || out === "{}" || out === "null") {
        return this.stringifyFallback(value);
      }
      return out;
    } catch {
      return this.stringifyFallback(value);
    }
  }

  private stringifyFallback(value: unknown): string {
    if (value instanceof Error) {
      return value.stack ?? `${value.name}: ${value.message}`;
    }
    return String(value);
  }

  /**
   * Returns a `JSON.stringify` replacer that expands `Error` values (at any
   * depth, including the `cause` chain) into plain objects carrying `name`,
   * `message`, `stack`, and any enumerable own properties (e.g. libSQL's
   * `code`). A WeakSet guards against circular references.
   */
  private errorReplacer(): (this: unknown, key: string, value: unknown) => unknown {
    const seen = new WeakSet<object>();
    return function (_key: string, value: unknown): unknown {
      if (value instanceof Error) {
        const serialized: Record<string, unknown> = {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
        // Include any enumerable own props (libSQL `code`, custom fields, etc.)
        for (const prop of Object.keys(value)) {
          if (!(prop in serialized)) {
            serialized[prop] = (value as unknown as Record<string, unknown>)[prop];
          }
        }
        if (value.cause !== undefined) {
          serialized.cause = value.cause;
        }
        return serialized;
      }
      if (value !== null && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    };
  }

  private pad(str: string, len: number): string {
    if (str.length > len) return str.slice(0, len - 1) + "…";
    return str.padEnd(len);
  }

  private colorLevel(level: string): string {
    const plain = level.toUpperCase();

    switch (level) {
      case "info":
        return `\x1b[97m${plain}\x1b[0m`; // Bright Green (lowest severity)
      case "warn":
        return `\x1b[93m${plain}\x1b[0m`; // Bright Yellow
      case "error":
        return `\x1b[91m${plain}\x1b[0m`; // Bright Red
      case "debug":
        return `\x1b[96m${plain}\x1b[0m`; // Bright Cyan (neutral technical info)
      case "critical":
        return `\x1b[95m${plain}\x1b[0m`; // Bright Magenta (highest severity)
      default:
        return plain;
    }
  }

  private bold(str: string): string {
    return `\x1b[1m${str}\x1b[0m`;
  }

  private dim(str: string): string {
    return `\x1b[90m${str}\x1b[0m`;
  }

  private bright(str: string): string {
    return `\x1b[97m${str}\x1b[0m`;
  }
}

/**
 * Singleton instance getter
 */
export function useLogFormatter(): LogFormatterService {
  return LogFormatterService.getInstance();
}

/**
 * Test utility function to reset singleton instance
 * This should only be used in test environments
 * @internal
 */
export function resetLogFormatterSingleton(): void {
  (LogFormatterService as unknown as { instance: LogFormatterService | null })
    .instance = null;
}
