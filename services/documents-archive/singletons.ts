/**
 * @file services/documents-archive/singletons.ts
 * @description Lazy singletons for documents archive services
 */
import { DocumentArchiveService } from "./document-archive.service.ts";

let instance: DocumentArchiveService | null = null;
export function getDocumentArchiveService(): DocumentArchiveService {
  if (!instance) {
    try {
      instance = new DocumentArchiveService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentArchiveService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return instance;
}
