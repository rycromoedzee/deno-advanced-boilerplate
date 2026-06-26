/**
 * @file routes/super-admin/index.ts
 * @description Barrel/Hono app wiring for super admin routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";

import {
  createEnvironmentRoute,
  deactivateEnvironmentRoute,
  destroyEnvironmentRoute,
  getEnvironmentOverviewRoute,
  getEnvironmentRoute,
  getFeaturesRoute,
  getPrimaryAdminRoute,
  getQuotasRoute,
  listEnvironmentsRoute,
  provisionEnvironmentRoute,
  reactivateEnvironmentRoute,
  registerDatabaseRoute,
  resetPrimaryAdminPasswordRoute,
  suspendEnvironmentRoute,
  updateEnvironmentRoute,
  updateFeaturesRoute,
  updatePrimaryAdminRoute,
  updateQuotasRoute,
} from "./super-admin.route.ts";

import {
  createEnvironmentHandler,
  deactivateEnvironmentHandler,
  destroyEnvironmentHandler,
  getEnvironmentHandler,
  getEnvironmentOverviewHandler,
  getFeaturesHandler,
  getPrimaryAdminHandler,
  getQuotasHandler,
  listEnvironmentsHandler,
  provisionEnvironmentHandler,
  reactivateEnvironmentHandler,
  registerDatabaseHandler,
  resetPrimaryAdminPasswordHandler,
  suspendEnvironmentHandler,
  updateEnvironmentHandler,
  updateFeaturesHandler,
  updatePrimaryAdminHandler,
  updateQuotasHandler,
} from "@handlers/super-admin/index.ts";

const STANDARD_RATE_LIMIT = {
  max: 50,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const superAdmin = createRateLimitedApp();

superAdmin.openapiWithRateLimit(listEnvironmentsRoute, listEnvironmentsHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(getEnvironmentRoute, getEnvironmentHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(createEnvironmentRoute, createEnvironmentHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(updateEnvironmentRoute, updateEnvironmentHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(deactivateEnvironmentRoute, deactivateEnvironmentHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(destroyEnvironmentRoute, destroyEnvironmentHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(suspendEnvironmentRoute, suspendEnvironmentHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(reactivateEnvironmentRoute, reactivateEnvironmentHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(registerDatabaseRoute, registerDatabaseHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(provisionEnvironmentRoute, provisionEnvironmentHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(getEnvironmentOverviewRoute, getEnvironmentOverviewHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(getPrimaryAdminRoute, getPrimaryAdminHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(updatePrimaryAdminRoute, updatePrimaryAdminHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(resetPrimaryAdminPasswordRoute, resetPrimaryAdminPasswordHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(getFeaturesRoute, getFeaturesHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(updateFeaturesRoute, updateFeaturesHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(getQuotasRoute, getQuotasHandler, STANDARD_RATE_LIMIT);
superAdmin.openapiWithRateLimit(updateQuotasRoute, updateQuotasHandler, STANDARD_RATE_LIMIT);

export default superAdmin;
