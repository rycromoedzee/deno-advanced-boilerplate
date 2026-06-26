/**
 * @file jobs/registry.ts
 * @description Central registry of all scheduled job definitions
 */
/**
 * Job Registry - Centralized Job Definitions
 *
 * Single source of truth for all scheduled jobs in the application.
 * This registry is used by all three execution modes:
 * - Inline mode (jobs/index.ts)
 * - Worker mode (jobs/worker.ts)
 * - Standalone mode (jobs/standalone-runner.ts)
 *
 * Each mode imports this registry and applies its own wrapper/error handling.
 *
 * Schedule expressions are validated for firing collisions by
 * `scripts/verify-job-overlaps.ts` (`deno task jobs:check-overlaps`).
 *
 * Benefits:
 * - DRY principle: Job definitions in one place
 * - Type safety: Interface enforces consistency
 * - Easy maintenance: Add/modify jobs in one location
 * - Self-documenting: Schedule + description together
 */

import { cleanupExpiredTraces } from "./trace-cleanup.job.ts";
import { cleanupUploadSessions } from "./upload-session-cleanup.job.ts";
import { updateThreatIntelligenceSources } from "./threat-intelligence-sources.job.ts";
import { cleanupInactiveThreatEntries } from "./threat-intelligence-cleanup.job.ts";
import { cleanupDismissedNotifications } from "./notifications-cleanup.job.ts";
import { cleanupExpiredRefreshTokens } from "./refresh-token-cleanup.job.ts";
import { runDbBackup } from "./db-backup.job.ts";
import { runObjectStorageBackup } from "./object-storage-backup.job.ts";
import { envConfig } from "@config/env.ts";

/**
 * Where a job's runner lives relative to the main application process.
 *
 * - `"in-app"`: the in-process runner embedded in the main application. Covers
 *   BOTH `JOB_MODE=worker` (Web Worker thread) and `JOB_MODE=inline` (HTTP-driven
 *   scheduler dispatching to that worker). Hard-caps every job at 15 minutes.
 * - `"off-app"`: the dedicated standalone process (`deno task jobs:standalone`),
 *   separate from the main application server. Honours per-job `timeoutMs`
 *   (no 15-min cap).
 */
export type JobRunnerLocation = "in-app" | "off-app";

/** All known runner locations — the implicit default allowlist when `runners` is omitted. */
export const ALL_JOB_RUNNERS: readonly JobRunnerLocation[] = ["in-app", "off-app"] as const;

/**
 * Job Definition Interface
 *
 * Defines the structure for all scheduled jobs
 */
export interface JobDefinition {
  /** Unique identifier for the job */
  name: string;

  /** Cron expression for job schedule (e.g., "0 2 * * *" for daily at 2 AM) */
  schedule: string;

  /** The job function to execute */
  handler: () => Promise<unknown>;

  /** Human-readable description of the job */
  description?: string;

  /** Maximum execution time in milliseconds (default: 15 minutes) */
  timeoutMs?: number;

  /**
   * Which runners are allowed to execute this job. When omitted, the job runs on
   * ALL runners (backwards-compatible default). Use this to keep heavy or
   * long-running jobs off the in-process runner embedded in the main application
   * — e.g. `runners: ["off-app"]` so the job only fires on the dedicated
   * standalone process (which honours `timeoutMs` instead of the in-app 15-min cap).
   */
  runners?: readonly JobRunnerLocation[];
}

/**
 * Whether a job is allowed to run on the given runner.
 *
 * A job with no `runners` field runs everywhere. Each runner calls this when
 * registering jobs so an excluded job is never scheduled on it.
 *
 * When `JOBS_ENFORCE_RUNNER_ALLOWLIST=false` the allowlist is bypassed entirely
 * and every job runs on whatever runner is active — convenient for small or
 * single-process deployments that just run everything in the main application.
 */
export function jobRunsOn(job: JobDefinition, runner: JobRunnerLocation): boolean {
  if (!envConfig.enforceJobRunnerAllowlist) return true;
  return job.runners === undefined || job.runners.includes(runner);
}

/**
 * Job Registry - All scheduled jobs defined here
 *
 * Schedules are staggered so no two jobs share a firing minute (verified by
 * `deno task jobs:check-overlaps`). Daily maintenance is spread across the
 * 2-5 AM UTC window; formerly-hourly housekeeping jobs run daily or every 6h.
 *
 * To add a new job:
 * 1. Create the job file in jobs/ (e.g., jobs/my-job.ts)
 * 2. Import the job function above
 * 3. Add entry to JOB_REGISTRY array below
 * 4. Run `deno task jobs:check-overlaps` to confirm no firing collisions
 *
 * The job will automatically be registered in all execution modes.
 */
export const JOB_REGISTRY: readonly JobDefinition[] = [
  //
  // UTILS RELATED
  {
    name: "db-backup",
    schedule: "0 3 * * *", // At 03:00.
    handler: runDbBackup,
    description: "Daily gzipped SQL-dump backups of Global DB and all tenant DBs",
    timeoutMs: envConfig.backup.jobTimeoutMs,
    runners: ["off-app"],
  },
  {
    name: "object-storage-backup",
    schedule: "15 1-23/2 * * *", // At minute 15 past every 2nd hour from 1 through 23
    handler: runObjectStorageBackup,
    description: "Incremental off-site copy of tenant object storage",
    timeoutMs: envConfig.objectBackup.jobTimeoutMs,
    runners: ["off-app"],
  },
  {
    name: "cleanup-expired-traces",
    schedule: "0 2 * * *", // At 02:00.
    handler: cleanupExpiredTraces,
    description: "Cleans up expired trace logs - runs daily at 2 AM UTC",
    timeoutMs: 15 * 60 * 1000,
  },
  //
  // UPLOAD RELATED
  {
    name: "cleanup-upload-sessions",
    schedule: "15 */6 * * *", // At minute 15 past every 6th hour.
    handler: cleanupUploadSessions,
    description: "Reclaims orphaned temp-chunk storage for expired sessions - runs every 6h (24h session TTL)",
    timeoutMs: 15 * 60 * 1000,
  },
  //
  // THREAT INTEL RELATED
  {
    name: "update-threat-intelligence-sources",
    schedule: "45 */6 * * *", // At minute 45 past every 6th hour
    handler: updateThreatIntelligenceSources,
    description: "Polls threat sources and updates any past their per-source frequency - runs every 6h (default 24h)",
    timeoutMs: 10 * 60 * 1000, // 10 minutes
  },
  {
    name: "cleanup-inactive-threat-entries",
    schedule: "0 4 * * *", // At 04:00
    handler: cleanupInactiveThreatEntries,
    description: "Hard-deletes inactive threat entries older than retention - runs daily at 4 AM UTC",
    timeoutMs: 30 * 60 * 1000,
  },
  //
  // USER RELATED
  {
    name: "cleanup-dismissed-notifications",
    schedule: "30 3 * * *", // At 03:30
    handler: cleanupDismissedNotifications,
    description: "Deletes dismissed notifications older than retention period - runs daily at 3:30 AM UTC",
    timeoutMs: 15 * 60 * 1000,
  },
  //
  // AUTH RELATED
  {
    name: "cleanup-expired-refresh-tokens",
    schedule: "0 5 * * *", // // At 05:00
    handler: cleanupExpiredRefreshTokens,
    description: "Deletes expired refresh tokens from global DB - runs daily at 5 AM UTC (housekeeping, not correctness)",
    timeoutMs: 15 * 60 * 1000,
  },
] as const;

/**
 * Default timeout for jobs (15 minutes)
 */
export const DEFAULT_JOB_TIMEOUT_MS = 15 * 60 * 1000;
