/**
 * @file handlers/auth/refresh.handler.ts
 * @description Refresh request handler
 */
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { authRefreshRoute } from "@routes/auth/refresh.route.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { AUTH_HEADER_NAMING, getSessionCreateService } from "@services/session/index.ts";
import { useGetCookie, useGetSignedCookie, useSetCookie, useSetSessionKeyCookie, useSetSignedCookie } from "@utils/cookie.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { TIMING_PROFILES } from "@utils/shared/timing.ts";
import { SchemaAuthRefreshResponse } from "@models/auth/index.ts";

export const authRefreshHandler = defineHandler(
  {
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    route: authRefreshRoute,
    operationName: "auth_refresh",
    timingProfile: TIMING_PROFILES.FAST,
    authContext: false,
    responseSchema: SchemaAuthRefreshResponse,
  },
  async ({ c }) => {
    const requestContext = IPLookupUtils.getRequestContext(c);

    // Get refresh token from signed cookie
    const refreshToken = await useGetSignedCookie(c, AUTH_HEADER_NAMING.refresh);

    if (!refreshToken) {
      await useLogger(LoggerLevels.warn, {
        messageKey: "auth.refresh.missing-token",
        section: loggerAppSections.AUTH,
        message: "Refresh token not found in cookies",
        details: {
          ip: IPLookupUtils.anonymizeIP(requestContext.ip),
          userAgent: requestContext.userAgent.substring(0, 100),
        },
      });

      throwHttpError("AUTH.UNAUTHORIZED");
    }

    try {
      // Get session creation service
      const sessionService = getSessionCreateService();

      // Read the existing session key cookie (used to decrypt derived key from old refresh token)
      const oldSessionKey = useGetCookie(c, AUTH_HEADER_NAMING.sessionKey) || undefined;
      const oldAccessToken = useGetCookie(c, AUTH_HEADER_NAMING.access) || undefined;

      // Update user session with refresh token
      // Password derived key will be retrieved from the old refresh token using the old session key,
      // then re-encrypted with the new session key that will be set as a cookie in the response.
      const sessionResult = await sessionService.updateUserSession(
        refreshToken,
        {
          userAgent: requestContext.userAgent,
          accept: requestContext.headers["accept"] || "unknown",
          lang: requestContext.headers["Accept-Language"] || "unknown",
        },
        requestContext.ip,
        oldSessionKey,
        oldAccessToken,
      ).catch(async (error) => {
        const isUnauthorized = error instanceof Error && "status" in error && (error as unknown as { status: number }).status === 401;
        const logLevel = isUnauthorized ? LoggerLevels.info : LoggerLevels.error;

        await useLogger(logLevel, {
          messageKey: isUnauthorized ? "auth.refresh.unauthorized" : "auth.refresh.session-update-error",
          section: loggerAppSections.AUTH,
          message: isUnauthorized
            ? "Token refresh failed - session not found (cache cleared or expired)"
            : "Session update failed during token refresh",
          details: {
            operation: "session-refresh",
            ip: IPLookupUtils.anonymizeIP(requestContext.ip),
            operationContext: "token refresh",
            error: error instanceof Error ? error.message : "Unknown error",
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          },
          raw: error,
        });

        // Re-throw HTTP exceptions as-is
        if (error instanceof Error && "status" in error) {
          throw error;
        }

        throwHttpError("AUTH.UNAUTHORIZED");
      });

      useSetCookie(
        c,
        AUTH_HEADER_NAMING.access,
        sessionResult.accessToken,
        JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
      );

      // Set new refresh token cookie (signed)
      await useSetSignedCookie(
        c,
        AUTH_HEADER_NAMING.refresh,
        sessionResult.refreshToken,
        JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
      );

      // Rotate session key — set new ephemeral session key cookie
      useSetSessionKeyCookie(c, sessionResult.sessionKey, JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration);

      return {
        status: 200,
        data: {
          message: "Token refreshed successfully",
          expiresAt: sessionResult.expiresAt,
          refreshExpiresAt: sessionResult.refreshExpiresAt,
        },
      };
    } catch (error) {
      // Re-throw HTTP exceptions as-is
      if (error instanceof Error && "status" in error) {
        throw error;
      }

      await useLogger(LoggerLevels.error, {
        messageKey: "auth.refresh.unexpected-error",
        section: loggerAppSections.AUTH,
        message: "Unexpected error during token refresh",
        details: {
          ip: IPLookupUtils.anonymizeIP(requestContext.ip),
          error: error instanceof Error ? error.message : "Unknown error",
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        },
        raw: error,
      });

      throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
    }
  },
);
