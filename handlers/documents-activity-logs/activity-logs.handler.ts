/**
 * @file handlers/documents-activity-logs/activity-logs.handler.ts
 * @description Handler for retrieving activity logs across all documents and folders
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { getActivityLogsRoute } from "@routes/documents-activity-logs/activity-logs.route.ts";
import { getDocumentAccessLogService } from "@services/documents-stats/index.ts";
import { type IActivityLogQuery, SchemaActivityLogsResponse } from "@models/documents/activity-logs.model.ts";

/**
 * Get Activity Logs Handler
 * Retrieves paginated activity logs for all documents and folders the user has access to
 */
export const getActivityLogsHandler = defineHandler(
  {
    route: getActivityLogsRoute,
    operationName: "activity_logs_get",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaActivityLogsResponse,
    errorKey: "DOCUMENT.ACTIVITY_LOGS_FAILED",
  },
  async (context) => {
    const query = context.query as IActivityLogQuery;

    // Build filters from query parameters
    const filters = {
      documentName: query.documentName,
      documentId: query.documentId,
      folderId: query.folderId,
      ownerId: query.ownerId,
      accessedBy: query.accessedBy,
      contentType: query.contentType,
      tags: query.tags ? query.tags.split(",") : undefined,
      accessType: query.accessType,
      accessMethod: query.accessMethod,
      startDate: query.startDate,
      endDate: query.endDate,
      uploadedAfter: query.uploadedAfter,
      uploadedBefore: query.uploadedBefore,
      updatedAfter: query.updatedAfter,
      updatedBefore: query.updatedBefore,
    };

    // Build pagination params
    const pagination = {
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };

    // Get the unified access log service
    const service = getDocumentAccessLogService();

    // Query activity logs
    const result = await service.queryAllUserActivityLogs(
      context.userId,
      context.environmentId,
      filters,
      pagination,
    );

    // Parse and return the response
    return {
      data: result,
      status: 200,
    };
  },
);
