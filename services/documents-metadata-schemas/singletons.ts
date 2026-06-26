/**
 * @file services/documents-metadata-schemas/singletons.ts
 * @description Lazy singletons for documents metadata schemas services
 */
import { DocumentMetadataSchemaService } from "./document-metadata-schema.service.ts";

let instance: DocumentMetadataSchemaService | null = null;
export function getDocumentMetadataSchemaService(): DocumentMetadataSchemaService {
  if (!instance) {
    try {
      instance = new DocumentMetadataSchemaService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentMetadataSchemaService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return instance;
}
