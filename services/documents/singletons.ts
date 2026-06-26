/**
 * @file services/documents/singletons.ts
 * @description Singleton management for core document CRUD services
 * Separated from index.ts to prevent circular dependencies
 */

import { DocumentReadService } from "./document-read.service.ts";
import { DocumentWriteService } from "./document-write.service.ts";
import { DocumentDeleteService } from "./document-delete.service.ts";
import { DocumentDuplicateService } from "./document-duplicate.service.ts";
import { DocumentUploadService } from "./document-upload.service.ts";
import { DocumentDownloadService } from "./document-download.service.ts";
import { DocumentCreateOptionsService } from "./document-create-options.service.ts";

let documentReadServiceInstance: DocumentReadService | null = null;
let documentWriteServiceInstance: DocumentWriteService | null = null;
let documentDeleteServiceInstance: DocumentDeleteService | null = null;
let documentDuplicateServiceInstance: DocumentDuplicateService | null = null;
let documentUploadServiceInstance: DocumentUploadService | null = null;
let documentDownloadServiceInstance: DocumentDownloadService | null = null;
let documentCreateOptionsServiceInstance: DocumentCreateOptionsService | null = null;

export function getDocumentReadService(): DocumentReadService {
  if (!documentReadServiceInstance) {
    try {
      documentReadServiceInstance = new DocumentReadService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentReadService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentReadServiceInstance;
}

export function getDocumentWriteService(): DocumentWriteService {
  if (!documentWriteServiceInstance) {
    try {
      documentWriteServiceInstance = new DocumentWriteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentWriteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentWriteServiceInstance;
}

export function getDocumentDeleteService(): DocumentDeleteService {
  if (!documentDeleteServiceInstance) {
    try {
      documentDeleteServiceInstance = new DocumentDeleteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentDeleteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentDeleteServiceInstance;
}

export function getDocumentDuplicateService(): DocumentDuplicateService {
  if (!documentDuplicateServiceInstance) {
    try {
      documentDuplicateServiceInstance = new DocumentDuplicateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentDuplicateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentDuplicateServiceInstance;
}

export function getDocumentUploadService(): DocumentUploadService {
  if (!documentUploadServiceInstance) {
    try {
      documentUploadServiceInstance = new DocumentUploadService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentUploadService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentUploadServiceInstance;
}

export function getDocumentDownloadService(): DocumentDownloadService {
  if (!documentDownloadServiceInstance) {
    try {
      documentDownloadServiceInstance = new DocumentDownloadService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentDownloadService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentDownloadServiceInstance;
}

export function getDocumentCreateOptionsService(): DocumentCreateOptionsService {
  if (!documentCreateOptionsServiceInstance) {
    try {
      documentCreateOptionsServiceInstance = new DocumentCreateOptionsService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentCreateOptionsService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentCreateOptionsServiceInstance;
}

/**
 * Test utility function to reset singleton instances.
 * This should only be used in test environments.
 * @internal
 */
export function resetDocumentSingletons(): void {
  documentReadServiceInstance = null;
  documentWriteServiceInstance = null;
  documentDeleteServiceInstance = null;
  documentDuplicateServiceInstance = null;
  documentUploadServiceInstance = null;
  documentDownloadServiceInstance = null;
  documentCreateOptionsServiceInstance = null;
}
