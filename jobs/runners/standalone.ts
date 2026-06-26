/**
 * @file jobs/runners/standalone.ts
 * @description Standalone job runner
 */
/**
 * Standalone Job Runner
 *
 * Runs scheduled jobs as a completely separate process from the main HTTP server.
 * This is useful for production deployments where you want maximum isolation
 * between your web server and background job processing.
 *
 * Deployment Options:
 * 1. Single container with worker thread (recommended for small deployments)
 *    - Use: deno task start:worker
 *    - Jobs run in a Web Worker thread
 *
 * 2. Separate container/process (recommended for production)
 *    - Web server: deno task start (no jobs)
 *    - Job runner: deno task jobs:standalone
 *
 * Benefits of separate process:
 * - Complete isolation: Job failures don't affect HTTP server
 * - Independent scaling: Scale job runners separately from web servers
 * - Resource isolation: Jobs can use dedicated CPU/memory
 * - Easier monitoring: Separate logs and metrics
 * - Simpler restarts: Restart job runner without affecting users
 *
 * Usage:
 *   deno task jobs:standalone
 *   # or
 *   INSTANCE_ID=job-runner-1 deno run --allow-all jobs/standalone-runner.ts
 */

import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getInstanceId } from "@utils/instance-id.ts";
import { initializeLogContext } from "@logger/log-context.service.ts";
import { JOB_REGISTRY, jobRunsOn } from "../registry.ts";
import { envConfig } from "@config/env.ts";
import { assertBackupStorageSafe } from "@services/db-backup/preflight.ts";
import { assertObjectBackupStorageSafe } from "@services/object-backup/preflight.ts";

// Boot-time guard: refuse to run backups against local storage in non-dev.
// Same guard runs in main.ts for the HTTP process; the standalone runner is a
// separate process and must enforce it independently.
assertBackupStorageSafe({
  enabled: envConfig.backup.enabled,
  storageType: envConfig.storage.type,
  env: envConfig.env,
});

// Boot-time independence guard for object-storage backup (DD7, fail-closed).
// Same guard runs in main.ts for the HTTP process; the standalone runner is a
// separate process and must enforce it independently.
assertObjectBackupStorageSafe({
  enabled: envConfig.objectBackup.enabled,
  isDevOrTest: envConfig.isDevelopment || envConfig.isTest,
  nodeEnvExplicit: Deno.env.get("NODE_ENV") !== undefined,
  sourceType: envConfig.storage.type,
  sourceKey: envConfig.storage.key,
  sourceSecretKey: envConfig.storage.secretKey,
  destination: envConfig.backupStorage,
});

let runningCount = 0;

function withJobWrapper<T>(
  jobName: string,
  jobFn: () => Promise<T>,
  timeoutMs: number = 15 * 60 * 1000,
): () => Promise<void> {
  return async () => {
    const maxConcurrent = envConfig.workers.maxJobConcurrent;
    if (runningCount >= maxConcurrent) {
      await useLogger(
        LoggerLevels.warn,
        {
          message: `Job ${jobName} skipped: max concurrent jobs (${maxConcurrent}) reached`,
          section: loggerAppSections.TRACING,
          messageKey: "STANDALONE_JOB_CONCURRENCY_LIMIT",
          details: { jobName, runningCount, maxConcurrent },
        },
        true,
        true,
      );
      return;
    }

    runningCount++;
    const startTime = performance.now();

    try {
      await Promise.race([
        jobFn(),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Job execution timeout after ${timeoutMs}ms`)), timeoutMs)),
      ]);

      const durationMs = performance.now() - startTime;
      useLogger(
        LoggerLevels.info,
        {
          message: `Job ${jobName} completed in ${durationMs.toFixed(2)}ms`,
          section: loggerAppSections.TRACING,
          messageKey: "STANDALONE_JOB_COMPLETED",
        },
        true,
        true,
      );
    } catch (error) {
      const durationMs = performance.now() - startTime;

      await useLogger(LoggerLevels.error, {
        message: "Standalone job runner: Cron job failed",
        section: loggerAppSections.TRACING,
        messageKey: "STANDALONE_CRON_JOB_FAILED",
        details: {
          jobName,
          durationMs,
          instanceId: getInstanceId(),
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        raw: error,
      });

      throw error;
    } finally {
      runningCount--;
    }
  };
}

// =====================================
// Job Registration
// =====================================

function registerJobs(): void {
  useLogger(
    LoggerLevels.info,
    {
      message: `Registering scheduled jobs for standalone runner: ${getInstanceId()}`,
      section: loggerAppSections.TRACING,
      messageKey: "REGISTERING_STANDALONE_JOBS",
    },
    true,
    true,
  );

  // Register all jobs from the centralized registry
  let registered = 0;
  for (const job of JOB_REGISTRY) {
    // Skip jobs not assigned to the off-app (standalone) runner (see JobDefinition.runners).
    if (!jobRunsOn(job, "off-app")) continue;
    Deno.cron(
      job.name,
      job.schedule,
      withJobWrapper(job.name, job.handler, job.timeoutMs),
    );
    registered++;
  }

  useLogger(
    LoggerLevels.info,
    {
      message: `Scheduled jobs registered - ${registered} jobs`,
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_JOBS_REGISTERED",
    },
    true,
    true,
  );
}

// =====================================
// Graceful Shutdown
// =====================================

let isShuttingDown = false;

function handleShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  useLogger(
    LoggerLevels.info,
    {
      message: `Received ${signal}, shutting down standalone job runner...`,
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_SHUTDOWN",
    },
    true,
    true,
  );

  // Deno.cron jobs will stop automatically when the process exits
  useLogger(
    LoggerLevels.info,
    {
      message: "Standalone job runner shutdown complete",
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_SHUTDOWN_COMPLETE",
    },
    true,
    true,
  );
  Deno.exit(0);
}

// Register shutdown handlers
Deno.addSignalListener("SIGTERM", () => handleShutdown("SIGTERM"));
Deno.addSignalListener("SIGINT", () => handleShutdown("SIGINT"));

// =====================================
// Health Check HTTP Server (Optional)
// =====================================

const healthCheckPort = parseInt(Deno.env.get("JOB_RUNNER_HEALTH_PORT") || "9090");

function startHealthCheckServer(): void {
  Deno.serve({ port: healthCheckPort }, (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(
        JSON.stringify({
          status: "healthy",
          service: "job-runner",
          instanceId: getInstanceId(),
          uptime: performance.now(),
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response("Not Found", { status: 404 });
  });

  useLogger(
    LoggerLevels.info,
    {
      message: `Health check server listening on port ${healthCheckPort}`,
      section: loggerAppSections.TRACING,
      messageKey: "HEALTH_CHECK_SERVER_STARTED",
    },
    true,
    true,
  );
}

// =====================================
// Main Entry Point
// =====================================

async function main(): Promise<void> {
  useLogger(
    LoggerLevels.info,
    {
      message: "═".repeat(60),
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_HEADER",
    },
    true,
    true,
  );

  useLogger(
    LoggerLevels.info,
    {
      message: "🔧 STANDALONE JOB RUNNER",
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_TITLE",
    },
    true,
    true,
  );

  useLogger(
    LoggerLevels.info,
    {
      message: "═".repeat(60),
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_HEADER_END",
    },
    true,
    true,
  );

  useLogger(
    LoggerLevels.info,
    {
      message: `Instance ID: ${getInstanceId()}`,
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_INSTANCE_ID",
    },
    true,
    true,
  );

  useLogger(
    LoggerLevels.info,
    {
      message: `Started at: ${new Date().toISOString()}`,
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_STARTED_AT",
    },
    true,
    true,
  );

  // Initialize logging context
  initializeLogContext(getInstanceId());

  // Register all scheduled jobs
  registerJobs();

  // Start health check server
  await startHealthCheckServer();

  useLogger(
    LoggerLevels.info,
    {
      message: "═".repeat(60),
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_FOOTER_START",
    },
    true,
    true,
  );

  useLogger(
    LoggerLevels.info,
    {
      message: "✅ Standalone job runner is now active",
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_ACTIVE",
    },
    true,
    true,
  );

  useLogger(
    LoggerLevels.info,
    {
      message: "Jobs will execute according to their cron schedules",
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_SCHEDULE_INFO",
    },
    true,
    true,
  );

  useLogger(
    LoggerLevels.info,
    {
      message: "Press Ctrl+C to stop",
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_STOP_INSTRUCTION",
    },
    true,
    true,
  );

  useLogger(
    LoggerLevels.info,
    {
      message: "═".repeat(60),
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_FOOTER_END",
    },
    true,
    true,
  );

  // Keep the process running
  // Deno.cron runs in the background, but we need to keep the process alive
  await new Promise(() => {}); // Never resolves, keeps process running
}

// Run the main function
main().catch((error) => {
  useLogger(
    LoggerLevels.critical,
    {
      message: "Fatal error in standalone job runner",
      section: loggerAppSections.TRACING,
      messageKey: "STANDALONE_RUNNER_FATAL_ERROR",
      raw: error,
    },
    true,
    true,
  );
  Deno.exit(1);
});
