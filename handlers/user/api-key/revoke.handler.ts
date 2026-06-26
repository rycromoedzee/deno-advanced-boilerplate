/**
 * @file handlers/user/api-key/revoke.handler.ts
 * @description Revoke request handler
 */
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import { userApiKeyRevokeRoute } from "@routes/user/api-key/revoke.route.ts";
import { SchemaUserApiKeyRevokeResponse } from "@models/users/index.ts";
import { getSessionRevocationService } from "@services/session/index.ts";

/**
 * Handler for API key revocation endpoint
 * Route: DELETE /user/api-key/{id}/revoke
 */
export const userApiKeyRevokeHandler = defineHandler(
  {
    route: userApiKeyRevokeRoute,
    operationName: "revoke_api_key",
    entityType: "user",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaUserApiKeyRevokeResponse,
  },
  async ({ userId, params }) => {
    const apiKeyId = params.id;

    await getSessionRevocationService().revokeApiKey(apiKeyId, userId);

    return { status: 204 };
  },
);
