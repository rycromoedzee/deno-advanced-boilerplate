/**
 * @file routes/permissions/list-groups.route.ts
 * @description List Groups route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { PAGINATION_DEFAULTS } from "@constants/pagination.ts";

export const listGroupsRoute = createRoute({
  method: "get",
  path: "/permissions/groups",
  tags: [OpenAPITags.permissionGroups],
  summary: "List permission groups",
  operationId: "permissionGroupsList",
  description: [
    "List permission groups for the current environment, including system groups.",
    "",
    "**Behavior:** Returns a paginated list of permission groups (tenant-scoped plus system groups) with permission and member counts. Supports a `search` filter.",
    "**Auth:** cookie session or API key (authenticated).",
    "**Permissions:** `permissionGroups.list`.",
    "**Notes:** Tenant-scoped to the caller's environment.",
  ].join("\n"),
  request: {
    query: z.object({
      page: z.string().optional().default(String(PAGINATION_DEFAULTS.DEFAULT_PAGE)),
      limit: z.string().optional().default(String(PAGINATION_DEFAULTS.DEFAULT_LIMIT)),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of permission groups",
      content: {
        "application/json": {
          schema: z.object({
            groups: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                description: z.string().nullable(),
                isSystem: z.boolean(),
                permissionCount: z.number(),
                memberCount: z.number(),
              }),
            ),
            pagination: z.object({
              total: z.number(),
              page: z.number(),
              limit: z.number(),
            }),
          }),
        },
      },
    },
  },
});
