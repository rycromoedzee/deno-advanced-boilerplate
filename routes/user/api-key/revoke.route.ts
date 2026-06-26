/**
 * @file routes/user/api-key/revoke.route.ts
 * @description Revoke route definition
 */
import { createRoute, z } from "@deps";
import { withKey } from "@utils/validation/zod-message-key.ts";

const RevokeApiKeyParamsSchema = z.object({
  id: z.string().trim().min(1, withKey("validation.api-key-id-required", "API key ID is required")),
});

export const userApiKeyRevokeRoute = createRoute({
  method: "delete",
  path: "/{id}/revoke",
  summary: "Revoke API key",
  operationId: "userApiKeyRevoke",
  description: "Revoke one of the calling user's API keys, immediately invalidating it.\n\n" +
    "**Behavior:** Marks the key identified by the path `id` as revoked so it can no longer authenticate. Scoped to the calling user.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** Ownership — only a key belonging to the calling user can be revoked.\n" +
    "**Notes:** Rate-limited per user. Returns `204 No Content` on success; 404 if the key is not found for this user and 409 if it is already revoked.",
  request: {
    params: RevokeApiKeyParamsSchema,
  },
  responses: {
    204: {
      description: "API key revoked successfully",
    },
    401: {
      description: "Authentication required",
    },
    404: {
      description: "API key not found or access denied",
    },
    409: {
      description: "API key is already revoked",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});
