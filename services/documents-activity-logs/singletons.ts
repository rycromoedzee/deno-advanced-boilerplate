/**
 * @file services/documents-activity-logs/singletons.ts
 * @description Lazy singletons for documents activity logs services
 */
import { DocumentSSEActivityLogService } from "./sse-activity-logs.service.ts";

let instance: DocumentSSEActivityLogService | null = null;

/**
 * Get singleton instance of SSE Activity Log Service
 */
export function getDocumentSSEActivityLogService(): DocumentSSEActivityLogService {
  if (!instance) {
    try {
      instance = new DocumentSSEActivityLogService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentSSEActivityLogService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return instance;
}
