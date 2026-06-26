/**
 * @file tenant/index.ts
 * @description Barrel re-exports for the tenant provisioning service.
 */

// Service class
export { TenantProvisioningService } from "./provisioning.service.ts";

// Singleton getter
export { getTenantProvisioningService } from "./singletons.ts";
