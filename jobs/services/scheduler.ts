/**
 * @file jobs/services/scheduler.ts
 * @description Scheduler job service
 */
/**
 * Job Scheduler
 *
 * Manages job scheduling strategies:
 * 1. Worker Mode - Deno.cron in Web Worker thread (default, for persistent servers)
 * 2. Event-Driven Inline Mode - Jobs triggered by HTTP requests (for scale-to-zero environments)
 */

import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getLastRun, updateLastRun } from "./job-state.service.ts";
import { envConfig } from "@config/env.ts";

// =====================================
// Cron Parser
// =====================================

/**
 * Simple cron parser for basic intervals (supports * and / syntax)
 * Note: For complex cron expressions, we might need a more robust parser library
 * but for our current needs (hourly, daily), this simple check is sufficient
 */
function isCronDue(cronExpression: string, lastRun: number | undefined, now: Date): boolean {
  // If never ran, it's due (but maybe we want to align with the schedule?)
  // For now, let's say if it never ran in this instance, we check if it matches the time

  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.split(" ");

  // Helper to check if a field matches
  const matches = (value: number, expression: string) => {
    if (expression === "*") return true;
    if (expression.includes("/")) {
      const [, interval] = expression.split("/");
      return value % parseInt(interval) === 0;
    }
    return parseInt(expression) === value;
  };

  const isTimeMatch = matches(now.getMinutes(), minute) &&
    matches(now.getHours(), hour) &&
    matches(now.getDate(), dayOfMonth) &&
    matches(now.getMonth() + 1, month) &&
    matches(now.getDay(), dayOfWeek);

  // To prevent running multiple times within the same minute if called frequently
  if (isTimeMatch && lastRun) {
    const lastRunDate = new Date(lastRun);
    if (
      lastRunDate.getMinutes() === now.getMinutes() &&
      lastRunDate.getHours() === now.getHours() &&
      lastRunDate.getDate() === now.getDate()
    ) {
      return false;
    }
  }

  return isTimeMatch;
}

/**
 * Get the most recent time this cron schedule should have triggered
 *
 * This searches backward from current time to find when the job should have last run.
 * If lastRun is before that time (or null), the job is overdue.
 *
 * Examples:
 * - "0 2 * * *" at 12:00 PM → last scheduled = today at 2:00 AM
 * - "0 2 * * *" at 1:00 AM → last scheduled = yesterday at 2:00 AM
 * - "0 * * * *" at 3:45 PM → last scheduled = today at 3:00 PM
 * - "0 2 * * 1" (Mon) on Wed → last scheduled = last Monday at 2:00 AM
 *
 * Note: All times are in UTC (cron expressions are evaluated in UTC)
 */
function getMostRecentScheduledTime(cronExpression: string, now: Date): Date {
  const [minuteExpr, hourExpr, dayOfMonthExpr, monthExpr, dayOfWeekExpr] = cronExpression.split(" ");

  // Helper to check if a value matches a cron expression
  const matches = (value: number, expression: string): boolean => {
    if (expression === "*") return true;
    if (expression.includes("/")) {
      const [base, interval] = expression.split("/");
      const intervalNum = parseInt(interval);
      if (base === "*") {
        return value % intervalNum === 0;
      }
      return (value - parseInt(base)) % intervalNum === 0;
    }
    if (expression.includes(",")) {
      return expression.split(",").some((val) => parseInt(val) === value);
    }
    if (expression.includes("-")) {
      const [start, end] = expression.split("-").map((v) => parseInt(v));
      return value >= start && value <= end;
    }
    return parseInt(expression) === value;
  };

  // Start from current time and work backwards
  // We'll search up to 60 days in the past (covers monthly schedules)
  const candidate = new Date(now);
  candidate.setUTCSeconds(0);
  candidate.setUTCMilliseconds(0);

  // Maximum iterations to prevent infinite loops (60 days * 24 hours * 60 minutes)
  const maxIterations = 60 * 24 * 60;

  for (let i = 0; i < maxIterations; i++) {
    // Use UTC methods to avoid timezone issues
    const matchesMinute = matches(candidate.getUTCMinutes(), minuteExpr);
    const matchesHour = matches(candidate.getUTCHours(), hourExpr);
    const matchesDay = matches(candidate.getUTCDate(), dayOfMonthExpr);
    const matchesMonth = matches(candidate.getUTCMonth() + 1, monthExpr);
    const matchesDayOfWeek = matches(candidate.getUTCDay(), dayOfWeekExpr);

    // Cron uses AND logic: all fields must match
    if (matchesMinute && matchesHour && matchesDay && matchesMonth && matchesDayOfWeek) {
      return candidate;
    }

    // Move back one minute using UTC
    candidate.setUTCMinutes(candidate.getUTCMinutes() - 1);
  }

  // Fallback: if we can't find a match, return a very old date so job will trigger
  return new Date(0);
}

/**
 * Check if a job is overdue (should have run but hasn't)
 *
 * A job is overdue if:
 * 1. It has never run (lastRun is null)
 * 2. The last run was before the most recent scheduled time
 *
 * Examples:
 * - Schedule "0 2 * * *" (daily at 2 AM), now is 12 PM, lastRun = yesterday 5 PM → OVERDUE
 * - Schedule "0 2 * * *" (daily at 2 AM), now is 12 PM, lastRun = today 2:05 AM → NOT overdue
 * - Schedule "0 * * * *" (hourly), now is 3:45 PM, lastRun = 2:30 PM → OVERDUE (missed 3:00)
 */
function isJobOverdue(schedule: string, lastRun: number | null): boolean {
  // If never ran before, it's overdue (should run on first opportunity)
  if (!lastRun) {
    useLogger(
      LoggerLevels.info,
      {
        message: `Job marked overdue (never ran before)`,
        section: loggerAppSections.TRACING,
        messageKey: "JOB_OVERDUE_NEVER_RAN",
        details: { schedule },
      },
      true,
      true,
    );
    return true;
  }

  const now = new Date();
  const lastRunDate = new Date(lastRun);
  const mostRecentScheduledTime = getMostRecentScheduledTime(schedule, now);

  // Job is overdue if it last ran before the most recent scheduled time
  return lastRunDate < mostRecentScheduledTime;
}

// =====================================
// Job Scheduler
// =====================================

interface ScheduledJob {
  name: string;
  schedule: string;
  handler?: () => Promise<void>;
  lastRun?: number;
  isRunning: boolean;
}

class JobScheduler {
  private jobs: ScheduledJob[] = [];
  private isCheckingJobs = false; // Prevent concurrent checks
  private dispatch?: (jobName: string) => void;

  constructor() {
    useLogger(
      LoggerLevels.info,
      {
        message: `Job scheduler initialized in ${envConfig.jobType} mode`,
        section: loggerAppSections.TRACING,
        messageKey: "JOB_SCHEDULER_INITIALIZED",
      },
      true,
      true,
    );
  }

  /**
   * Route due jobs to a worker instead of executing them on the main thread.
   * Must be called after spawnJobWorker() in inline mode.
   */
  setDispatch(fn: (jobName: string) => void) {
    this.dispatch = fn;
  }

  /**
   * Register a job for scheduling.
   * In worker mode this is a no-op — jobs are registered inside the worker.
   * In inline mode the job is stored so checkAndRunJobs() can detect when it's due.
   */
  async register(name: string, schedule: string, handler?: () => Promise<void>) {
    if (envConfig.jobType === "worker") {
      useLogger(
        LoggerLevels.info,
        {
          message: `Job registered for worker mode: ${name} (${schedule})`,
          section: loggerAppSections.TRACING,
          messageKey: "JOB_REGISTERED_WORKER",
        },
        true,
        true,
      );
    } else if (envConfig.jobType === "inline") {
      useLogger(
        LoggerLevels.info,
        {
          message: `Registering event-driven job: ${name} (${schedule})`,
          section: loggerAppSections.TRACING,
          messageKey: "EVENT_DRIVEN_JOB_REGISTERED",
        },
        true,
        true,
      );

      const lastRun = await getLastRun(name);

      this.jobs.push({
        name,
        schedule,
        handler,
        lastRun: lastRun ?? undefined,
        isRunning: false,
      });
    }
  }

  /**
   * Checks all registered jobs and runs them if they are due.
   * This should be called by middleware or an external trigger.
   *
   * Performance optimizations:
   * - Early exit if already checking or all jobs running
   * - Single Date object creation per check
   * - Debounce mechanism to prevent redundant checks
   */
  async checkAndRunJobs() {
    if (envConfig.jobType === "worker") return; // Worker mode doesn't need this

    if (envConfig.jobType === "none") return; // If Jobs are turned off

    // Prevent concurrent checks (debounce)
    if (this.isCheckingJobs) return;

    // Early exit: Check if any jobs need checking
    if (this.jobs.length === 0) return;

    // Early exit: If all jobs are currently running, skip check
    const hasIdleJob = this.jobs.some((job) => !job.isRunning);
    if (!hasIdleJob) return;

    this.isCheckingJobs = true;

    try {
      const now = Date.now();
      const nowDate = new Date(now); // Single Date object for all checks
      const promises: Promise<void>[] = [];

      for (const job of this.jobs) {
        // Skip if already running
        if (job.isRunning) continue;

        // Check if job is due OR overdue
        const isDue = isCronDue(job.schedule, job.lastRun, nowDate);
        const isOverdue = isJobOverdue(job.schedule, job.lastRun ?? null);

        if (isDue || isOverdue) {
          job.lastRun = now;

          if (this.dispatch) {
            // Dispatch to worker — execution and DB state updates happen off the main thread
            await useLogger(LoggerLevels.info, {
              message: `Dispatching job to worker: ${job.name}${isOverdue ? " (overdue catch-up)" : ""}`,
              section: loggerAppSections.TRACING,
              messageKey: "JOB_DISPATCHED_TO_WORKER",
              details: { jobName: job.name, isOverdue },
            });
            this.dispatch(job.name);
          } else {
            // Fallback: run inline on the main thread (no dispatch set)
            job.isRunning = true;

            const jobPromise = (async () => {
              try {
                await useLogger(LoggerLevels.info, {
                  message: `Triggering event-driven job: ${job.name}${isOverdue ? " (overdue catch-up)" : ""}`,
                  section: loggerAppSections.TRACING,
                  messageKey: "JOB_TRIGGERED",
                  details: { jobName: job.name, isOverdue, lastRun: job.lastRun },
                });

                await job.handler!();

                if (job.lastRun !== undefined) {
                  await updateLastRun(job.name, new Date(job.lastRun), "success");
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                await useLogger(LoggerLevels.error, {
                  message: `Job ${job.name} failed: ${errorMessage}`,
                  section: loggerAppSections.TRACING,
                  messageKey: "JOB_FAILED",
                  details: {
                    jobName: job.name,
                    error: errorMessage,
                    stack: error instanceof Error ? error.stack : undefined,
                  },
                });

                if (job.lastRun !== undefined) {
                  await updateLastRun(job.name, new Date(job.lastRun), "error", errorMessage);
                }
              } finally {
                job.isRunning = false;
              }
            })();

            promises.push(jobPromise);
          }
        }
      }

      // We return the promises but usually the caller (middleware) won't wait for them
      // to avoid slowing down the response
      return Promise.allSettled(promises);
    } finally {
      // Release the lock after a delay to prevent excessive checks
      // 5 seconds is reasonable for cron-style schedules (minute/hour/day intervals)
      setTimeout(() => {
        this.isCheckingJobs = false;
      }, 30000); // 30 second debounce
    }
  }

  /**
   * Get the current mode of the scheduler
   */
  getMode() {
    return envConfig.jobType;
  }

  /**
   * Get all registered jobs (for debugging/monitoring)
   */
  getJobs(): ScheduledJob[] {
    return [...this.jobs];
  }
}

export const scheduler = new JobScheduler();
