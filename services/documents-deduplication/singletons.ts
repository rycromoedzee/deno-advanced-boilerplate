/**
 * @file services/documents-deduplication/singletons.ts
 * @description Lazy singletons for documents deduplication services
 */
import { DocumentDeduplicationService } from "./document-deduplication.service.ts";

let instance: DocumentDeduplicationService | null = null;
export function getDocumentDeduplicationService(): DocumentDeduplicationService {
  if (!instance) {
    try {
      instance = new DocumentDeduplicationService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentDeduplicationService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return instance;
}
