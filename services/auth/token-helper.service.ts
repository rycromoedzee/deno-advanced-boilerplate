/**
 * @file services/auth/token-helper.service.ts
 * @description Authentication token generation and management service
 * Handles intermediate tokens for 2FA flows
 */

import { HonoContext } from "@deps";
import { getTokenHelperService, tokenHashString } from "@services/token/index.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { useSetCookie } from "@utils/cookie.ts";
import { ITokensDeviceTypeOptions, ITokensSessionData } from "@services/token/config.ts";
import { EncryptionSystemUserService } from "@services/encryption/index.ts";
import { AUTH_HEADER_NAMING } from "../session/index.ts";
import { AppHttpException } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { Span } from "@interfaces/tracing.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";

/**
 * Authentication Token Helper Service
 * Handles intermediate token generation and validation for 2FA flows
 */
export class AuthTokenHelperService {
  /**
   * Generates and stores an intermediate authentication token (2FA)
   * Uses the same structure as generateJwtAuthToken for consistency
   *
   * @param c - The Hono context
   * @param tokenTTL - The token TTL in seconds
   * @param userId - The user ID
   * @param tokenType - The token type (TWO_FACTOR)
   * @param audience - The audience for the token
   * @param deviceInfo - Device information for session tracking
   * @param ipAddress - IP address for session tracking
   * @param derivedPasswordKeys - Optional map of userId -> derivedPasswordKey for users with enhanced encryption
   * @param additionalPayload - Optional additional data for JWT payload
   * @returns The generated token
   */
  static async generateAndStoreToken(
    c: HonoContext,
    tokenTTL: number,
    userId: string,
    tokenType: JWT_TOKEN_TYPES,
    audience: string,
    deviceInfo: ITokensDeviceTypeOptions,
    ipAddress: string,
    derivedPasswordKeys?: Record<string, string>,
    additionalPayload?: Record<string, unknown>,
  ): Promise<string> {
    return await tracedWithServiceErrorHandling(
      "AuthTokenHelperService.generateAndStoreToken",
      {
        service: "AuthTokenHelperService",
        method: "generateAndStoreToken",
        section: loggerAppSections.AUTH,
        details: { userId, tokenType, audience },
      },
      "AUTH.TOKEN_GENERATION_FAILED",
      async (_span: Span) => {
        // Generate the JWT token
        const verifyToken = await getTokenHelperService().signTokenJWT(
          tokenTTL,
          userId,
          tokenType,
          audience,
          additionalPayload,
        );

        const tokenHash = tokenHashString(verifyToken);
        const now = getTimeNow();

        // Create session data matching generateJwtAuthToken structure
        const sessionData: ITokensSessionData = {
          userId,
          tokenHash,
          deviceInfo,
          createdAt: now,
          ipAddress,
          environmentId: additionalPayload?.environmentId as string,
        };

        // Store session data in cache
        await (await getCache()).set(
          CACHE_NAMESPACES.AUTH.JWT_SESSION,
          tokenHash,
          sessionData,
          { ttl: tokenTTL },
        );

        // Set cookie
        useSetCookie(
          c,
          AUTH_HEADER_NAMING.access,
          verifyToken,
          tokenTTL,
        );

        // Cache password-derived keys if provided
        if (derivedPasswordKeys && Object.keys(derivedPasswordKeys).length > 0) {
          try {
            const derivedKey = derivedPasswordKeys[userId] ?? Object.values(derivedPasswordKeys)[0];
            if (derivedKey) {
              await EncryptionSystemUserService.storePasswordDerivedKeyInCache(
                verifyToken,
                tokenTTL,
                derivedKey,
              );
            } else {
              useLogger(LoggerLevels.warn, {
                message: "generateAndStoreToken: no derived key found for single-user 2FA token — encryptionData will be missing",
                messageKey: "auth.token_helper.single_user_derived_key_missing",
                section: loggerAppSections.AUTH,
                details: { userId, tokenType, derivedPasswordKeyUserIds: Object.keys(derivedPasswordKeys) },
              });
            }
          } catch (error) {
            // Re-throw AppHttpException instances
            if (error instanceof AppHttpException) {
              throw error;
            }

            // Log error but don't fail the token generation
            useLogger(LoggerLevels.warn, {
              message: "Failed to cache password-derived key",
              messageKey: "auth.token_helper.cache_key_failed",
              section: loggerAppSections.AUTH,
              details: { userId, tokenType },
              raw: error,
            });
          }
        }

        return verifyToken;
      },
    );
  }

  /**
   * Generates and stores a 2FA challenge token
   */
  static generateTwoFactorToken(
    c: HonoContext,
    userId: string,
    deviceInfo: ITokensDeviceTypeOptions,
    ipAddress: string,
    derivedPasswordKeys?: Record<string, string>,
  ): Promise<string> {
    return this.generateAndStoreToken(
      c,
      JWT_TOKEN_CONFIG.tokenTTL.twoFactor,
      userId,
      JWT_TOKEN_TYPES.TWO_FACTOR,
      JWT_TOKEN_CONFIG.audiences.twoFactor,
      deviceInfo,
      ipAddress,
      derivedPasswordKeys,
    );
  }
}
