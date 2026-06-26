/**
 * @file handlers/jobs/task-download.handler.ts
 * @description Handler for downloading job result files
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { downloadTaskResultRoute } from "@routes/jobs/jobs.route.ts";
import { getTaskStatusService } from "@services/background-jobs/singletons.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import { TaskResultType, TaskStatus } from "@interfaces/background-task.ts";

/**
 * Handler for GET /api/jobs/:taskId/download
 * Downloads the result file for jobs with download result type
 */
export const downloadTaskResultHandler = defineHandler(
  {
    entityType: "task",
    loggerSection: loggerAppSections.INTERNAL,
    route: downloadTaskResultRoute,
    operationName: "task_download",
  },
  async ({ userId, environmentId, params }) => {
    // Get job state with authorization check
    const state = await getTaskStatusService().getTaskState(
      params.taskId,
      userId,
      environmentId,
    );

    if (!state) {
      throwHttpError("COMMON.NOT_FOUND"); // Returns 404 for both not found and unauthorized
    }

    // Check if job is completed
    if (state.status !== TaskStatus.COMPLETED) {
      throwHttpError("JOBS.NOT_COMPLETED");
    }

    // Check if job has a downloadable result
    const result = state.result as { downloadUrl?: string; resultType?: TaskResultType } | undefined;
    if (!result || result.resultType !== TaskResultType.DOWNLOAD || !result.downloadUrl) {
      throwHttpError("JOBS.NOT_DOWNLOADABLE");
    }

    // Return redirect to download URL
    // Note: In a real implementation, you might stream the file directly
    // or return a signed URL for the client to download
    return {
      data: { downloadUrl: result.downloadUrl },
      status: 200,
    };
  },
);
