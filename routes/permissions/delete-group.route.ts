/**
 * @file routes/permissions/delete-group.route.ts
 * @description Delete Group route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

export const deleteGroupRoute = createRoute({
  method: "delete",
  path: "/permissions/groups/{groupId}",
  tags: [OpenAPITags.permissionGroups],
  summary: "Delete permission group",
  operationId: "permissionGroupDelete",
  description: [
    "Hard delete a permission group. If users or API keys are assigned, a replacementGroupId must be provided to migrate them.",
    "",
    "**Behavior:** Removes the group's permission mappings then deletes the group. When the group has members, `replacementGroupId` is required; members are re-pointed to the replacement before deletion. The caller must hold all permissions of both the deleted group and the replacement (admins are exempt).",
    "**Auth:** cookie session or API key (authenticated).",
    "**Permissions:** `permissionGroups.delete`.",
    "**Notes:** Tenant-scoped; the group must exist in the caller's environment. Returns 204 on success.",
  ].join("\n"),
  request: {
    params: z.object({
      groupId: z.string().trim().min(1).describe("Permission group ID"),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            replacementGroupId: z.string().trim().optional(),
          }),
        },
      },
    },
  },
  responses: {
    204: {
      description: "Permission group deleted",
    },
  },
});
