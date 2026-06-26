/**
 * @file services/documents-sharing/singletons.ts
 * @description Lazy singletons for documents sharing services
 */
import { DocumentSharingService } from "./document-sharing.service.ts";
import { DocumentSharingPublicService } from "./document-sharing-public.service.ts";
import { DocumentFolderSharingService } from "./sharing.service.ts";

let documentSharingServiceInstance: DocumentSharingService | null = null;
let documentSharingPublicServiceInstance: DocumentSharingPublicService | null = null;
let documentFolderSharingServiceInstance: DocumentFolderSharingService | null = null;

export function getDocumentSharingService(): DocumentSharingService {
  if (!documentSharingServiceInstance) {
    try {
      documentSharingServiceInstance = new DocumentSharingService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentSharingService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentSharingServiceInstance;
}

export function getDocumentSharingPublicService(): DocumentSharingPublicService {
  if (!documentSharingPublicServiceInstance) {
    try {
      documentSharingPublicServiceInstance = new DocumentSharingPublicService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentSharingPublicService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentSharingPublicServiceInstance;
}

export function getDocumentFolderSharingService(): DocumentFolderSharingService {
  if (!documentFolderSharingServiceInstance) {
    try {
      documentFolderSharingServiceInstance = new DocumentFolderSharingService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentFolderSharingService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentFolderSharingServiceInstance;
}
