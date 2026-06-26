/**
 * @file handlers/jobs/task-trigger.handler.ts
 * @description Handler for triggering background jobs
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { triggerTaskRoute } from "@routes/jobs/jobs.route.ts";
import { getTaskEnqueueService } from "@services/background-jobs/singletons.ts";
import { hasHandler } from "@services/background-jobs/handlers/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import { SchemaTaskTriggerResponse } from "@models/jobs/job.model.ts";

/**
 * Trigger job handler
 * Enqueues a new background job and returns status/stream URLs
 */
export const triggerTaskHandler = defineHandler(
  {
    entityType: "task",
    loggerSection: loggerAppSections.INTERNAL,
    route: triggerTaskRoute,
    operationName: "task_trigger",
    responseSchema: SchemaTaskTriggerResponse,
  },
  async ({ userId, environmentId, params, body }) => {
    const taskType = params.taskType;
    const input = body.input;

    // Check if handler exists for this job type
    if (!hasHandler(taskType)) {
      throwHttpError("JOBS.HANDLER_NOT_FOUND");
    }

    // Enqueue the job
    const taskEnqueueService = getTaskEnqueueService();
    const result = await taskEnqueueService.enqueueTask(
      taskType,
      input,
      {
        userId,
        environmentId,
      },
    );

    return { data: result, status: 200 };
  },
);
