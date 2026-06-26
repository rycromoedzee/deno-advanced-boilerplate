/**
 * @file handlers/auth/two-factor.handler.ts
 * @description Two Factor request handler
 */
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { twoFactorAuthRoute } from "@routes/auth/two-factor.route.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { useGetCookie, useSetCookie, useSetSessionKeyCookie, useSetSignedCookie } from "@utils/cookie.ts";
import {
  AUTH_HEADER_NAMING,
  getSessionCreateService,
  getSessionRevocationService,
  getSessionValidationService,
} from "@services/session/index.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { getUserAsymmetricKeysService, getUserEnhancedEncryptionSettingsService, getUserLookupService } from "@services/user/index.ts";
import { AuthTOTPValidationService } from "@services/auth/index.ts";
import { EncryptionSystemUserService } from "@services/encryption/index.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";
import { SchemaTwoFactorAuthResponse } from "@models/auth/auth-response.model.ts";

const cleanupTwoFactorSession = async (token: string) => {
  const revocationService = getSessionRevocationService();
  await Promise.all([
    revocationService.revokeJWTSession(token),
    EncryptionSystemUserService.clearCachedDerivedKeysForToken(token),
  ]);
};

export const twoFactorAuthHandler = defineHandler(
  {
    route: twoFactorAuthRoute,
    operationName: "auth_two_factor",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaTwoFactorAuthResponse,
  },
  async ({ c, body, traceService }) => {
    if (c.req.method !== "POST") {
      await useLogger(LoggerLevels.warn, {
        messageKey: "http.method-invalid",
        section: loggerAppSections.AUTH,
        message: `HTTP => Invalid method provided to ${c.req.path}`,
        details: { method: c.req.method, expected: "POST" },
      });
      throwHttpError("COMMON.METHOD_NOT_ALLOWED");
    }

    const requestContext = IPLookupUtils.getRequestContext(c);
    const startTime = performance.now();

    const { code } = body;

    traceService.addBreadcrumb("auth", "2FA verification started", "info");

    // Get 2FA challenge token from cookie
    const token = useGetCookie(c, AUTH_HEADER_NAMING.access);
    if (!token) {
      await useLogger(LoggerLevels.warn, {
        messageKey: "auth.2fa.missing-token",
        section: loggerAppSections.AUTH,
        message: "2FA challenge token not found in cookies",
        details: {
          ip: IPLookupUtils.anonymizeIP(requestContext.ip),
          userAgent: requestContext.userAgent.substring(0, 100),
        },
      });

      await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    // Get validated token data
    const sessionData = await getSessionValidationService()
      .validateJWTSession(
        token!,
        JWT_TOKEN_CONFIG.audiences.twoFactor,
        JWT_TOKEN_TYPES.TWO_FACTOR,
      );

    const userId = sessionData.userId;

    // Lookup user in Global DB
    const user = await getUserLookupService()
      .findUserById(userId);

    if (!user || !user.isTwoFactorEnabled) {
      traceService.addBreadcrumb("auth", "No 2FA user found", "warning");
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const targetUser = user!;

    traceService.addBreadcrumb("auth", "2FA user found", "info", {
      userId: targetUser.id,
    });

    // Try TOTP validation first
    const validationResult = await AuthTOTPValidationService
      .validateTwoFactorCode(
        targetUser.id,
        code,
      );

    // If TOTP fails, try backup code validation
    if (!validationResult.isValid) {
      traceService.addBreadcrumb("auth", "TOTP validation failed, trying backup code", "info");

      const backupCodeResult = await AuthTOTPValidationService
        .validateBackupCode(
          targetUser.id,
          code,
        );

      if (!backupCodeResult.isValid) {
        traceService.addBreadcrumb("auth", "2FA code validation failed (TOTP and backup code)", "warning");
        throwHttpError("AUTH.UNAUTHORIZED");
      }

      traceService.addBreadcrumb("auth", "2FA backup code validated", "info");
    } else {
      traceService.addBreadcrumb("auth", "2FA TOTP code validated", "info");
    }

    // Extract password-derived key from the intermediate session cache.
    const derivedKey = await EncryptionSystemUserService
      .fetchPasswordDerivedKeyFromSession(
        token!,
        JWT_TOKEN_CONFIG.audiences.twoFactor,
        JWT_TOKEN_TYPES.TWO_FACTOR,
      );

    // The password-derived key exists ONLY to unwrap the E2EE master key, so it
    // is mandatory solely for users who have enhanced encryption enabled.
    //   - Password+2FA logins ALWAYS stash the key during the password step, so
    //     `derivedKey` is present and this branch is INERT for them.
    //   - A passwordless magic-link 2FA challenge carries no key — which is fine
    //     IFF the user has E2EE disabled (data then uses the app-controlled key).
    // Re-reading the flag from the DB (instead of trusting anything inside the
    // challenge token) is also a defense-in-depth backstop: an E2EE-ENABLED user
    // can NEVER complete a key-less session here, even if an upstream routing bug
    // minted a key-less challenge for them. The lookup runs only on the
    // key-absent path, so password+2FA pays nothing. Do NOT drop the E2EE check —
    // that would let E2EE-on users through without a master key (see the locked
    // regression test in tests/integration/handlers/auth/two-factor.test.ts).
    const derivedKeyRequiredButMissing = !derivedKey &&
      await getUserEnhancedEncryptionSettingsService()
        .hasEnhancedEncryptionEnabled(targetUser.id);
    if (derivedKeyRequiredButMissing) {
      throwHttpError("AUTH.CREDS_INVALID");
    }

    const sessionService = getSessionCreateService();
    const _sessionResult = await sessionService.createUserSession(
      targetUser.id,
      {
        userAgent: requestContext.userAgent,
        accept: requestContext.headers["accept"] || "unknown",
        lang: requestContext.headers["Accept-Language"] || "unknown",
      },
      requestContext.ip,
      c,
      false,
      derivedKey ?? undefined,
    );

    await getUserAsymmetricKeysService().ensureKeyPairFromSession(
      targetUser.id,
      _sessionResult.accessToken,
      undefined,
      undefined,
      undefined,
      targetUser.environmentId, // Pass environmentId to avoid getTenantDB error
    );

    useSetCookie(
      c,
      AUTH_HEADER_NAMING.access,
      _sessionResult.accessToken,
      JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
    );
    await useSetSignedCookie(
      c,
      AUTH_HEADER_NAMING.refresh,
      _sessionResult.refreshToken,
      JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
    );
    useSetSessionKeyCookie(c, _sessionResult.sessionKey, JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration);

    traceService.addBreadcrumb("auth", "2FA verification successful", "info", {
      userId: targetUser.id,
      environmentId: targetUser.environmentId,
    });

    await cleanupTwoFactorSession(token!);

    return {
      data: {
        nextStep: "direct-login" as const,
        isAuthCompleted: true,
        message: "2FA verification successful",
        userId: targetUser.id,
        environmentId: targetUser.environmentId,
        displayName: `${targetUser.firstName} ${targetUser.lastName}`.trim(),
      },
      status: 200 as const,
    };
  },
);
