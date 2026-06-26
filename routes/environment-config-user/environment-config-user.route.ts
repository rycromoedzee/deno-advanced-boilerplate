/**
 * @file routes/environment-config-user/environment-config-user.route.ts
 * @description Environment Config User route definition
 */
import { createRoute, z } from "@deps";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import {
  SchemaEnvironmentConfigUserCreateRequest,
  SchemaEnvironmentConfigUserCreateResponse,
  SchemaEnvironmentConfigUserDeleteResponse,
  SchemaEnvironmentConfigUserIdParam,
  SchemaEnvironmentConfigUserListQuery,
  SchemaEnvironmentConfigUserListResponse,
  SchemaEnvironmentConfigUserUpdateRequest,
  SchemaEnvironmentConfigUserUpdateResponse,
} from "@models/environment-config-user/index.ts";

const ErrorResponseSchema = z.object({
  message: z.string().openapi({
    example: "Invalid credentials",
    description: "Generic error message for security",
  }),
  messageKey: z.string().optional().openapi({
    example: "auth.creds-invalid",
    description: "Localization key for the error message",
  }),
});

/**
 * List users route
 */
export const listUsersRoute = createRoute({
  method: "get",
  path: "/users",
  summary: "List users in environment",
  operationId: "environmentConfigUsersList",
  description: `Retrieves a paginated list of users in the current environment with filtering and sorting options.

**Behavior:** Supports search, filtering by identity/status/permission fields, and sorting.
**Auth:** cookie session
**Permissions:** admin-managed directory (authorization enforced in the service)
**Notes:** Tenant-scoped to the caller's environment.`,
  tags: [OpenAPITags.environmentConfig],
  request: {
    query: SchemaEnvironmentConfigUserListQuery,
  },
  responses: {
    200: {
      description: "Users retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaEnvironmentConfigUserListResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

/**
 * Create user route
 */
export const createUserRoute = createRoute({
  method: "post",
  path: "/users",
  summary: "Create a new user",
  operationId: "environmentConfigUserCreate",
  description: `Creates a new user in the current environment with optional identity and permission assignments.

**Behavior:** Provisions the user, an optional email/username identity, and optional permissions or permission-group membership; returns a registration URL when signup is not yet completed.
**Auth:** cookie session
**Permissions:** admin-managed directory (authorization enforced in the service)
**Notes:** Tenant-scoped to the caller's environment; conflict (409) if the identity already exists.`,
  tags: [OpenAPITags.environmentConfig],
  request: {
    ...withJsonBody(SchemaEnvironmentConfigUserCreateRequest),
  },
  responses: {
    201: {
      description: "User created successfully",
      content: {
        "application/json": {
          schema: SchemaEnvironmentConfigUserCreateResponse,
        },
      },
    },
    409: {
      description: "Conflict - User already exists",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

/**
 * Get user route
 */
export const getUserRoute = createRoute({
  method: "get",
  path: "/users/{userId}",
  summary: "Get user by ID",
  operationId: "environmentConfigUserGet",
  description: `Retrieves a specific user by ID with their identity and permissions.

**Behavior:** Looks up a single user within the caller's environment.
**Auth:** cookie session
**Permissions:** admin-managed directory (authorization enforced in the service)
**Notes:** Tenant-scoped to the caller's environment; returns 404 if the user is not in this environment.`,
  tags: [OpenAPITags.environmentConfig],
  request: {
    params: SchemaEnvironmentConfigUserIdParam,
  },
  responses: {
    200: {
      description: "User retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaEnvironmentConfigUserUpdateResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

/**
 * Update user route
 */
export const updateUserRoute = createRoute({
  method: "patch",
  path: "/users/{userId}",
  summary: "Update user",
  operationId: "environmentConfigUserUpdate",
  description: `Updates a user's information, identity, and permissions.

**Behavior:** Partial update of profile, identity, and permissions; permission changes support a replace or merge strategy.
**Auth:** cookie session
**Permissions:** admin-managed directory (authorization enforced in the service)
**Notes:** Tenant-scoped to the caller's environment; returns 404 if the user is not in this environment.`,
  tags: [OpenAPITags.environmentConfig],
  request: {
    params: SchemaEnvironmentConfigUserIdParam,
    ...withJsonBody(SchemaEnvironmentConfigUserUpdateRequest),
  },
  responses: {
    200: {
      description: "User updated successfully",
      content: {
        "application/json": {
          schema: SchemaEnvironmentConfigUserUpdateResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

/**
 * Delete user route
 */
export const deleteUserRoute = createRoute({
  method: "delete",
  path: "/users/{userId}",
  summary: "Delete user",
  operationId: "environmentConfigUserDelete",
  description: `Deletes a user and performs cascade cleanup of related data.

**Behavior:** Removes the user and cascades cleanup of related tenant-scoped data.
**Auth:** cookie session
**Permissions:** admin-managed directory (authorization enforced in the service)
**Notes:** Tenant-scoped to the caller's environment; returns 404 if the user is not in this environment.`,
  tags: [OpenAPITags.environmentConfig],
  request: {
    params: SchemaEnvironmentConfigUserIdParam,
  },
  responses: {
    200: {
      description: "User deleted successfully",
      content: {
        "application/json": {
          schema: SchemaEnvironmentConfigUserDeleteResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});
