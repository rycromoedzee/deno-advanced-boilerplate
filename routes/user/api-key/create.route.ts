/**
 * @file routes/user/api-key/create.route.ts
 * @description Create route definition
 */
import { createRoute } from "@deps";
import { SchemaUserApiKeyCreateRequest, SchemaUserApiKeyCreateResponse } from "@models/users/index.ts";
import { httpResponseBadRequest, httpResponseInternalServerError, withJsonBody } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";

export const createApiKeyRoute = createRoute({
  method: "post",
  path: "/create",
  summary: "Create API key",
  operationId: "userApiKeyCreate",
  description: "Creates a new API key for the user.\n\n" +
    "**Behavior:** Mints a new key tied to the calling user and environment, applying either an explicit `permissions` list or a `permissionGroup` (mutually exclusive). The full plaintext `key` is returned exactly once alongside a `keyEndingIn` preview and expiration. Requires the caller's access token.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** The new key's effective scope is the supplied permission list or group; the caller can only assign permissions they themselves hold.\n" +
    "**Notes:** Rate-limited per user. Optional IP/domain restrictions and future expiration are supported. The plaintext key cannot be retrieved again.",
  tags: [OpenAPITags.users],
  request: {
    ...withJsonBody(SchemaUserApiKeyCreateRequest),
  },
  responses: {
    201: {
      description: "API key created successfully",
      content: {
        "application/json": {
          schema: SchemaUserApiKeyCreateResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});
