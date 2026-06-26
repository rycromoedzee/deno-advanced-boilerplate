/**
 * @file jobs/runners/index.ts
 * @description Barrel exports for job runners
 */
/**
 * Job runner — manages the worker thread lifecycle and job initialization.
 *
 * Modes (JOB_MODE env var):
 * - worker: Deno.cron runs inside the worker on its own schedule
 * - inline: HTTP requests trigger schedule checks; due jobs are dispatched to the worker
 * - none:   Jobs disabled
 */

import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { JOB_REGISTRY, jobRunsOn } from "../registry.ts";
import { scheduler } from "../services/scheduler.ts";
import type { MainToWorkerMessage, WorkerStatus, WorkerToMainMessage } from "../types/worker-messages.ts";
import { envConfig } from "@config/env.ts";

let jobWorker: Worker | null = null;
let workerStatus: WorkerStatus | null = null;
let workerReadyPromise: Promise<void> | null = null;
let workerReadyResolve: (() => void) | null = null;

function spawnJobWorker(instanceId: string, mode: "cron" | "inline"): Promise<void> {
  if (jobWorker) {
    useLogger(
      LoggerLevels.warn,
      {
        message: "Job worker already running",
        section: loggerAppSections.TRACING,
        messageKey: "JOB_WORKER_ALREADY_RUNNING",
      },
      true,
      true,
    );
    return workerReadyPromise ?? Promise.resolve();
  }

  workerReadyPromise = new Promise<void>((resolve) => {
    workerReadyResolve = resolve;
  });

  jobWorker = new Worker(new URL("./worker.ts", import.meta.url).href, {
    type: "module",
    deno: { permissions: "inherit" },
  });

  jobWorker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case "READY":
        jobWorker?.postMessage(
          {
            type: "INIT",
            payload: { instanceId, mode, maxConcurrent: envConfig.workers.maxJobConcurrent },
          } satisfies MainToWorkerMessage,
        );
        break;
      case "INITIALIZED":
        workerReadyResolve?.();
        break;
      case "STATUS":
        workerStatus = msg.payload;
        break;
      case "SHUTDOWN_COMPLETE":
        useLogger(
          LoggerLevels.info,
          {
            message: "Job worker shutdown complete",
            section: loggerAppSections.TRACING,
            messageKey: "JOB_WORKER_SHUTDOWN_COMPLETE",
          },
          true,
          true,
        );
        jobWorker = null;
        break;
      case "ERROR":
        useLogger(
          LoggerLevels.error,
          {
            message: `[Worker] Error: ${msg.payload.error}`,
            section: loggerAppSections.TRACING,
            messageKey: "WORKER_ERROR",
            details: { error: msg.payload.error },
          },
          true,
          true,
        );
        break;
    }
  };

  jobWorker.onerror = (error) => {
    useLogger(
      LoggerLevels.error,
      {
        message: "Job worker error",
        section: loggerAppSections.TRACING,
        messageKey: "JOB_WORKER_ERROR",
        raw: error,
      },
      true,
      true,
    );
  };

  return workerReadyPromise;
}

async function terminateJobWorker(): Promise<void> {
  if (!jobWorker) return;

  useLogger(
    LoggerLevels.info,
    {
      message: "Terminating job worker...",
      section: loggerAppSections.TRACING,
      messageKey: "TERMINATING_JOB_WORKER",
    },
    true,
    true,
  );

  jobWorker.postMessage({ type: "SHUTDOWN" } satisfies MainToWorkerMessage);

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      useLogger(
        LoggerLevels.warn,
        {
          message: "Job worker didn't shutdown gracefully, forcing termination",
          section: loggerAppSections.TRACING,
          messageKey: "JOB_WORKER_FORCE_TERMINATION",
        },
        true,
        true,
      );
      jobWorker?.terminate();
      jobWorker = null;
      resolve();
    }, 5000);

    const checkInterval = setInterval(() => {
      if (!jobWorker) {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });
}

export function triggerJob(jobName: string): void {
  if (!jobWorker) {
    useLogger(
      LoggerLevels.error,
      {
        message: "Cannot trigger job: worker not running",
        section: loggerAppSections.TRACING,
        messageKey: "CANNOT_TRIGGER_JOB_NO_WORKER",
        details: { jobName },
      },
      true,
      true,
    );
    return;
  }
  jobWorker.postMessage({ type: "TRIGGER_JOB", payload: { jobName } } satisfies MainToWorkerMessage);
}

export function getJobWorkerStatus(): WorkerStatus | null {
  if (!jobWorker) return null;
  jobWorker.postMessage({ type: "GET_STATUS" } satisfies MainToWorkerMessage);
  return workerStatus;
}

export function isWorkerModeEnabled(): boolean {
  return envConfig.jobType === "worker";
}

export async function initializeJobs(instanceId: string): Promise<void> {
  useLogger(
    LoggerLevels.info,
    {
      message: `Job system initializing in ${envConfig.jobType} mode`,
      section: loggerAppSections.TRACING,
      messageKey: "JOB_SYSTEM_INITIALIZING",
    },
    true,
    true,
  );

  if (envConfig.jobType === "worker") {
    await spawnJobWorker(instanceId, "cron");
  } else if (envConfig.jobType === "inline") {
    await spawnJobWorker(instanceId, "inline");
    for (const job of JOB_REGISTRY) {
      // Skip jobs not assigned to the in-app runner (inline mode dispatches to
      // that same in-process worker). See JobDefinition.runners.
      if (!jobRunsOn(job, "in-app")) continue;
      await scheduler.register(job.name, job.schedule);
    }
    scheduler.setDispatch(triggerJob);
  }
}

export async function shutdownJobs(): Promise<void> {
  if (jobWorker) {
    await terminateJobWorker();
  }
}
