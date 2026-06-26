/**
 * @file routes/user/api-key/extend.route.ts
 * @description Extend route definition
 */
import { createRoute, z } from "@deps";
import { SCHEMA_VALIDATION_TIMESTAMP } from "@models/shared.model.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

const ExtendApiKeyParamsSchema = z.object({
  id: z.string().cuid2(withKey("validation.api-key-id-invalid", "API key ID must be a valid CUID2")),
});

const ExtendApiKeyRequestSchema = z.object({
  expiresAt: SCHEMA_VALIDATION_TIMESTAMP,
});

const ExtendApiKeyResponseSchema = z.object({
  success: z.boolean(),
  newExpiresAt: z.number().int().nonnegative(),
});

export const userApiKeyExtendRoute = createRoute({
  method: "patch",
  path: "/{id}/extend",
  summary: "Extend API key expiration",
  operationId: "userApiKeyExtend",
  description: "Extend the expiration of one of the calling user's API keys.\n\n" +
    "**Behavior:** Sets a new `expiresAt` (unix seconds, must be in the future) on the key identified by the path `id`, scoped to the calling user. Returns the new expiration. Only active keys can be extended.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** Ownership — only a key belonging to the calling user can be extended.\n" +
    "**Notes:** Rate-limited per user. Returns 404 if the key is not found for this user and 409 if the key is inactive.",
  request: {
    params: ExtendApiKeyParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: ExtendApiKeyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "API key expiration extended successfully",
      content: {
        "application/json": {
          schema: ExtendApiKeyResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request data or expiration date",
    },
    401: {
      description: "Authentication required",
    },
    404: {
      description: "API key not found or access denied",
    },
    409: {
      description: "Cannot extend inactive API key",
    },
    500: {
      description: "Internal Server Error",
    },
  },
});
