/**
 * @file constants/errors/jobs.ts
 * @description Job-specific error definitions for the background jobs system
 */

import type { ErrorDefinition } from "./types.ts";

/**
 * Job-related error keys
 */
export type JobErrorKey =
  | "HANDLER_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "ALREADY_COMPLETED"
  | "ALREADY_CANCELLED"
  | "ALREADY_FAILED"
  | "NOT_DOWNLOADABLE"
  | "NOT_COMPLETED"
  | "CANCEL_FAILED"
  | "ENQUEUE_FAILED"
  | "INVALID_INPUT"
  | "PROCESSING_FAILED";

/**
 * Job-related error definitions
 * Used with throwHttpError() and throwHttpErrorWithCustomMessage()
 */
export const JOB_ERRORS: Record<string, ErrorDefinition> = {
  "JOBS.HANDLER_NOT_FOUND": {
    message: "No handler registered for this job type",
    messageKey: "jobs.handler_not_found",
    statusCode: 400,
  },
  "JOBS.JOB_NOT_FOUND": {
    message: "Job not found",
    messageKey: "jobs.job_not_found",
    statusCode: 404,
  },
  "JOBS.ALREADY_COMPLETED": {
    message: "Job already completed",
    messageKey: "jobs.already_completed",
    statusCode: 400,
  },
  "JOBS.ALREADY_CANCELLED": {
    message: "Job already cancelled",
    messageKey: "jobs.already_cancelled",
    statusCode: 400,
  },
  "JOBS.ALREADY_FAILED": {
    message: "Job already failed",
    messageKey: "jobs.already_failed",
    statusCode: 400,
  },
  "JOBS.NOT_DOWNLOADABLE": {
    message: "Job does not have a downloadable result",
    messageKey: "jobs.not_downloadable",
    statusCode: 400,
  },
  "JOBS.NOT_COMPLETED": {
    message: "Job is not completed yet",
    messageKey: "jobs.not_completed",
    statusCode: 400,
  },
  "JOBS.CANCEL_FAILED": {
    message: "Failed to cancel job",
    messageKey: "jobs.cancel_failed",
    statusCode: 500,
  },
  "JOBS.ENQUEUE_FAILED": {
    message: "Failed to enqueue job",
    messageKey: "jobs.enqueue_failed",
    statusCode: 500,
  },
  "JOBS.INVALID_INPUT": {
    message: "Invalid job input data",
    messageKey: "jobs.invalid_input",
    statusCode: 400,
  },
  "JOBS.PROCESSING_FAILED": {
    message: "Job processing failed",
    messageKey: "jobs.processing_failed",
    statusCode: 500,
  },
};
