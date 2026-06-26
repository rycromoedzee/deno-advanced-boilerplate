/**
 * @file services/tenant/singletons.ts
 * @description Lazy singletons for tenant services
 */
import { TenantProvisioningService } from "./provisioning.service.ts";

let tenantProvisioningService: TenantProvisioningService;

/**
 * Gets the singleton instance of TenantProvisioningService.
 * @returns {TenantProvisioningService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getTenantProvisioningService(): TenantProvisioningService {
  if (!tenantProvisioningService) {
    try {
      tenantProvisioningService = new TenantProvisioningService();
    } catch (error) {
      throw new Error(
        `Failed to initialize TenantProvisioningService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return tenantProvisioningService;
}
