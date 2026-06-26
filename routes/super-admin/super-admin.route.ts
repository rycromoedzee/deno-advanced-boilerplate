/**
 * @file routes/super-admin/super-admin.route.ts
 * @description Super Admin route definition
 */
import { createRoute } from "@deps";
import {
  httpResponseBadRequest,
  httpResponseConflict,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import {
  SchemaAdminUserCreateRequest,
  SchemaDatabaseCreateRequestCombined,
  SchemaDatabaseResponse,
  SchemaDestroyConfirmationRequest,
  SchemaEnvironmentCreateRequest,
  SchemaEnvironmentDetailResponse,
  SchemaEnvironmentFeatures,
  SchemaEnvironmentFeaturesUpdateRequest,
  SchemaEnvironmentIdParam,
  SchemaEnvironmentListResponse,
  SchemaEnvironmentOverviewPrimaryAdmin,
  SchemaEnvironmentOverviewResponse,
  SchemaEnvironmentPrimaryAdminUpdateRequest,
  SchemaEnvironmentQuotas,
  SchemaEnvironmentQuotasUpdateRequest,
  SchemaEnvironmentResponse,
  SchemaEnvironmentUpdateRequest,
} from "@models/super-admin/index.ts";

export const listEnvironmentsRoute = createRoute({
  method: "get",
  path: "/environments",
  summary: "List all environments",
  operationId: "superAdminEnvironmentsList",
  description: [
    "Returns all environments ordered by creation date (newest first)",
    "",
    "**Behavior:** Returns every environment record from the global database.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Global; not tenant-scoped. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  responses: {
    200: {
      description: "Environments retrieved successfully",
      content: { "application/json": { schema: SchemaEnvironmentListResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseInternalServerError,
  },
});

export const getEnvironmentRoute = createRoute({
  method: "get",
  path: "/environments/{environmentId}",
  summary: "Get environment by ID with database and admin user details",
  operationId: "superAdminEnvironmentGet",
  description: [
    "Returns a single environment by its ID, including database configuration (if configured) and admin user (if created)",
    "",
    "**Behavior:** Returns environment fields flattened with nullable database and admin-user details. Returns 404 if the environment is not found.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Global lookup by environment ID. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { params: SchemaEnvironmentIdParam },
  responses: {
    200: {
      description: "Environment retrieved successfully with database and admin user details",
      content: { "application/json": { schema: SchemaEnvironmentDetailResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const createEnvironmentRoute = createRoute({
  method: "post",
  path: "/environments",
  summary: "Create a new environment",
  operationId: "superAdminEnvironmentCreate",
  description: [
    "Creates a new environment with provisioning status",
    "",
    "**Behavior:** Inserts a new environment record in `provisioning` status. Does not register a database or create an admin user; use the `/database` and `/provision` endpoints for those steps.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Global; the new tenant is not yet usable until provisioned. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { ...withJsonBody(SchemaEnvironmentCreateRequest) },
  responses: {
    201: {
      description: "Environment created successfully",
      content: { "application/json": { schema: SchemaEnvironmentResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

export const updateEnvironmentRoute = createRoute({
  method: "patch",
  path: "/environments/{environmentId}",
  summary: "Update an environment",
  operationId: "superAdminEnvironmentUpdate",
  description: [
    "Partially updates an environment's fields",
    "",
    "**Behavior:** Applies provided metadata fields (name, description, custom subdomain/domain, timezone, default language, internal notes). At least one field must be supplied. Returns 404 if the environment is not found.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Global; status is not changed by this endpoint. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: {
    params: SchemaEnvironmentIdParam,
    ...withJsonBody(SchemaEnvironmentUpdateRequest),
  },
  responses: {
    200: {
      description: "Environment updated successfully",
      content: { "application/json": { schema: SchemaEnvironmentResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const deactivateEnvironmentRoute = createRoute({
  method: "post",
  path: "/environments/{environmentId}/deactivate",
  summary: "Deactivate (soft delete) an environment",
  operationId: "superAdminEnvironmentDeactivate",
  description: [
    "Soft deletes an environment by setting its status to deactivated",
    "",
    "**Behavior:** Sets the environment status to `deactivated`, preserving its data. Returns 409 if already deactivated, 404 if not found.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** A prerequisite for hard-destruction. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { params: SchemaEnvironmentIdParam },
  responses: {
    200: {
      description: "Environment deactivated successfully",
      content: { "application/json": { schema: SchemaEnvironmentResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseConflict,
    ...httpResponseInternalServerError,
  },
});

export const destroyEnvironmentRoute = createRoute({
  method: "post",
  path: "/environments/{environmentId}/destroy",
  summary: "Destroy (hard delete) an environment",
  operationId: "superAdminEnvironmentDestroy",
  description: [
    "Permanently deletes an environment and all associated data. The environment must be deactivated first.",
    "",
    "**Behavior:** Permanently removes the environment and its associated data. Requires the environment to be `deactivated` and a `confirmation` matching the environment name exactly. Returns 204 on success.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Irreversible. Returns 409 if not deactivated, 400 on confirmation mismatch. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: {
    params: SchemaEnvironmentIdParam,
    ...withJsonBody(SchemaDestroyConfirmationRequest),
  },
  responses: {
    204: { description: "Environment destroyed successfully" },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseNotFound,
    ...httpResponseConflict,
    ...httpResponseInternalServerError,
  },
});

export const suspendEnvironmentRoute = createRoute({
  method: "post",
  path: "/environments/{environmentId}/suspend",
  summary: "Suspend an environment",
  operationId: "superAdminEnvironmentSuspend",
  description: [
    "Suspends an environment, blocking all tenant access. Returns 503 for all requests to suspended environments.",
    "",
    "**Behavior:** Sets the environment status to `suspended` so tenant requests are served 503. Returns 409 if already suspended, 404 if not found.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Reversible via `/reactivate`. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { params: SchemaEnvironmentIdParam },
  responses: {
    200: {
      description: "Environment suspended successfully",
      content: { "application/json": { schema: SchemaEnvironmentResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseConflict,
    ...httpResponseInternalServerError,
  },
});

export const reactivateEnvironmentRoute = createRoute({
  method: "post",
  path: "/environments/{environmentId}/reactivate",
  summary: "Reactivate a suspended environment",
  operationId: "superAdminEnvironmentReactivate",
  description: [
    "Reactivates a suspended environment, restoring tenant access. Deactivated environments cannot be reactivated.",
    "",
    "**Behavior:** Restores a `suspended` environment to `active`, re-enabling tenant access. Returns 409 if already active, or if the environment is `deactivated` (cannot be reactivated).",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Only suspended environments can be reactivated. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { params: SchemaEnvironmentIdParam },
  responses: {
    200: {
      description: "Environment reactivated successfully",
      content: { "application/json": { schema: SchemaEnvironmentResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseConflict,
    ...httpResponseInternalServerError,
  },
});

export const registerDatabaseRoute = createRoute({
  method: "post",
  path: "/environments/{environmentId}/database",
  summary: "Register a database for an environment",
  operationId: "superAdminEnvironmentRegisterDatabase",
  description: [
    "Registers database credentials for an environment. Supports both URL-based (remote libsql) and local-based (auto-created file) registration. Required before provisioning.",
    "",
    "**Behavior:** Stores database credentials for the environment, either URL-based (`url` + optional `token`) or local (`local: true`, auto-named file). Required before provisioning. Returns 409 if a database is already registered, 404 if the environment is not found.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** The token is stored encrypted and returned masked. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: {
    params: SchemaEnvironmentIdParam,
    ...withJsonBody(SchemaDatabaseCreateRequestCombined),
  },
  responses: {
    201: {
      description: "Database registered successfully",
      content: { "application/json": { schema: SchemaDatabaseResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseNotFound,
    ...httpResponseConflict,
    ...httpResponseInternalServerError,
  },
});

export const provisionEnvironmentRoute = createRoute({
  method: "post",
  path: "/environments/{environmentId}/provision",
  summary: "Provision an environment",
  operationId: "superAdminEnvironmentProvision",
  description: [
    "Provisions an environment by running migrations, creating an admin user, and sending a registration email. Requires database to be registered first.",
    "",
    "**Behavior:** Runs tenant migrations, creates the admin user (global + tenant profile + encryption record), and asynchronously sends a registration email with a password-reset token. Requires the environment to be in `provisioning` status with a registered database and no existing admin. Returns 409 otherwise.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Idempotency-protected: refuses if an admin already exists. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: {
    params: SchemaEnvironmentIdParam,
    ...withJsonBody(SchemaAdminUserCreateRequest),
  },
  responses: {
    200: {
      description: "Environment provisioned successfully",
      content: { "application/json": { schema: SchemaEnvironmentResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseNotFound,
    ...httpResponseConflict,
    ...httpResponseInternalServerError,
  },
});

export const getEnvironmentOverviewRoute = createRoute({
  method: "get",
  path: "/environments/{environmentId}/overview",
  summary: "Get full environment overview",
  operationId: "superAdminEnvironmentOverview",
  description: [
    "Returns combined environment detail: general info, primary admin, feature toggles, and quotas in a single response",
    "",
    "**Behavior:** Aggregates general metadata, primary admin (earliest admin user), feature toggles, quotas, and database config into one payload. `primaryAdmin` and `database` are null when absent.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Convenience aggregate of several sub-resources. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { params: SchemaEnvironmentIdParam },
  responses: {
    200: {
      description: "Environment overview retrieved successfully",
      content: { "application/json": { schema: SchemaEnvironmentOverviewResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const getPrimaryAdminRoute = createRoute({
  method: "get",
  path: "/environments/{environmentId}/primary-admin",
  summary: "Get primary admin for environment",
  operationId: "superAdminPrimaryAdminGet",
  description: [
    "Returns the primary admin (earliest isAdmin user) for the environment",
    "",
    "**Behavior:** Returns the environment's primary admin (the earliest-created admin user) with profile and activity details.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Tenant-derived; read-only. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { params: SchemaEnvironmentIdParam },
  responses: {
    200: {
      description: "Primary admin retrieved successfully",
      content: { "application/json": { schema: SchemaEnvironmentOverviewPrimaryAdmin } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const updatePrimaryAdminRoute = createRoute({
  method: "patch",
  path: "/environments/{environmentId}/primary-admin",
  summary: "Update primary admin contact details",
  operationId: "superAdminPrimaryAdminUpdate",
  description: [
    "Updates the primary admin's contact details. Changes are applied to the admin's user profile directly.",
    "",
    "**Behavior:** Partially updates the primary admin's first name, last name, and/or email on the user profile. At least one field should be supplied.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Operates on the existing primary admin record. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: {
    params: SchemaEnvironmentIdParam,
    ...withJsonBody(SchemaEnvironmentPrimaryAdminUpdateRequest),
  },
  responses: {
    200: {
      description: "Primary admin updated successfully",
      content: { "application/json": { schema: SchemaEnvironmentOverviewPrimaryAdmin } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const resetPrimaryAdminPasswordRoute = createRoute({
  method: "post",
  path: "/environments/{environmentId}/primary-admin/reset-password",
  summary: "Send password reset email to primary admin",
  operationId: "superAdminPrimaryAdminResetPassword",
  description: [
    "Triggers a password reset email to the primary admin. Does not set the password directly.",
    "",
    "**Behavior:** Generates a password-reset token for the primary admin and sends a reset email. The password itself is not changed by this call.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Returns a success indicator; email delivery is asynchronous. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { params: SchemaEnvironmentIdParam },
  responses: {
    200: {
      description: "Password reset email sent successfully",
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const getFeaturesRoute = createRoute({
  method: "get",
  path: "/environments/{environmentId}/features",
  summary: "Get feature toggles for environment",
  operationId: "superAdminFeaturesGet",
  description: [
    "Returns the current state of all toggleable features for the environment",
    "",
    "**Behavior:** Returns the current on/off state of all module feature toggles (documents, encryption, public sharing, notes, knowledge base).",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Tenant-scoped feature flags. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { params: SchemaEnvironmentIdParam },
  responses: {
    200: {
      description: "Features retrieved successfully",
      content: { "application/json": { schema: SchemaEnvironmentFeatures } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const updateFeaturesRoute = createRoute({
  method: "patch",
  path: "/environments/{environmentId}/features",
  summary: "Update feature toggles",
  operationId: "superAdminFeaturesUpdate",
  description: [
    "Enable or disable features for the environment. Only provided keys are updated.",
    "",
    "**Behavior:** Partially updates module feature toggles; only supplied keys are changed, others keep their current value. Returns the full updated feature set.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Tenant-scoped feature flags. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: {
    params: SchemaEnvironmentIdParam,
    ...withJsonBody(SchemaEnvironmentFeaturesUpdateRequest),
  },
  responses: {
    200: {
      description: "Features updated successfully",
      content: { "application/json": { schema: SchemaEnvironmentFeatures } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const getQuotasRoute = createRoute({
  method: "get",
  path: "/environments/{environmentId}/quotas",
  summary: "Get quotas for environment",
  operationId: "superAdminQuotasGet",
  description: [
    "Returns the current quota limits and usage for the environment",
    "",
    "**Behavior:** Returns quota limits (max users, max storage, max file size) and current storage usage. `null` limits mean unlimited.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** `currentStorageKb` is read-only usage, not a limit. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: { params: SchemaEnvironmentIdParam },
  responses: {
    200: {
      description: "Quotas retrieved successfully",
      content: { "application/json": { schema: SchemaEnvironmentQuotas } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const updateQuotasRoute = createRoute({
  method: "patch",
  path: "/environments/{environmentId}/quotas",
  summary: "Update quota limits",
  operationId: "superAdminQuotasUpdate",
  description: [
    "Update quota limits for the environment. Pass null or 0 for unlimited. currentStorageKb is read-only.",
    "",
    "**Behavior:** Partially updates quota limits (max users, max storage, max file size). Pass `null` or `0` for unlimited. `currentStorageKb` is read-only usage and cannot be set. Returns the full quota set.",
    "**Auth:** super-admin (cookie session).",
    "**Permissions:** super-admin only.",
    "**Notes:** Tenant-scoped limits. Rate-limited.",
  ].join("\n"),
  tags: [OpenAPITags.superAdmin],
  request: {
    params: SchemaEnvironmentIdParam,
    ...withJsonBody(SchemaEnvironmentQuotasUpdateRequest),
  },
  responses: {
    200: {
      description: "Quotas updated successfully",
      content: { "application/json": { schema: SchemaEnvironmentQuotas } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});
