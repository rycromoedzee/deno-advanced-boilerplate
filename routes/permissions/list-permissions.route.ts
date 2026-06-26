/**
 * @file routes/permissions/list-permissions.route.ts
 * @description List Permissions route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

export const listPermissionsRoute = createRoute({
  method: "get",
  path: "/permissions",
  tags: [OpenAPITags.permissions],
  summary: "List all permissions",
  operationId: "permissionsList",
  description: [
    "List all system-defined permissions.",
    "",
    "**Behavior:** Returns the catalog of system-defined permissions with name, description, level, and group. Not tenant-scoped.",
    "**Auth:** cookie session or API key (authenticated).",
    "**Permissions:** `permissionGroups.read`.",
    "**Notes:** Global catalog; identical across environments.",
  ].join("\n"),
  responses: {
    200: {
      description: "List of permissions",
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              name: z.string(),
              description: z.string().nullable(),
              level: z.number().int().nullable(),
              group: z.string().nullable(),
            }),
          ),
        },
      },
    },
  },
});
