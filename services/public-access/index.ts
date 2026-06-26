/**
 * @file services/public-access/index.ts
 * @description Exports for public access system
 */

// Export validator
export { PublicAccessValidator } from "./public-access.validator.ts";

// Export unified resource manager
export { ResourceManager } from "./resource-manager.ts";

// Export creator
export { PublicShareCreator } from "./public-share.creator.ts";

// Export generic handler
export { createGenericPublicAccessHandler } from "./generic-public-access.handler.ts";

// Export configurations
export { DocumentConfig, registerDocumentConfig } from "./configs/document.config.ts";

// Export strategies
export { DocumentAccessStrategy } from "./strategies/document-access.strategy.ts";
