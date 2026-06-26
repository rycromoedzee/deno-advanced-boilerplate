/**
 * @file handlers/user/password.handler.ts
 * @description Handlers for user password management routes
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import { changePasswordRoute, setPasswordRoute } from "@routes/user/password.route.ts";
import { getUserPasswordService } from "@services/user/index.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { useGetCookie } from "@utils/cookie.ts";
import { tokenHashString } from "@services/token/index.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { TIMING_PROFILES } from "@utils/shared/index.ts";
import { SchemaPasswordSetResponse } from "@models/users/index.ts";

const passwordService = getUserPasswordService();

export const setPasswordHandler = defineHandler(
  {
    route: setPasswordRoute,
    operationName: "password_set",
    entityType: "password",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaPasswordSetResponse,
  },
  async ({ userId, c, body }) => {
    const accessToken = useGetCookie(c, AUTH_HEADER_NAMING.access);
    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const sessionId = tokenHashString(accessToken);
    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";

    await passwordService.setPasswordWithReauthToken({
      userId,
      reauthToken: body.reauthToken,
      newPassword: body.newPassword,
      sessionId,
      ipAddress,
    });

    return { data: { success: true }, status: 200 };
  },
);

export const changePasswordHandler = defineHandler(
  {
    route: changePasswordRoute,
    operationName: "password_change",
    entityType: "password",
    loggerSection: loggerAppSections.AUTH,
    timingProfile: TIMING_PROFILES.PASSWORD,
  },
  async ({ userId, c, body }) => {
    const accessToken = useGetCookie(c, AUTH_HEADER_NAMING.access);
    const refreshToken = useGetCookie(c, AUTH_HEADER_NAMING.refresh);

    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    if (!refreshToken) {
      throwHttpError("SESSION.SESSION_EXPIRED");
    }

    await passwordService.changePassword({
      userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      accessToken,
      refreshToken,
    });

    return { status: 204 };
  },
);
