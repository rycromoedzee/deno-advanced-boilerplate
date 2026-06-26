/**
 * @file routes/permissions/update-group.route.ts
 * @description Update Group route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

export const updateGroupRoute = createRoute({
  method: "patch",
  path: "/permissions/groups/{groupId}",
  tags: [OpenAPITags.permissionGroups],
  summary: "Update permission group",
  operationId: "permissionGroupUpdate",
  description: [
    "Update a permission group's name, description, or permissions. When permissions array is provided it replaces the full set.",
    "",
    "**Behavior:** Partially updates metadata and/or replaces the group's permission set. When `permissions` is provided, the caller must hold every permission being assigned (admins are exempt) and all names must be valid. At least one field must be supplied.",
    "**Auth:** cookie session or API key (authenticated).",
    "**Permissions:** `permissionGroups.update`.",
    "**Notes:** Tenant-scoped; the group must exist in the caller's environment.",
  ].join("\n"),
  request: {
    params: z.object({
      groupId: z.string().trim().min(1).describe("Permission group ID"),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().trim().min(1).max(100).optional(),
            description: z.string().trim().max(500).optional(),
            permissions: z.array(z.string().trim()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated permission group",
      content: {
        "application/json": {
          schema: z.object({
            group: z.object({
              id: z.string(),
              name: z.string(),
              description: z.string().nullable(),
              isSystem: z.boolean(),
              environmentId: z.string().nullable(),
              permissions: z.array(z.string()),
              createdAt: z.number().nullable(),
              updatedAt: z.number().nullable(),
            }),
          }),
        },
      },
    },
  },
});
