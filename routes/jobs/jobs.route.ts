/**
 * @file routes/jobs/jobs.route.ts
 * @description OpenAPI route definitions for job API endpoints
 */

import { createRoute, z } from "@deps";
import { httpResponseInternalServerError, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import {
  SchemaTaskCancelResponse,
  SchemaTaskNotFoundResponse,
  SchemaTaskParams,
  SchemaTaskStatusResponse,
  SchemaTaskTriggerRequest,
  SchemaTaskTriggerResponse,
  SchemaTaskTypeParams,
} from "@models/jobs/job.model.ts";

/**
 * Trigger a new background job
 */
export const triggerTaskRoute = createRoute({
  method: "post",
  path: "/{taskType}/trigger",
  summary: "Trigger a new background job",
  operationId: "jobTrigger",
  description: `Start a new background job of the specified type. Returns URLs for status checking and SSE streaming.

**Behavior:** Enqueues the job with the caller's user/environment context; returns the task id plus status and stream URLs.
**Auth:** cookie session
**Permissions:** none beyond auth
**Notes:** Tenant-scoped (job is associated with the caller's environmentId); returns 400 for an unknown task type.`,
  tags: ["Jobs"],
  request: {
    params: SchemaTaskTypeParams,
    body: {
      content: {
        "application/json": {
          schema: SchemaTaskTriggerRequest,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SchemaTaskTriggerResponse,
        },
      },
      description: "Job triggered successfully",
    },
    400: {
      content: {
        "application/json": {
          schema: SchemaTaskNotFoundResponse,
        },
      },
      description: "Invalid job type or input",
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

/**
 * Get job status as JSON
 */
export const getTaskStatusRoute = createRoute({
  method: "get",
  path: "/{taskId}/status",
  summary: "Get job status",
  operationId: "jobGet",
  description: `Get the current status of a job. Returns 404 if job not found or user is not authorized.

**Behavior:** Returns status, progress, result/error, and lifecycle timestamps for one job.
**Auth:** cookie session
**Permissions:** ownership (caller can only read jobs they triggered)
**Notes:** Tenant-scoped; returns 404 for both not-found and unauthorized to avoid leaking existence.`,
  tags: ["Jobs"],
  request: {
    params: SchemaTaskParams,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SchemaTaskStatusResponse,
        },
      },
      description: "Job status",
    },
    404: {
      content: {
        "application/json": {
          schema: SchemaTaskNotFoundResponse,
        },
      },
      description: "Job not found or unauthorized",
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

/**
 * Stream job status updates via SSE
 */
export const streamTaskStatusRoute = createRoute({
  method: "get",
  path: "/{taskId}/stream",
  summary: "Stream job status updates via SSE",
  operationId: "jobStream",
  description: `Subscribe to real-time job status updates via Server-Sent Events. Returns 404 if job not found or user is not authorized.

**Behavior:** Opens an SSE connection that emits progress and lifecycle updates for one job until it completes.
**Auth:** cookie session
**Permissions:** ownership (caller can only stream jobs they triggered)
**Notes:** Tenant-scoped; returns 404 for both not-found and unauthorized.`,
  tags: ["Jobs"],
  request: {
    params: SchemaTaskParams,
  },
  responses: {
    200: {
      content: {
        "text/event-stream": {
          schema: z.unknown(),
        },
      },
      description: "SSE stream of job updates",
    },
    404: {
      content: {
        "application/json": {
          schema: SchemaTaskNotFoundResponse,
        },
      },
      description: "Job not found or unauthorized",
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

/**
 * Request job cancellation
 */
export const cancelTaskRoute = createRoute({
  method: "post",
  path: "/{taskId}/cancel",
  summary: "Request job cancellation",
  operationId: "jobCancel",
  description: `Request cancellation of a running job. Returns 404 if job not found or user is not authorized.

**Behavior:** Requests cooperative cancellation; returns the outcome with a reason if the job is already in a terminal state.
**Auth:** cookie session
**Permissions:** ownership (caller can only cancel jobs they triggered)
**Notes:** Tenant-scoped; returns 400 if the job is already completed, cancelled, or failed; 404 for not-found/unauthorized.`,
  tags: ["Jobs"],
  request: {
    params: SchemaTaskParams,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: SchemaTaskCancelResponse,
        },
      },
      description: "Cancellation result",
    },
    400: {
      content: {
        "application/json": {
          schema: SchemaTaskNotFoundResponse,
        },
      },
      description: "Job already completed, cancelled, or failed",
    },
    404: {
      content: {
        "application/json": {
          schema: SchemaTaskNotFoundResponse,
        },
      },
      description: "Job not found or unauthorized",
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

/**
 * Download job result file
 */
export const downloadTaskResultRoute = createRoute({
  method: "get",
  path: "/{taskId}/download",
  summary: "Download job result file",
  operationId: "jobResultDownload",
  description: `Download the result file for jobs with download result type. Returns 404 if job not found or user is not authorized.

**Behavior:** Returns the download URL for a completed job whose result type is downloadable.
**Auth:** cookie session
**Permissions:** ownership (caller can only download results of jobs they triggered)
**Notes:** Tenant-scoped; returns 400 if the job is not completed or has no downloadable result; 404 for not-found/unauthorized.`,
  tags: ["Jobs"],
  request: {
    params: SchemaTaskParams,
  },
  responses: {
    200: {
      content: {
        "application/octet-stream": {
          schema: z.unknown(),
        },
      },
      description: "Result file download",
    },
    400: {
      content: {
        "application/json": {
          schema: SchemaTaskNotFoundResponse,
        },
      },
      description: "Job not completed or no downloadable result",
    },
    404: {
      content: {
        "application/json": {
          schema: SchemaTaskNotFoundResponse,
        },
      },
      description: "Job not found or unauthorized",
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
