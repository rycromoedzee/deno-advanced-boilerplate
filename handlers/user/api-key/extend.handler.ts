/**
 * @file handlers/user/api-key/extend.handler.ts
 * @description Extend request handler
 */
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import { userApiKeyExtendRoute } from "@routes/user/api-key/extend.route.ts";
import { SchemaUserApiKeyExtendResponse } from "@models/users/index.ts";
import { getSessionApiKeyCreation } from "@services/session/index.ts";
import { convertToStorageFormat } from "@utils/shared/index.ts";

/**
 * Handler for API key expiration extension endpoint
 * Route: PATCH /user/api-key/{id}/extend
 */
export const extendHandler = defineHandler(
  {
    route: userApiKeyExtendRoute,
    operationName: "extend_api_key",
    entityType: "user",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaUserApiKeyExtendResponse,
  },
  async ({ userId, params, body }) => {
    const apiKeyId = params.id;

    // body.expiresAt is already unix seconds (the route schema SCHEMA_VALIDATION_TIMESTAMP
    // transforms ms→sec); convertToStorageFormat is a defense-in-depth no-op that mirrors
    // the create flow (services/user/api-keys/create-key.service.ts).
    const newExpirationTime = convertToStorageFormat(body.expiresAt);

    await getSessionApiKeyCreation().extendApiKey(
      apiKeyId,
      userId,
      newExpirationTime,
    );

    return {
      data: {
        success: true,
        newExpiresAt: body.expiresAt,
      },
      status: 200,
    };
  },
);
