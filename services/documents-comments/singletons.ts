/**
 * @file services/documents-comments/singletons.ts
 * @description Lazy singletons for documents comments services
 */
import { DocumentCommentService } from "./document-comment.service.ts";

let instance: DocumentCommentService | null = null;
export function getDocumentCommentService(): DocumentCommentService {
  if (!instance) {
    try {
      instance = new DocumentCommentService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentCommentService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return instance;
}
