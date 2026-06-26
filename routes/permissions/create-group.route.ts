/**
 * @file routes/permissions/create-group.route.ts
 * @description Create Group route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

export const createGroupRoute = createRoute({
  method: "post",
  path: "/permissions/groups",
  tags: [OpenAPITags.permissionGroups],
  summary: "Create permission group",
  operationId: "permissionGroupCreate",
  description: [
    "Create a new permission group in the current environment.",
    "",
    "**Behavior:** Inserts a non-system group and links the provided permission names. The caller must hold every permission being assigned (admins are exempt). Unknown permission names are rejected.",
    "**Auth:** cookie session or API key (authenticated).",
    "**Permissions:** `permissionGroups.create`.",
    "**Notes:** Tenant-scoped to the caller's environment. Created groups are never system groups (`isSystem: false`).",
  ].join("\n"),
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().trim().min(1).max(100),
            description: z.string().trim().max(500).optional(),
            permissions: z.array(z.string().trim()).default([]),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Created permission group",
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
