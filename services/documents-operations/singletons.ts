/**
 * @file services/documents-operations/singletons.ts
 * @description Lazy singletons for documents operations services
 */
import { DocumentMoveService } from "./document-move.service.ts";

let instance: DocumentMoveService | null = null;
export function getDocumentMoveService(): DocumentMoveService {
  if (!instance) {
    try {
      instance = new DocumentMoveService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentMoveService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return instance;
}
