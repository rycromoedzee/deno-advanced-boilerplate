/**
 * @file services/documents-encryption/singletons.ts
 * @description Lazy singletons for documents encryption services
 */
import { DocumentEncryptionSharingService } from "./encryption-sharing.service.ts";

let instance: DocumentEncryptionSharingService | null = null;
export function getDocumentEncryptionSharingService(): DocumentEncryptionSharingService {
  if (!instance) {
    try {
      instance = new DocumentEncryptionSharingService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentEncryptionSharingService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return instance;
}
