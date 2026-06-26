/**
 * @file handlers/user/api-key/create.handler.ts
 * @description Create request handler
 */
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import { createApiKeyRoute } from "@routes/user/api-key/create.route.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { SchemaUserApiKeyCreateResponse } from "@models/users/index.ts";
import { getUserAPIKeysCreateService } from "@services/user/index.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { useGetCookie } from "@utils/cookie.ts";

/**
 * Handler for API key creation endpoint
 */
export const createApiKeyHandler = defineHandler(
  {
    route: createApiKeyRoute,
    operationName: "create_api_key",
    entityType: "user",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaUserApiKeyCreateResponse,
  },
  async ({ userId, environmentId, isAdmin, c, body }) => {
    const accessToken = useGetCookie(c, AUTH_HEADER_NAMING.access);
    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const apiKeyResult = await getUserAPIKeysCreateService().createApiKey(
      userId,
      isAdmin,
      environmentId,
      accessToken,
      {
        name: body.name,
        permissions: body.permissions || [],
        expiresAt: body.expiresAt,
      },
    );

    return {
      data: {
        id: apiKeyResult.id,
        name: body.name,
        key: apiKeyResult.key,
        keyEndingIn: apiKeyResult.keyEndingIn,
        permissions: apiKeyResult.permissions,
        expiresAt: apiKeyResult.expiresAt || 0,
      },
      status: 201,
    };
  },
);
