/**
 * @file services/public-sharing/singletons.ts
 * @description Singleton management for public sharing services
 * Separated from index.ts to prevent circular dependencies
 */

import { PublicSharingService } from "./public-sharing.service.ts";
import { SecureLinkGeneratorService } from "./secure-link-generator.service.ts";
import type { IEncryptionTableConfig } from "@interfaces/encryption.ts";

// ============================================================================
// SecureLinkGeneratorService (stateless, single instance)
// ============================================================================

let secureLinkGeneratorService: SecureLinkGeneratorService | null = null;

/**
 * Gets the singleton instance of SecureLinkGeneratorService
 * @returns {SecureLinkGeneratorService} The singleton instance
 */
export function getSecureLinkGeneratorService(): SecureLinkGeneratorService {
  if (!secureLinkGeneratorService) {
    secureLinkGeneratorService = new SecureLinkGeneratorService();
  }
  return secureLinkGeneratorService;
}

// ============================================================================
// PublicSharingService (table-config dependent)
// ============================================================================

/**
 * Creates a PublicSharingService for a given table config.
 * Note: This service is stateful per table config, so we return a new instance
 * rather than storing a fixed singleton.
 * @param tableConfig - The encryption table configuration
 * @returns {PublicSharingService} A new PublicSharingService instance
 */
export function getPublicSharingService(
  tableConfig: IEncryptionTableConfig,
): PublicSharingService {
  return new PublicSharingService(tableConfig);
}
