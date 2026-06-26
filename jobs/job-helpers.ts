/**
 * @file jobs/job-helpers.ts
 * @description Shared helpers for scheduled jobs
 */
/**
 * Job Helpers - Logging wrapper for scheduled jobs
 *
 * Provides a consistent logging interface for all cron jobs with:
 * - Default trace log level
 * - Automatic "cron" prefix in messages
 * - Smart messageKey generation from feature + action
 * - Consistent formatting across all jobs
 */

import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

/**
 * Log levels available for job logging
 */
export type JobLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "critical";

/**
 * Options for the job logger
 */
export interface JobLogOptions {
  /** The feature/module name (e.g., "threat-intel", "trace", "upload") */
  feature: string;

  /** The action being performed (e.g., "cleanup", "update", "rebuild") */
  action: string;

  /** The app section for categorization */
  section: loggerAppSections;

  /** Log level - defaults to "trace" */
  level?: JobLogLevel;

  /** Additional context details */
  details?: Record<string, unknown>;

  /** Raw error or data for debugging */
  raw?: unknown;
}

/**
 * Map job log level to LoggerLevels enum
 */
function mapLogLevel(level: JobLogLevel): LoggerLevels {
  const levelMap: Record<JobLogLevel, LoggerLevels> = {
    trace: LoggerLevels.trace,
    debug: LoggerLevels.debug,
    info: LoggerLevels.info,
    warn: LoggerLevels.warn,
    error: LoggerLevels.error,
    critical: LoggerLevels.critical,
  };
  return levelMap[level];
}

/**
 * Generate a consistent messageKey from feature and action
 * Format: CRON_<FEATURE>_<ACTION>
 *
 * @example
 * buildMessageKey("threat-intel", "cleanup") // "CRON_THREAT_INTEL_CLEANUP"
 * buildMessageKey("trace", "started") // "CRON_TRACE_STARTED"
 */
export function buildMessageKey(feature: string, action: string): string {
  const normalizedFeature = feature.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const normalizedAction = action.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `CRON_${normalizedFeature}_${normalizedAction}`;
}

/**
 * Build a consistent log message with cron prefix
 *
 * @example
 * buildMessage("cleanup", "started") // "[CRON] cleanup started"
 * buildMessage("bloom filter", "completed") // "[CRON] bloom filter completed"
 */
export function buildMessage(feature: string, action: string): string {
  return `[CRON] ${feature} ${action}`;
}

/**
 * Job-specific logger wrapper with consistent formatting
 *
 * Provides a simplified interface for logging from cron jobs with:
 * - Default trace log level (configurable)
 * - Automatic "[CRON]" prefix in messages
 * - Auto-generated messageKey from feature + action
 * - Consistent app section categorization
 *
 * @param options - Job log configuration options
 *
 * @example
 * // Basic usage
 * await useJobLogger({
 *   feature: "threat-intel",
 *   action: "started",
 *   section: loggerAppSections.THREAT_INTELLIGENCE,
 * });
 * // Logs: "[CRON] threat-intel started" with key "CRON_THREAT_INTEL_STARTED"
 *
 * @example
 * // With details and custom level
 * await useJobLogger({
 *   feature: "trace",
 *   action: "completed",
 *   section: loggerAppSections.TRACING,
 *   level: "info",
 *   details: { deletedCount: 150, durationMs: 1234 },
 * });
 *
 * @example
 * // Error logging
 * await useJobLogger({
 *   feature: "upload",
 *   action: "failed",
 *   section: loggerAppSections.DOCUMENTS,
 *   level: "error",
 *   raw: error,
 *   details: { errorMessage: error.message },
 * });
 */
export async function useJobLogger(options: JobLogOptions): Promise<void> {
  const {
    feature,
    action,
    section,
    level = "trace",
    details,
    raw,
  } = options;

  const messageKey = buildMessageKey(feature, action);
  const message = buildMessage(feature, action);

  await useLogger(
    mapLogLevel(level),
    {
      message,
      section,
      messageKey,
      details,
      raw,
    },
    true,
    true,
  );
}

/**
 * Convenience function for job started logs
 */
export async function logJobStarted(
  feature: string,
  section: loggerAppSections,
  details?: Record<string, unknown>,
): Promise<void> {
  await useJobLogger({
    feature,
    action: "started",
    section,
    level: "trace",
    details,
  });
}

/**
 * Convenience function for job completed logs
 */
export async function logJobCompleted(
  feature: string,
  section: loggerAppSections,
  details?: Record<string, unknown>,
): Promise<void> {
  await useJobLogger({
    feature,
    action: "completed",
    section,
    level: "trace",
    details,
  });
}

/**
 * Convenience function for job skipped logs (e.g., lock not acquired)
 */
export async function logJobSkipped(
  feature: string,
  section: loggerAppSections,
  reason?: string,
): Promise<void> {
  await useJobLogger({
    feature,
    action: "skipped",
    section,
    level: "debug",
    details: reason ? { reason } : undefined,
  });
}

/**
 * Convenience function for job error logs
 */
export async function logJobError(
  feature: string,
  section: loggerAppSections,
  error: unknown,
  details?: Record<string, unknown>,
): Promise<void> {
  await useJobLogger({
    feature,
    action: "failed",
    section,
    level: "error",
    raw: error,
    details: {
      ...details,
      error: error instanceof Error ? error.message : String(error),
    },
  });
}

/**
 * Convenience function for job batch progress logs
 */
export async function logJobBatch(
  feature: string,
  section: loggerAppSections,
  batchDetails: {
    batchNumber?: number;
    environmentId?: string;
    processedCount: number;
    totalCount?: number;
  },
): Promise<void> {
  await useJobLogger({
    feature,
    action: "batch",
    section,
    level: "trace",
    details: batchDetails,
  });
}
