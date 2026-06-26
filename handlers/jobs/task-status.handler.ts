/**
 * @file handlers/jobs/task-status.handler.ts
 * @description Handler for getting job status
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { getTaskStatusRoute } from "@routes/jobs/jobs.route.ts";
import { getTaskStatusService } from "@services/background-jobs/singletons.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import { SchemaTaskStatusResponse } from "@models/jobs/job.model.ts";

/**
 * Get job status handler
 * Returns 404 for both not found and unauthorized (404 pattern)
 */
export const getTaskStatusHandler = defineHandler(
  {
    entityType: "task",
    loggerSection: loggerAppSections.INTERNAL,
    route: getTaskStatusRoute,
    operationName: "task_status",
    responseSchema: SchemaTaskStatusResponse,
  },
  async ({ userId, environmentId, params }) => {
    // Pass both userId AND environmentId for proper multi-tenant isolation
    const state = await getTaskStatusService().getTaskState(
      params.taskId,
      userId,
      environmentId,
    );

    if (!state) {
      throwHttpError("COMMON.NOT_FOUND"); // Returns 404 for both not found and unauthorized
    }

    return { data: state, status: 200 };
  },
);
