/**
 * @file routes/permissions/read-group.route.ts
 * @description Read Group route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

export const readGroupRoute = createRoute({
  method: "get",
  path: "/permissions/groups/{groupId}",
  tags: [OpenAPITags.permissionGroups],
  summary: "Read permission group",
  operationId: "permissionGroupGet",
  description: [
    "Read a single permission group with its permissions.",
    "",
    "**Behavior:** Returns the group's metadata, permission list, permission count, and member count. Returns 404 if the group is not found in the caller's environment.",
    "**Auth:** cookie session or API key (authenticated).",
    "**Permissions:** `permissionGroups.read`.",
    "**Notes:** Tenant-scoped to the caller's environment.",
  ].join("\n"),
  request: {
    params: z.object({
      groupId: z.string().min(1).describe("Permission group ID"),
    }),
  },
  responses: {
    200: {
      description: "Permission group detail",
      content: {
        "application/json": {
          schema: z.object({
            data: z.object({
              id: z.string(),
              name: z.string(),
              description: z.string().nullable(),
              isSystem: z.boolean(),
              environmentId: z.string().nullable(),
              permissions: z.array(z.string()),
              permissionCount: z.number(),
              memberCount: z.number(),
              createdAt: z.number().nullable(),
              updatedAt: z.number().nullable(),
            }),
          }),
        },
      },
    },
    404: {
      description: "Permission group not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
  },
});
