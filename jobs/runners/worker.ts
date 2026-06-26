/**
 * @file jobs/runners/worker.ts
 * @description Worker job runner
 */
/**
 * Job Worker - Background Job Processing Worker
 *
 * This worker runs scheduled jobs in a separate thread, keeping the main
 * HTTP server thread free to handle requests. It communicates with the
 * main thread via message passing.
 *
 * Features:
 * - Runs jobs using Deno.cron in an isolated context
 * - Reports job status back to main thread
 * - Handles graceful shutdown
 * - Maintains job execution history
 *
 * Usage:
 *   const worker = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" });
 *   worker.postMessage({ type: "INIT", payload: { instanceId: "instance-123" } });
 */

/// <reference lib="deno.worker" />

import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { JOB_REGISTRY, jobRunsOn } from "../registry.ts";
import { updateLastRun } from "../services/job-state.service.ts";
import type { JobStatus, MainToWorkerMessage, WorkerStatus, WorkerToMainMessage } from "../types/worker-messages.ts";

// Declare worker global scope for TypeScript
declare const self: DedicatedWorkerGlobalScope;

// =====================================
// Worker State
// =====================================

let instanceId = "";
let isRunning = false;
let startedAt = 0;
let lastActivity = 0;
let workerMode: "cron" | "inline" = "cron";
let maxConcurrent = 3;
let runningCount = 0;

interface RegisteredJob {
  name: string;
  schedule: string;
  handler: () => Promise<void>;
  lastRun?: number;
  isRunning: boolean;
  lastError?: string;
}

const registeredJobs: Map<string, RegisteredJob> = new Map();

// =====================================
// Message Sending Helper
// =====================================

function sendMessage(msg: WorkerToMainMessage): void {
  self.postMessage(msg);
  lastActivity = Date.now();
}

// =====================================
// Job Wrapper with Worker-Specific Handling
// =====================================

function createJobHandler(jobName: string, jobFn: () => Promise<unknown>, timeoutMs = 15 * 60 * 1000): () => Promise<void> {
  return async () => {
    const job = registeredJobs.get(jobName);
    if (!job) return;

    // Prevent concurrent execution of the same job
    if (job.isRunning) {
      await useLogger(
        LoggerLevels.info,
        {
          message: `Job ${jobName} already running, skipping`,
          section: loggerAppSections.TRACING,
          messageKey: "WORKER_JOB_ALREADY_RUNNING",
          details: { jobName },
        },
        true,
        true,
      );
      return;
    }

    // Enforce global concurrency cap across all jobs
    if (runningCount >= maxConcurrent) {
      await useLogger(
        LoggerLevels.warn,
        {
          message: `Job ${jobName} skipped: max concurrent jobs (${maxConcurrent}) reached`,
          section: loggerAppSections.TRACING,
          messageKey: "WORKER_JOB_CONCURRENCY_LIMIT",
          details: { jobName, runningCount, maxConcurrent },
        },
        true,
        true,
      );
      return;
    }

    job.isRunning = true;
    runningCount++;
    job.lastRun = Date.now();
    const startTime = performance.now();

    sendMessage({
      type: "JOB_STARTED",
      payload: { jobName, timestamp: job.lastRun },
    });

    try {
      await Promise.race([
        jobFn(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Job execution timeout after ${timeoutMs}ms`)), timeoutMs)),
      ]);

      const duration = performance.now() - startTime;
      job.lastError = undefined;

      if (workerMode === "inline") {
        await updateLastRun(jobName, new Date(job.lastRun!), "success");
      }

      sendMessage({
        type: "JOB_COMPLETED",
        payload: { jobName, duration, success: true },
      });
    } catch (error) {
      const duration = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      job.lastError = errorMessage;

      if (workerMode === "inline") {
        await updateLastRun(jobName, new Date(job.lastRun!), "error", errorMessage);
      }

      sendMessage({
        type: "JOB_ERROR",
        payload: { jobName, error: errorMessage, stack: errorStack },
      });

      await useLogger(LoggerLevels.error, {
        message: "Worker: Cron job failed",
        section: loggerAppSections.TRACING,
        messageKey: "WORKER_CRON_JOB_FAILED",
        details: {
          jobName,
          durationMs: duration,
          errorMessage,
          errorStack,
        },
        raw: error,
      });
    } finally {
      job.isRunning = false;
      runningCount--;
    }
  };
}

// =====================================
// Job Registration & Initialization
// =====================================

function registerJob(name: string, schedule: string, handler: () => Promise<unknown>): void {
  const wrappedHandler = createJobHandler(name, handler);

  registeredJobs.set(name, {
    name,
    schedule,
    handler: wrappedHandler,
    isRunning: false,
  });

  // In cron mode use Deno.cron for scheduling; in inline mode the main thread triggers via TRIGGER_JOB
  if (workerMode === "cron") {
    Deno.cron(name, schedule, wrappedHandler);
  }

  useLogger(
    LoggerLevels.info,
    {
      message: `Worker registered job: ${name} (${schedule})`,
      section: loggerAppSections.TRACING,
      messageKey: "WORKER_JOB_REGISTERED",
    },
    true,
    true,
  );
}

function initializeJobs(): void {
  // Register all jobs from the centralized registry
  for (const job of JOB_REGISTRY) {
    // Skip jobs not assigned to the in-app runner (see JobDefinition.runners).
    // The in-app runner hosts both JOB_MODE=worker and JOB_MODE=inline execution.
    if (!jobRunsOn(job, "in-app")) continue;
    registerJob(job.name, job.schedule, job.handler);
  }

  useLogger(
    LoggerLevels.info,
    {
      message: `Worker: Scheduled jobs initialized (${registeredJobs.size} jobs)`,
      section: loggerAppSections.TRACING,
      messageKey: "WORKER_JOBS_INITIALIZED",
    },
    true,
    true,
  );
}

// =====================================
// Worker Status
// =====================================

function getWorkerStatus(): WorkerStatus {
  const jobs: JobStatus[] = Array.from(registeredJobs.values()).map((job) => ({
    name: job.name,
    schedule: job.schedule,
    lastRun: job.lastRun,
    isRunning: job.isRunning,
    lastError: job.lastError,
  }));

  return {
    instanceId,
    isRunning,
    jobs,
    startedAt,
    lastActivity,
  };
}

// =====================================
// Manual Job Trigger
// =====================================

async function triggerJob(jobName: string): Promise<void> {
  const job = registeredJobs.get(jobName);
  if (!job) {
    sendMessage({
      type: "ERROR",
      payload: { error: `Job not found: ${jobName}` },
    });
    return;
  }

  // Run the job handler directly
  await job.handler();
}

// =====================================
// Message Handler
// =====================================

async function handleMessage(event: MessageEvent<MainToWorkerMessage>): Promise<void> {
  const msg = event.data;

  switch (msg.type) {
    case "INIT": {
      instanceId = msg.payload.instanceId;
      workerMode = msg.payload.mode;
      maxConcurrent = msg.payload.maxConcurrent;
      startedAt = Date.now();
      isRunning = true;

      try {
        initializeJobs();
        sendMessage({
          type: "INITIALIZED",
          payload: { jobCount: registeredJobs.size },
        });
      } catch (error) {
        sendMessage({
          type: "ERROR",
          payload: { error: error instanceof Error ? error.message : String(error) },
        });
      }
      break;
    }

    case "SHUTDOWN": {
      await useLogger(
        LoggerLevels.info,
        {
          message: "Worker: Received shutdown signal",
          section: loggerAppSections.TRACING,
          messageKey: "WORKER_SHUTDOWN_SIGNAL",
        },
        true,
        true,
      );
      isRunning = false;
      sendMessage({ type: "SHUTDOWN_COMPLETE" });
      self.close();
      break;
    }

    case "TRIGGER_JOB": {
      await triggerJob(msg.payload.jobName);
      break;
    }

    case "GET_STATUS": {
      sendMessage({
        type: "STATUS",
        payload: getWorkerStatus(),
      });
      break;
    }
  }
}

// =====================================
// Worker Entry Point
// =====================================

// Signal that worker is ready to receive messages
sendMessage({ type: "READY" });

// Listen for messages from main thread
self.onmessage = handleMessage;
