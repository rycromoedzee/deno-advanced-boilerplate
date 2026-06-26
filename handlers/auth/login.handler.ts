/**
 * @file handlers/auth/login.handler.ts
 * @description Login request handler
 */
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { authLoginRoute } from "@routes/auth/login.route.ts";
import { loggerAppSections, LoggerLevels, useLogger, useLogSecurityEvent } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { AUTH_HEADER_NAMING, getSessionCreateService } from "@services/session/index.ts";
import { AuthPasswordService, getUserMasterKeySetupService } from "@services/auth/index.ts";
import { useSetCookie, useSetSessionKeyCookie, useSetSignedCookie } from "@utils/cookie.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { EncryptionSystemUserService } from "@services/encryption/index.ts";
import { AuthTokenHelperService, getAuthUserLookupService } from "@services/auth/index.ts";
import { getUserAsymmetricKeysService } from "@services/user/index.ts";
import { AuthFlowType } from "@interfaces/auth.ts";
import { IUserWithEnvironment } from "@interfaces/user.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/index.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { getCache } from "@services/cache/index.ts";
import { SchemaAuthLoginResponse } from "@models/auth/auth-response.model.ts";
import { traced } from "@services/tracing/index.ts";

const LOGIN_LOCKOUT_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_TTL_SECONDS = 900;
const LOGIN_ATTEMPTS_TTL_SECONDS = 1800;

const LOGIN_LOCKOUT_NS = "login_lockout";
const LOGIN_ATTEMPTS_NS = "login_attempts";

async function derivePasswordKey(
  userId: string,
  password: string,
  operationContext: string,
  environmentId?: string,
): Promise<string | undefined> {
  try {
    return await traced("auth_login.derivePasswordKey", "service", async (span) => {
      span.attributes["operation_context"] = operationContext;
      span.attributes["has_environment_id"] = !!environmentId;
      return TextTransformations.fromBufferToBase64(
        await EncryptionSystemUserService.generatePasswordDerivedKey(
          password,
          userId,
          environmentId,
        ),
      );
    });
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      messageKey: "auth.encryption-key-derivation-error",
      section: loggerAppSections.AUTH,
      message: `Password key derivation failed during ${operationContext}`,
      details: {
        operation: "encryption-key-derivation",
        userId,
        operationContext,
        encryptionType: "password-derived-key",
        error: error instanceof Error ? error.message : "Unknown error",
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        stack: error instanceof Error ? error.stack : undefined,
        cause: error instanceof Error && error.cause ? String(error.cause) : undefined,
      },
    });

    throwHttpError("AUTH.ENCRYPTION_FAILED");
  }
}

// Helper function to generate two-factor token with error handling
async function generateTwoFactorTokenWithErrorHandling(
  c: Parameters<typeof AuthTokenHelperService.generateTwoFactorToken>[0],
  userId: string,
  headers: Parameters<typeof AuthTokenHelperService.generateTwoFactorToken>[2],
  ip: string,
  derivedPasswordKeys?: Record<string, string>,
  operationContext?: string,
): Promise<void> {
  await AuthTokenHelperService.generateTwoFactorToken(
    c,
    userId,
    headers,
    ip,
    derivedPasswordKeys,
  ).catch(async (error) => {
    await useLogger(LoggerLevels.error, {
      messageKey: "auth.two-factor-token-generation-error",
      section: loggerAppSections.AUTH,
      message: `Two-factor token generation failed during ${operationContext || "authentication"}`,
      details: {
        operation: "two-factor-token-generation",
        userId,
        operationContext: operationContext || "authentication",
        error: error instanceof Error ? error.message : "Unknown error",
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
    });

    throwHttpError("AUTH.TOKEN_GENERATION_FAILED");
  });
}

export const authLoginHandler = defineHandler(
  {
    route: authLoginRoute,
    operationName: "auth_login",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaAuthLoginResponse,
  },
  async ({ c, body, traceService }) => {
    const startTime = performance.now();

    const { email, password } = body;

    traceService.addBreadcrumb("auth", "Login attempt started", "info", {
      email,
    });

    const requestContext = IPLookupUtils.getRequestContext(c);

    traceService.addBreadcrumb("auth", "Request context received", "info", {
      requestContext,
    });

    // Lookup user and determine authentication flow
    const authUserLookupService = getAuthUserLookupService();
    const authContext = await authUserLookupService.lookupUsersForAuthentication(
      c.req.url,
      email,
    ).catch(async (error) => {
      await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.PASSWORD);
      traceService.addBreadcrumb("auth", "email not found", "error", {
        email,
        error,
      });

      throwHttpError("AUTH.UNAUTHORIZED");
    });

    traceService.addBreadcrumb("auth", "User found, validating password", "info", {
      flowType: authContext.flowType,
    });

    const users = authContext.users as unknown[];
    const userId = (users[0] as Record<string, unknown>).id as string;

    const cache = await getCache();
    const lockoutKey = `${userId}:${requestContext.ip}`;
    const lockoutEntry = await cache.get<number>(LOGIN_LOCKOUT_NS, lockoutKey);
    if (lockoutEntry !== null) {
      await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.PASSWORD);
      throwHttpError("AUTH.ACCOUNT_LOCKED_TOO_MANY_ATTEMPTS");
    }

    // Validate password with progressive delay protection
    const passwordValidation = await AuthPasswordService.validatePassword(
      authContext.password,
      password,
      userId,
      requestContext.ip,
      requestContext.userAgent,
    ).catch(async (_) => {
      await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.PASSWORD);
      throwHttpError("AUTH.UNAUTHORIZED");
    });

    if (!passwordValidation.valid) {
      if (passwordValidation.delayResult) {
        await useLogSecurityEvent(
          LoggerLevels.warn,
          "Password validation repeately failed",
          "medium",
          loggerAppSections.AUTH,
          "auth.password-validation.failed-progressive-delay",
          {
            operation: "password-validation",
            email,
            userId: userId,
            operationContext: "progressive delay triggered",
            delayResult: passwordValidation.delayResult,
            error: passwordValidation.delayResult,
          },
        );

        throwHttpError("AUTH.TEMPORARILY_BLOCKED");
      }
      const attempts = (await cache.get<number>(LOGIN_ATTEMPTS_NS, lockoutKey)) || 0;
      const newAttempts = attempts + 1;
      await cache.set(LOGIN_ATTEMPTS_NS, lockoutKey, newAttempts, { ttl: LOGIN_ATTEMPTS_TTL_SECONDS });
      if (newAttempts >= LOGIN_LOCKOUT_MAX_ATTEMPTS) {
        await cache.set(LOGIN_LOCKOUT_NS, lockoutKey, 1, { ttl: LOGIN_LOCKOUT_TTL_SECONDS });
        await cache.delete(LOGIN_ATTEMPTS_NS, lockoutKey);
        await useLogSecurityEvent(
          LoggerLevels.warn,
          "Account locked out due to too many failed login attempts",
          "high",
          loggerAppSections.AUTH,
          "auth.account-lockout.triggered",
          {
            operation: "account-lockout",
            email,
            userId: userId,
            attempts: newAttempts,
            lockoutDuration: LOGIN_LOCKOUT_TTL_SECONDS,
          },
        );
      }
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.PASSWORD);

    // Clear failed attempts on successful password validation
    await cache.delete(LOGIN_ATTEMPTS_NS, lockoutKey).catch(() => {});

    const user = authContext.users[0] as IUserWithEnvironment;

    if (authContext.flowType === AuthFlowType.TWO_FA_SINGLE) {
      const derivedPasswordKey = await derivePasswordKey(
        user.id,
        password,
        "two-factor authentication setup",
        user.environmentId,
      );
      const derivedPasswordKeys = derivedPasswordKey ? { [user.id]: derivedPasswordKey } : undefined;

      await generateTwoFactorTokenWithErrorHandling(
        c,
        user.id,
        {
          userAgent: requestContext.userAgent,
          accept: requestContext.headers["accept"] || "unknown",
          lang: requestContext.headers["Accept-Language"] || "unknown",
        },
        requestContext.ip,
        derivedPasswordKeys,
        "two-factor authentication setup",
      );

      traceService.addBreadcrumb("auth", "Two-factor token generated", "info", {
        nextStep: "two-factor",
      });

      return {
        data: {
          message: "2FA verification required",
          redirectTo: "/api/auth/two-factor",
          isAuthCompleted: false,
          nextStep: "two-factor" as const,
          postTwoFactorNextStep: "direct-login" as const,
        },
        status: 202 as const,
      };
    }

    traceService.addBreadcrumb("auth", "Direct login flow (no 2FA)", "info");

    // For direct login (no 2FA), derive key if enhanced encryption is enabled
    const sessionService = getSessionCreateService();
    const derivedPasswordKey = await derivePasswordKey(
      user.id,
      password,
      "direct login",
      user.environmentId,
    );

    const sessionResult = await sessionService.createUserSession(
      user.id,
      {
        userAgent: requestContext.userAgent,
        accept: requestContext.headers["accept"] || "unknown",
        lang: requestContext.headers["Accept-Language"] || "unknown",
      },
      requestContext.ip,
      c,
      false,
      derivedPasswordKey!,
    ).catch(async (error) => {
      await useLogger(LoggerLevels.error, {
        messageKey: "auth.session-creation-error",
        section: loggerAppSections.AUTH,
        message: "Session creation failed during direct login",
        details: {
          operation: "session-creation",
          userId: user.id,
          operationContext: "direct login",
          sessionType: "user-session",
          error: error instanceof Error ? error.message : "Unknown error",
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        },
      });

      throwHttpError("AUTH.SESSION_CREATION_FAILED");
    });

    // Ensure master key exists for password-based users (idempotent — no-op if already set)

    await getUserMasterKeySetupService().ensureMasterKeyForPassword(user.id, password, user.environmentId).catch(async (error) => {
      await useLogger(LoggerLevels.warn, {
        messageKey: "auth.master-key-setup-error",
        section: loggerAppSections.AUTH,
        message: "Master key setup failed during login (non-fatal)",
        details: {
          userId: user.id,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    });

    await getUserAsymmetricKeysService().ensureKeyPairFromSession(
      user.id,
      sessionResult.accessToken,
      undefined,
      undefined,
      sessionResult.sessionKey,
      user.environmentId,
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

    traceService.addBreadcrumb("auth", "Login successful", "info", {
      userId: user.id,
    });

    return {
      data: {
        message: "Login successful",
        isAuthCompleted: true,
        nextStep: "direct-login" as const,
        userId: user.id,
        environmentId: user.environmentId,
        displayName: `${user.firstName} ${user.lastName}`.trim(),
      },
      status: 200 as const,
    };
  },
);
