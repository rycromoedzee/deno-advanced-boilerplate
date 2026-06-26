/**
 * @file services/media-stream/singletons.ts
 * @description Lazy singletons for media stream services
 */
import { SectionAccessService } from "./section-access.service.ts";
import { DocumentsSectionValidator } from "./validators/documents-section.validator.ts";

let sectionAccessService: SectionAccessService | null = null;

/**
 * Gets the singleton instance of SectionAccessService.
 * @returns {SectionAccessService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getSectionAccessService(): SectionAccessService {
  if (!sectionAccessService) {
    try {
      sectionAccessService = new SectionAccessService();
    } catch (error) {
      throw new Error(
        `Failed to initialize SectionAccessService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return sectionAccessService;
}

/**
 * Initialize section validators for the media stream service.
 * Idempotent: creates the singleton if needed and registers the documents
 * section validator.
 */
export function initializeSectionValidators(): void {
  if (!sectionAccessService) {
    sectionAccessService = new SectionAccessService();
  }

  // Register the documents section validator
  sectionAccessService.registerValidator("documents", new DocumentsSectionValidator());
}

/**
 * Check if the section access service is initialized.
 */
export function isSectionAccessServiceInitialized(): boolean {
  return sectionAccessService !== null;
}
