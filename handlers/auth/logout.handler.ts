/**
 * @file handlers/auth/logout.handler.ts
 * @description Logout request handler
 */
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { authLogoutRoute } from "@routes/auth/logout.route.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { AUTH_HEADER_NAMING, getSessionLogoutService } from "@services/session/index.ts";
import { useClearSessionKeyCookie, useGetCookie, useGetSignedCookie, useSetCookie, useSetSignedCookie } from "@utils/cookie.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { TIMING_PROFILES } from "@utils/shared/timing.ts";

export const authLogoutHandler = defineHandler(
  {
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    route: authLogoutRoute,
    operationName: "auth_logout",
    timingProfile: TIMING_PROFILES.FAST,
    authContext: false,
  },
  async ({ c }) => {
    const requestContext = IPLookupUtils.getRequestContext(c);

    const accessToken = useGetCookie(c, AUTH_HEADER_NAMING.access);
    const refreshToken = await useGetSignedCookie(c, AUTH_HEADER_NAMING.refresh);

    if (!accessToken || !refreshToken) {
      await useLogger(LoggerLevels.info, {
        message: "Logout attempted with missing tokens",
        section: loggerAppSections.AUTH,
        messageKey: "auth.logout.missing-tokens",
        details: {
          ip: IPLookupUtils.anonymizeIP(requestContext.ip),
          userAgent: requestContext.userAgent.substring(0, 100),
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken,
        },
      });

      // Clear cookies just in case
      useSetCookie(c, AUTH_HEADER_NAMING.access, "", 0);
      await useSetSignedCookie(c, AUTH_HEADER_NAMING.refresh, "", 0);
      useClearSessionKeyCookie(c);

      return { status: 204 };
    }

    try {
      await getSessionLogoutService().logoutCurrentSession(
        accessToken,
        refreshToken,
      );

      useSetCookie(c, AUTH_HEADER_NAMING.access, "", 0);
      await useSetSignedCookie(c, AUTH_HEADER_NAMING.refresh, "", 0);
      useClearSessionKeyCookie(c);

      return { status: 204 };
    } catch (error) {
      // Re-throw HTTP exceptions as-is
      if (error instanceof Error && "status" in error) {
        throw error;
      }

      await useLogger(LoggerLevels.error, {
        message: "Unexpected error during logout",
        section: loggerAppSections.AUTH,
        messageKey: "auth.logout.unexpected-error",
        details: {
          ip: IPLookupUtils.anonymizeIP(requestContext.ip),
          error: error instanceof Error ? error.message : "Unknown error",
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        },
        raw: error,
      });

      // Still clear cookies on error to ensure client is logged out
      useSetCookie(c, AUTH_HEADER_NAMING.access, "", 0);
      await useSetSignedCookie(c, AUTH_HEADER_NAMING.refresh, "", 0);
      useClearSessionKeyCookie(c);

      throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
    }
  },
);
