/**
 * @file handlers/auth/challenge.handler.ts
 * @description Challenge request handler
 */
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { eq, HTTPException } from "@deps";
import { AppHttpException, HTTP_EXCEPTION_COMMON_ERRORS } from "@utils/http-exception.ts";
import { authChallengeRoute } from "@routes/auth/challenge.route.ts";
import { useGetCookie, useSetCookie, useSetSessionKeyCookie, useSetSignedCookie } from "@utils/cookie.ts";
import { ITokensPayloadJWT } from "@services/token/config.ts";
import { getTokenHelperService } from "@services/token/index.ts";
import { AuthTOTPValidationService } from "@services/auth/index.ts";
import { AuthPasswordService } from "@services/auth/index.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { AUTH_HEADER_NAMING, getSessionCreateService } from "@services/session/index.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { EncryptionSystemUserService } from "@services/encryption/index.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { getUserAsymmetricKeysService } from "@services/user/index.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { SchemaAuthChallengeResponse } from "@models/auth/auth-response.model.ts";

export const authChallengeHandler = defineHandler(
  {
    route: authChallengeRoute,
    operationName: "auth_challenge",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaAuthChallengeResponse,
  },
  async ({ c, body, traceService }) => {
    const jwtToken = useGetCookie(c, AUTH_HEADER_NAMING.access);
    if (!jwtToken) {
      await ThrowValidationException401(performance.now());
    }

    const startTime = performance.now();

    let payload!: ITokensPayloadJWT;
    try {
      payload = await getTokenHelperService().useVerifyTokenJWT(
        jwtToken!,
        JWT_TOKEN_CONFIG.audiences.verify,
      ) as ITokensPayloadJWT;

      // Log successful token verification
      traceService.addBreadcrumb("auth", "JWT verification successful", "info", {
        userId: payload.sub,
        tokenType: payload.type,
        tokenIat: payload.iat,
      });
    } catch (_e) {
      // Log failed token verification with details
      traceService.addBreadcrumb("auth", "JWT verification failed", "warning", {
        error: _e instanceof Error ? _e.message : "Unknown",
        hasToken: !!jwtToken,
        tokenLength: jwtToken?.length ?? 0,
      });
      await ThrowValidationException401(startTime);
    }

    traceService.addBreadcrumb("auth", "Challenge verification started", "info", {
      userId: payload.sub,
    });

    const { password, twoFactorCode } = body;

    const userAuthDetails = await getGlobalDB()
      .select({
        isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
        password: globalTables.users.password,
      })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, payload.sub))
      .limit(1)
      .then((result) => result[0]);

    if (!userAuthDetails) {
      await ThrowValidationException401(startTime);
    }

    const requestContext = IPLookupUtils.getRequestContext(c);

    if (userAuthDetails!.isTwoFactorEnabled) {
      if (!twoFactorCode || !password) {
        await ThrowValidationException401(startTime);
      }

      if (!userAuthDetails!.password) {
        await ThrowValidationException500(startTime);
      }

      traceService.addBreadcrumb("auth", "Validating password", "info");

      try {
        const passwordValidation = await AuthPasswordService.validatePassword(
          userAuthDetails!.password!,
          password!,
          payload.sub,
          requestContext.ip,
          requestContext.userAgent,
        );

        if (!passwordValidation.valid) {
          traceService.addBreadcrumb("auth", "Password validation failed", "warning");
          await ThrowValidationException401(startTime);
        }

        traceService.addBreadcrumb("auth", "Password validation successful", "info");
      } catch (error) {
        if (error instanceof HTTPException && error.status === 429) {
          throw error;
        }
        await ThrowValidationException401(startTime);
      }

      traceService.addBreadcrumb("auth", "Validating 2FA code", "info");

      const validationResult = await AuthTOTPValidationService
        .validateTwoFactorCode(
          payload.sub,
          twoFactorCode!,
        );

      if (!validationResult.isValid) {
        traceService.addBreadcrumb("auth", "2FA validation failed", "warning");
        await ThrowValidationException401(startTime);
      }

      traceService.addBreadcrumb("auth", "2FA validation successful", "info");
    } else {
      if (!password) {
        await ThrowValidationException401(startTime);
      }

      if (!userAuthDetails!.password) {
        await ThrowValidationException500(startTime);
      }

      traceService.addBreadcrumb("auth", "Validating password", "info");

      try {
        const passwordValidation = await AuthPasswordService.validatePassword(
          userAuthDetails!.password!,
          password!,
          payload.sub,
          requestContext.ip,
          requestContext.userAgent,
        );

        if (!passwordValidation.valid) {
          traceService.addBreadcrumb("auth", "Password validation failed", "warning");
          await ThrowValidationException401(startTime);
        }

        traceService.addBreadcrumb("auth", "Password validation successful", "info");
      } catch (error) {
        if (error instanceof HTTPException && error.status === 429) {
          throw error;
        }
        await ThrowValidationException401(startTime);
      }
    }

    const sessionService = getSessionCreateService();
    const sessionResult = await sessionService.createUserSession(
      payload.sub,
      {
        userAgent: requestContext.userAgent,
        accept: requestContext.headers["accept"] || "unknown",
        lang: requestContext.headers["Accept-Language"] || "unknown",
      },
      requestContext.ip,
      c,
      false,
      TextTransformations.fromBufferToBase64(await EncryptionSystemUserService.generatePasswordDerivedKey(password!, payload.sub)),
    );

    await getUserAsymmetricKeysService().ensureKeyPairFromSession(
      payload.sub,
      sessionResult.accessToken,
    );

    useSetCookie(
      c,
      AUTH_HEADER_NAMING.access,
      sessionResult.accessToken,
      JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
    );
    await useSetSignedCookie(
      c,
      AUTH_HEADER_NAMING.refresh,
      sessionResult.refreshToken,
      JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
    );
    useSetSessionKeyCookie(c, sessionResult.sessionKey, JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration);

    traceService.addBreadcrumb("auth", "Challenge verification successful", "info");

    // Set challenge grace period so same IP isn't re-challenged
    const graceCache = await getCache();
    const challengeGraceKey = `${payload.sub}:${requestContext.ip}`;

    await graceCache.set(
      CACHE_NAMESPACES.AUTH.CHALLENGE_GRACE,
      challengeGraceKey,
      getTimeNow(),
      { ttl: 24 * 60 * 60 }, // 24-hour grace period
    );

    traceService.addBreadcrumb("auth", "Challenge grace period set", "info", {
      ip: IPLookupUtils.anonymizeIP(requestContext.ip),
      ttl: "24h",
    });

    return { data: { success: true as const }, status: 200 as const };
  },
);

const ThrowValidationException401 = async (
  startTime: number,
): Promise<never> => {
  await ensureMinimumProcessingTime(
    startTime,
    TIMING_PROFILES.AUTH,
  );
  throw new AppHttpException(401, {
    message: HTTP_EXCEPTION_COMMON_ERRORS.UNAUTHORIZED.message,
    messageKey: HTTP_EXCEPTION_COMMON_ERRORS.UNAUTHORIZED.messageKey,
  });
};

const ThrowValidationException500 = async (
  startTime: number,
): Promise<never> => {
  await ensureMinimumProcessingTime(
    startTime,
    TIMING_PROFILES.AUTH,
  );
  throw new AppHttpException(500, {
    message: "Internal Server Error",
    messageKey: "common.errors.internal-server-error",
  });
};
