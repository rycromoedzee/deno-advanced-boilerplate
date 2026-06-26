/**
 * @file handlers/documents-stats/documents-stats.handler.ts
 * @description Documents Stats request handler
 */
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { getDocumentStatsService } from "@services/documents-stats/index.ts";
import { getDocumentStatsRoute } from "@routes/documents-stats/documents-stats.route.ts";
import { SchemaDocumentStatsResponse } from "@models/documents/stats.model.ts";

/**
 * Get document statistics handler
 */
export const getDocumentStatsHandler = defineHandler(
  {
    route: getDocumentStatsRoute,
    operationName: "document_stats_get",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentStatsResponse,
  },
  async (context) => {
    const service = getDocumentStatsService();
    const stats = await service.getStats(context.userId);

    return {
      data: SchemaDocumentStatsResponse.parse(stats),
      status: 200,
    };
  },
);
