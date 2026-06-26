/**
 * @file services/documents-stats/singletons.ts
 * @description Lazy singletons for documents stats services
 */
import { DocumentStatsService } from "./document-stats.service.ts";
import { DocumentAccessLogService } from "./unified-access-log.service.ts";

let documentStatsServiceInstance: DocumentStatsService | null = null;
let documentAccessLogService: DocumentAccessLogService | null = null;

export function getDocumentStatsService(): DocumentStatsService {
  if (!documentStatsServiceInstance) {
    try {
      documentStatsServiceInstance = new DocumentStatsService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentStatsService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentStatsServiceInstance;
}

export function getDocumentAccessLogService(): DocumentAccessLogService {
  if (!documentAccessLogService) {
    try {
      documentAccessLogService = new DocumentAccessLogService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentAccessLogService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentAccessLogService;
}
