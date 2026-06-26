/**
 * @file services/documents-tags/singletons.ts
 * @description Lazy singletons for documents tags services
 */
import { DocumentTagService } from "./document-tag.service.ts";

let instance: DocumentTagService | null = null;
export function getDocumentTagService(): DocumentTagService {
  if (!instance) {
    try {
      instance = new DocumentTagService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentTagService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return instance;
}
