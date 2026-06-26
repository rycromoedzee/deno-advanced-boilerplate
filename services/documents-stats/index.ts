/**
 * @file services/documents-stats/index.ts
 * @description Re-exports for document stats services
 */

export { DocumentStatsService } from "./document-stats.service.ts";
export { DocumentAccessLogService } from "./unified-access-log.service.ts";

export { getDocumentAccessLogService, getDocumentStatsService } from "./singletons.ts";
