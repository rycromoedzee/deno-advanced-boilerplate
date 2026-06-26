/**
 * @file routes/permissions/update-user-permissions.route.ts
 * @description Update User Permissions route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

export const updateUserPermissionsRoute = createRoute({
  method: "patch",
  path: "/permissions/users/{userId}",
  tags: [OpenAPITags.permissions],
  summary: "Update user direct permissions",
  operationId: "userPermissionsUpdate",
  description: [
    "Update a user's individual permissions with replacement strategy. Removes all existing direct permissions and group memberships, then assigns new permissions. Admins can also set the admin flag. Requires admin access or permissionGroupsExtra.assign permission.",
    "",
    "**Behavior:** Removes the target user from any permission group and replaces all direct permissions with the new set. The `admin` flag is admin-only; non-admin callers passing it get 403. Non-admins may only assign permissions they themselves hold.",
    "**Auth:** cookie session or API key (authenticated).",
    "**Permissions:** admin, or `permissionGroupsExtra.assign` (limited to the caller's own permissions).",
    "**Notes:** Tenant-scoped to the caller's environment. Returns 404 if the target user does not exist.",
  ].join("\n"),
  request: {
    params: z.object({
      userId: z.string().trim().min(1).describe("Target user ID"),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            permissions: z
              .array(z.string().trim().min(1))
              .describe("New permissions to assign (replaces all existing)"),
            admin: z
              .boolean()
              .optional()
              .describe("Set user admin status (admin-only)"),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "User permissions updated successfully",
      content: {
        "application/json": {
          schema: z.object({
            userId: z.string(),
            permissions: z.array(z.string()),
            isAdmin: z.boolean(),
            wasInGroup: z.boolean(),
          }),
        },
      },
    },
    403: {
      description: "Insufficient permissions",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    404: {
      description: "User not found",
    },
  },
});
