/**
 * @file middleware/job-trigger.middleware.ts
 * @description Job Trigger middleware
 */
/**
 * Job Trigger Middleware
 *
 * Triggers event-driven jobs on each HTTP request.
 * This middleware enables scale-to-zero functionality by checking and running
 * overdue jobs whenever the application receives a request.
 *
 * Usage:
 *   import { jobTriggerMiddleware } from '@middleware/job-trigger.middleware.ts';
 *   app.use(jobTriggerMiddleware);
 */

import type { HonoContext, HonoNext } from "@deps";
import { scheduler } from "@jobs/services/scheduler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

/**
 * Middleware that triggers event-driven jobs on each request
 *
 * This middleware is non-blocking - it fires and forgets, allowing
 * the request to continue without waiting for job execution.
 *
 * Only active when JOB_MODE=inline (event-driven mode)
 */
export function jobTriggerMiddleware(_c: HonoContext, next: HonoNext) {
  // if jobs are done through worker continue
  if (scheduler.getMode() === "worker") {
    return next();
  }

  // if jobs are run when HTTP requests are made
  // Jobs run in the background
  scheduler.checkAndRunJobs().catch((error) => {
    useLogger(LoggerLevels.error, {
      message: "Failed to check and run jobs",
      section: loggerAppSections.TRACING,
      messageKey: "JOB_TRIGGER_MIDDLEWARE_ERROR",
      details: { error: String(error) },
    });
  });

  return next();
}
