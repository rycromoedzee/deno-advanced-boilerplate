/**
 * @file services/super-admin/singletons.ts
 * @description Lazy singletons for super admin services
 */
import { SuperAdminEnvironmentService } from "./environment.service.ts";
import { EnvironmentOverviewService } from "./environment-overview.service.ts";
import { EnvironmentPrimaryAdminService } from "./environment-primary-admin.service.ts";
import { EnvironmentFeaturesService } from "./environment-features.service.ts";
import { EnvironmentQuotasService } from "./environment-quotas.service.ts";

let superAdminEnvironmentService: SuperAdminEnvironmentService | null = null;
export function getSuperAdminEnvironmentService(): SuperAdminEnvironmentService {
  if (!superAdminEnvironmentService) {
    try {
      superAdminEnvironmentService = new SuperAdminEnvironmentService();
    } catch (error) {
      throw new Error(
        `Failed to initialize SuperAdminEnvironmentService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return superAdminEnvironmentService;
}

let environmentOverviewService: EnvironmentOverviewService | null = null;
export function getEnvironmentOverviewService(): EnvironmentOverviewService {
  if (!environmentOverviewService) {
    environmentOverviewService = new EnvironmentOverviewService();
  }
  return environmentOverviewService;
}

let environmentPrimaryAdminService: EnvironmentPrimaryAdminService | null = null;
export function getEnvironmentPrimaryAdminService(): EnvironmentPrimaryAdminService {
  if (!environmentPrimaryAdminService) {
    environmentPrimaryAdminService = new EnvironmentPrimaryAdminService();
  }
  return environmentPrimaryAdminService;
}

let environmentFeaturesService: EnvironmentFeaturesService | null = null;
export function getEnvironmentFeaturesService(): EnvironmentFeaturesService {
  if (!environmentFeaturesService) {
    environmentFeaturesService = new EnvironmentFeaturesService();
  }
  return environmentFeaturesService;
}

let environmentQuotasService: EnvironmentQuotasService | null = null;
export function getEnvironmentQuotasService(): EnvironmentQuotasService {
  if (!environmentQuotasService) {
    environmentQuotasService = new EnvironmentQuotasService();
  }
  return environmentQuotasService;
}
