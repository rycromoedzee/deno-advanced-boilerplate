/**
 * @file services/media-stream/index.ts
 * @description Streaming services exports
 */

export * from "./media-stream.service.ts";

// New exports for section-based access
export { SectionAccessService } from "./section-access.service.ts";
export { getSectionAccessService, initializeSectionValidators, isSectionAccessServiceInitialized } from "./singletons.ts";
export type { ISectionAccessValidator } from "./validators/index.ts";
