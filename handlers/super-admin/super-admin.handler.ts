/**
 * @file handlers/super-admin/super-admin.handler.ts
 * @description Super Admin request handler
 */
import {
  getEnvironmentFeaturesService,
  getEnvironmentOverviewService,
  getEnvironmentPrimaryAdminService,
  getEnvironmentQuotasService,
  getSuperAdminEnvironmentService,
} from "@services/super-admin/index.ts";
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
} from "@routes/super-admin/super-admin.route.ts";
import { loggerAppSections } from "@logger/index.ts";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import {
  SchemaAdminUserResponse,
  SchemaDatabaseResponse,
  SchemaEnvironmentDetailResponse,
  SchemaEnvironmentFeaturesResponse,
  SchemaEnvironmentListResponse,
  SchemaEnvironmentOverviewResponse,
  SchemaEnvironmentQuotasResponse,
  SchemaEnvironmentResponse,
  SchemaPrimaryAdminPasswordResetResponse,
} from "@models/super-admin/index.ts";

const ENTITY_TYPE = "super_admin_environment" as const;
const baseConfig = {
  entityType: ENTITY_TYPE,
  loggerSection: loggerAppSections.INTERNAL,
};

export const listEnvironmentsHandler = defineHandler(
  { ...baseConfig, route: listEnvironmentsRoute, operationName: "super_admin_env_list", responseSchema: SchemaEnvironmentListResponse },
  async () => {
    const result = await getSuperAdminEnvironmentService().listEnvironments();
    return { data: result, status: 200 };
  },
);

export const getEnvironmentHandler = defineHandler(
  { ...baseConfig, route: getEnvironmentRoute, operationName: "super_admin_env_get", responseSchema: SchemaEnvironmentDetailResponse },
  async ({ params }) => {
    const result = await getSuperAdminEnvironmentService().getEnvironmentById(params.environmentId);
    return { data: result, status: 200 };
  },
);

export const createEnvironmentHandler = defineHandler(
  { ...baseConfig, route: createEnvironmentRoute, operationName: "super_admin_env_create", responseSchema: SchemaEnvironmentResponse },
  async ({ body }) => {
    const result = await getSuperAdminEnvironmentService().createEnvironment(body);
    return { data: result, status: 201 };
  },
);

export const updateEnvironmentHandler = defineHandler(
  { ...baseConfig, route: updateEnvironmentRoute, operationName: "super_admin_env_update", responseSchema: SchemaEnvironmentResponse },
  async ({ params, body }) => {
    const result = await getSuperAdminEnvironmentService().updateEnvironment(params.environmentId, body);
    return { data: result, status: 200 };
  },
);

export const deactivateEnvironmentHandler = defineHandler(
  {
    ...baseConfig,
    route: deactivateEnvironmentRoute,
    operationName: "super_admin_env_deactivate",
    responseSchema: SchemaEnvironmentResponse,
  },
  async ({ params }) => {
    const result = await getSuperAdminEnvironmentService().deactivateEnvironment(params.environmentId);
    return { data: result, status: 200 };
  },
);

export const destroyEnvironmentHandler = defineHandler(
  { ...baseConfig, route: destroyEnvironmentRoute, operationName: "super_admin_env_destroy" },
  async ({ params, body }) => {
    await getSuperAdminEnvironmentService().destroyEnvironment(params.environmentId, body.confirmation);
    return { status: 204 };
  },
);

export const suspendEnvironmentHandler = defineHandler(
  { ...baseConfig, route: suspendEnvironmentRoute, operationName: "super_admin_env_suspend", responseSchema: SchemaEnvironmentResponse },
  async ({ params }) => {
    const result = await getSuperAdminEnvironmentService().suspendEnvironment(params.environmentId);
    return { data: result, status: 200 };
  },
);

export const reactivateEnvironmentHandler = defineHandler(
  {
    ...baseConfig,
    route: reactivateEnvironmentRoute,
    operationName: "super_admin_env_reactivate",
    responseSchema: SchemaEnvironmentResponse,
  },
  async ({ params }) => {
    const result = await getSuperAdminEnvironmentService().reactivateEnvironment(params.environmentId);
    return { data: result, status: 200 };
  },
);

export const registerDatabaseHandler = defineHandler(
  { ...baseConfig, route: registerDatabaseRoute, operationName: "super_admin_env_register_db", responseSchema: SchemaDatabaseResponse },
  async ({ params, body }) => {
    const result = await getSuperAdminEnvironmentService().registerDatabase(params.environmentId, body);
    return { data: result, status: 201 };
  },
);

export const provisionEnvironmentHandler = defineHandler(
  {
    ...baseConfig,
    route: provisionEnvironmentRoute,
    operationName: "super_admin_env_provision",
    responseSchema: SchemaEnvironmentResponse,
  },
  async ({ params, body }) => {
    const result = await getSuperAdminEnvironmentService().provisionEnvironment(params.environmentId, body);
    return { data: result, status: 200 };
  },
);

export const getEnvironmentOverviewHandler = defineHandler(
  {
    ...baseConfig,
    route: getEnvironmentOverviewRoute,
    operationName: "super_admin_env_overview",
    responseSchema: SchemaEnvironmentOverviewResponse,
  },
  async ({ params }) => {
    const result = await getEnvironmentOverviewService().getEnvironmentOverview(params.environmentId);
    return { data: result, status: 200 };
  },
);

export const getPrimaryAdminHandler = defineHandler(
  {
    ...baseConfig,
    route: getPrimaryAdminRoute,
    operationName: "super_admin_env_primary_admin_get",
    responseSchema: SchemaAdminUserResponse,
  },
  async ({ params }) => {
    const result = await getEnvironmentPrimaryAdminService().getPrimaryAdmin(params.environmentId);
    return { data: result, status: 200 };
  },
);

export const updatePrimaryAdminHandler = defineHandler(
  {
    ...baseConfig,
    route: updatePrimaryAdminRoute,
    operationName: "super_admin_env_primary_admin_update",
    responseSchema: SchemaAdminUserResponse,
  },
  async ({ params, body }) => {
    const result = await getEnvironmentPrimaryAdminService().updatePrimaryAdmin(params.environmentId, body);
    return { data: result, status: 200 };
  },
);

export const resetPrimaryAdminPasswordHandler = defineHandler(
  {
    ...baseConfig,
    route: resetPrimaryAdminPasswordRoute,
    operationName: "super_admin_env_primary_admin_reset_password",
    responseSchema: SchemaPrimaryAdminPasswordResetResponse,
  },
  async ({ params }) => {
    const result = await getEnvironmentPrimaryAdminService().resetPrimaryAdminPassword(params.environmentId);
    return { data: result, status: 200 };
  },
);

export const getFeaturesHandler = defineHandler(
  {
    ...baseConfig,
    route: getFeaturesRoute,
    operationName: "super_admin_env_features_get",
    responseSchema: SchemaEnvironmentFeaturesResponse,
  },
  async ({ params }) => {
    const result = await getEnvironmentFeaturesService().getFeatures(params.environmentId);
    return { data: result, status: 200 };
  },
);

export const updateFeaturesHandler = defineHandler(
  {
    ...baseConfig,
    route: updateFeaturesRoute,
    operationName: "super_admin_env_features_update",
    responseSchema: SchemaEnvironmentFeaturesResponse,
  },
  async ({ params, body }) => {
    const result = await getEnvironmentFeaturesService().updateFeatures(params.environmentId, body);
    return { data: result, status: 200 };
  },
);

export const getQuotasHandler = defineHandler(
  { ...baseConfig, route: getQuotasRoute, operationName: "super_admin_env_quotas_get", responseSchema: SchemaEnvironmentQuotasResponse },
  async ({ params }) => {
    const result = await getEnvironmentQuotasService().getQuotas(params.environmentId);
    return { data: result, status: 200 };
  },
);

export const updateQuotasHandler = defineHandler(
  {
    ...baseConfig,
    route: updateQuotasRoute,
    operationName: "super_admin_env_quotas_update",
    responseSchema: SchemaEnvironmentQuotasResponse,
  },
  async ({ params, body }) => {
    const result = await getEnvironmentQuotasService().updateQuotas(params.environmentId, body);
    return { data: result, status: 200 };
  },
);
