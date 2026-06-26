/**
 * @file handlers/jobs/task-cancel.handler.ts
 * @description Handler for cancelling jobs
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { cancelTaskRoute } from "@routes/jobs/jobs.route.ts";
import { getTaskCancelService } from "@services/background-jobs/singletons.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import { SchemaTaskCancelResponse } from "@models/jobs/job.model.ts";

/**
 * Cancel job handler
 * Returns 404 for both not found and unauthorized (404 pattern)
 */
export const cancelTaskHandler = defineHandler(
  {
    entityType: "task",
    loggerSection: loggerAppSections.INTERNAL,
    route: cancelTaskRoute,
    operationName: "task_cancel",
    responseSchema: SchemaTaskCancelResponse,
  },
  async ({ userId, environmentId, params }) => {
    // Pass both userId AND environmentId for proper multi-tenant isolation
    const result = await getTaskCancelService().requestCancellation(
      params.taskId,
      userId,
      environmentId,
    );

    if (result.reason === "not_found") {
      throwHttpError("COMMON.NOT_FOUND"); // Returns 404 for both not found and unauthorized
    }

    if (result.reason === "already_completed") {
      throwHttpError("JOBS.ALREADY_COMPLETED");
    }

    if (result.reason === "already_cancelled") {
      throwHttpError("JOBS.ALREADY_CANCELLED");
    }

    if (result.reason === "already_failed") {
      throwHttpError("JOBS.ALREADY_FAILED");
    }

    return { data: result, status: 200 };
  },
);
