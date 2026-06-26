/**
 * @file services/session/session-create.service.ts
 * @description Service responsible for creating user sessions and API keys
 */
import { ITokensDeviceTypeOptions } from "@services/token/config.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { SessionRateLimiter } from "./session-rate-limit.service.ts";
import { getSessionRateLimiter, getSessionValidationService } from "./singletons.ts";
import { useSessionLogSecurityEvent } from "./session-security-validation.service.ts";

import { ISessionCreationResult } from "@interfaces/session.ts";
import { useValidateDeviceInfo, useValidateIpBeforeInsert } from "@utils/security-check.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { generateJwtAuthToken } from "../token/token.service.ts";
import { JWTAuthTokenCreateFingerprint } from "@services/token/token-utils.ts";
import { ITokensCurrentSessions, ITokensRefreshTokenData } from "@services/token/config.ts";
import { HonoContext } from "@deps";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { ITokensSessionData } from "@services/token/config.ts";
import { generateRefreshTokenBytes, tokenHashString } from "@services/token/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { EncryptionSystemUserService } from "../encryption/index.ts";
import { UserLookupService } from "../user/lookup.service.ts";
import { UserEnhancedEncryptionSettingsService } from "../user/enhanced-encryption.service.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";
import { MAX_ACTIVE_SESSIONS } from "./session.constants.ts";
import { generateEphemeralSessionKey } from "@utils/cookie.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { RefreshTokenRepository } from "./refresh-token.repository.ts";

function matchesCurrentSession(
  session: ITokensCurrentSessions,
  match: { sessionId?: string; accessTokenHash?: string; refreshTokenHash?: string },
): boolean {
  if (match.sessionId && session.sessionId === match.sessionId) {
    return true;
  }

  if (match.refreshTokenHash && session.refreshTokenHash === match.refreshTokenHash) {
    return true;
  }

  const accessTokenHash = session.accessTokenHash ?? session.tokenHash;
  if (match.accessTokenHash && accessTokenHash === match.accessTokenHash) {
    return true;
  }

  return false;
}

function trimAndAppendSession(
  sessions: ITokensCurrentSessions[],
  nextSession: ITokensCurrentSessions,
): ITokensCurrentSessions[] {
  const trimmedSessions = sessions.slice(-Math.max(1, MAX_ACTIVE_SESSIONS - 1));
  return [...trimmedSessions, nextSession];
}

/**
 * Service responsible for creating user sessions and API keys
 */
export class SessionCreationService {
  private rateLimiterService: SessionRateLimiter;
  private userLookupService: UserLookupService;
  private refreshTokenRepository: RefreshTokenRepository;

  constructor() {
    // Use singleton getter for consistent rate limiting across all instances
    this.rateLimiterService = getSessionRateLimiter();
    this.userLookupService = new UserLookupService();
    this.refreshTokenRepository = new RefreshTokenRepository();
  }

  /**
   * Creates a new user session with JWT access token and refresh token
   * @param userId - The user ID to create session for
   * @param deviceInfo - Device information for fingerprinting and tracking
   * @param ipAddress - IP address of the user for session tracking
   * @param _honoContext - Hono context for logging (unused by this method, kept for signature parity)
   * @param isLongLived - If true, uses long-lived refresh token lifespan (90 days vs 45 days)
   * @param derivedPasswordKey - Optional already-derived password key (used in 2FA/multi-user flows)
   * @returns Promise<ISessionCreationResult> - Contains access token, refresh token, and expiration times
   * @throws Error if session creation fails
   */
  async createUserSession(
    userId: string,
    deviceInfo: ITokensDeviceTypeOptions,
    ipAddress: string,
    _honoContext: HonoContext,
    isLongLived = false,
    derivedPasswordKey?: string,
  ): Promise<ISessionCreationResult> {
    return await tracedWithServiceErrorHandling(
      "SessionCreationService.createUserSession",
      {
        service: "SessionCreationService",
        method: "createUserSession",
        section: loggerAppSections.SESSION,
        details: { userId, ipAddress },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["is_long_lived"] = isLongLived;
        span.attributes["ip_address"] = ipAddress;
        span.attributes["has_password_derived_key"] = !!derivedPasswordKey;

        // Enhanced input validation using SecurityValidator
        const validatedDeviceInfo = useValidateDeviceInfo(
          deviceInfo,
          true,
        );

        const ipAddressResponse = useValidateIpBeforeInsert([ipAddress]);
        if (!ipAddressResponse.isSuccess) {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }
        const validatedIpAddress = ipAddress;

        // Check rate limiting for session creation
        const rateLimitResult = await this.rateLimiterService.checkRateLimit(
          validatedIpAddress,
          "SESSION_CREATION",
        );
        if (!rateLimitResult.allowed) {
          useSessionLogSecurityEvent(
            LoggerLevels.warn,
            "SessionCreationService",
            "medium",
            "SESSION_CREATION_RATE_LIMITED",
            {
              ipAddress: validatedIpAddress,
              userId: userId,
              remainingAttempts: rateLimitResult.remainingAttempts,
              resetTime: rateLimitResult.resetTime,
            },
          );

          throwHttpError("RATE_LIMIT.TOO_MANY_REQUESTS");
        }

        const now = getTimeNow();
        const sessionId = generateIdRandom();

        // Fetch user with environment information for the JWT payload
        const userWithEnvironment = await this.userLookupService.findUserById(
          userId,
        );
        if (!userWithEnvironment) {
          throwHttpError("USER.NOT_FOUND");
        }

        // Generate JWT access token with environmentId and cached user profile
        const token = await generateJwtAuthToken(
          {
            sub: userId,
            type: JWT_TOKEN_TYPES.AUTH,
            aud: JWT_TOKEN_CONFIG.audiences.auth,
            environmentId: userWithEnvironment.environmentId,
          },
          ipAddress,
          {
            userAgent: validatedDeviceInfo.userAgent,
            accept: validatedDeviceInfo.accept,
            lang: validatedDeviceInfo.lang,
          },
          {
            firstName: userWithEnvironment.firstName,
            lastName: userWithEnvironment.lastName,
          },
          sessionId,
        );
        const tokenHash = tokenHashString(token);

        // Generate refresh token with appropriate lifespan
        const maxAgeType = isLongLived ? JWT_TOKEN_CONFIG.tokenTTL.lifeSpanLongLived : JWT_TOKEN_CONFIG.tokenTTL.lifeSpan;

        const refreshToken = await this.createAndStoreRefreshToken(
          sessionId,
          userId,
          validatedDeviceInfo,
          ipAddress,
          now,
          now + (maxAgeType * 1000),
          maxAgeType,
        );
        const refreshTokenHash = tokenHashString(refreshToken);
        const cache = await getCache();

        await cache.withLock(`user_sessions_lock:${userId}`, async () => {
          const existingSessions = await cache.get<ITokensCurrentSessions[]>(
            CACHE_NAMESPACES.AUTH.USER_SESSIONS,
            userId,
          );

          const updatedSessions = trimAndAppendSession(existingSessions ?? [], {
            sessionId,
            ipAddress: validatedIpAddress,
            userAgent: validatedDeviceInfo.userAgent,
            createdAt: now,
            accessTokenHash: tokenHash,
            refreshTokenHash,
          });

          await cache.set(
            CACHE_NAMESPACES.AUTH.USER_SESSIONS,
            userId,
            updatedSessions,
            { ttl: JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration },
          );
        });

        // Generate ephemeral session key for client-bound cache encryption.
        // This key is returned to the caller to be set as a cookie. Since it's never
        // stored server-side, a cache/DB dump alone cannot decrypt the cached derived key.
        const sessionKey = generateEphemeralSessionKey();

        // Store password-derived key only when available (e.g. password auth).
        // Passkey flows can establish encryption context separately (PRF).
        if (derivedPasswordKey) {
          span.attributes["password_key_cache_skipped"] = false;
          await EncryptionSystemUserService.storePasswordDerivedKeyInCache(
            token,
            JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
            derivedPasswordKey,
            sessionKey,
          );

          await EncryptionSystemUserService.storePasswordDerivedKeyWithRefreshToken(
            refreshToken,
            JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
            derivedPasswordKey,
            sessionKey,
          );
        } else {
          span.attributes["password_key_cache_skipped"] = true;
        }

        const sessionResult = {
          accessToken: token,
          refreshToken: refreshToken,
          expiresAt: now + (JWT_TOKEN_CONFIG.tokenTTL.authExpiration * 1000),
          refreshExpiresAt: now +
            (JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration * 1000),
          sessionKey,
        };
        return sessionResult;
      },
    );
  }

  /**
   * Creates and stores a refresh token in the cache.
   * @param userId - User ID.
   * @param deviceInfo - Device information for fingerprinting.
   * @param ipAddress - IP address of the user.
   * @param timeNow - Current timestamp.
   * @param expiresAt - Expiration timestamp.
   * @returns Promise<string> The refresh token string.
   * @private
   */
  private async createAndStoreRefreshToken(
    sessionId: string,
    userId: string,
    deviceInfo: ITokensDeviceTypeOptions,
    ipAddress: string,
    timeNow: number,
    expiresAt: number,
    maxAgeType: number,
  ): Promise<string> {
    return await tracedWithServiceErrorHandling(
      "SessionCreationService.createAndStoreRefreshToken",
      {
        service: "SessionCreationService",
        method: "createAndStoreRefreshToken",
        section: loggerAppSections.SESSION,
        details: { userId, sessionId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["ip_address"] = ipAddress;
        span.attributes["max_age_type"] = maxAgeType;

        const validatedDeviceInfo = useValidateDeviceInfo(deviceInfo, true);

        const stringified = btoa(
          String.fromCharCode(...generateRefreshTokenBytes()),
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        const refreshTokenHash = tokenHashString(stringified);

        const refreshPayload: ITokensRefreshTokenData = {
          sessionId,
          userId,
          fingerprint: JWTAuthTokenCreateFingerprint(
            validatedDeviceInfo.userAgent,
            validatedDeviceInfo.accept,
            validatedDeviceInfo.lang,
          ),
          expiresAt,
          ipAddress,
          maxAgeType,
          createdAt: timeNow,
        };

        await (await getCache()).set(
          CACHE_NAMESPACES.AUTH.REFRESH_TOKENS,
          refreshTokenHash,
          refreshPayload,
          { ttl: JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration },
        );

        try {
          await this.refreshTokenRepository.save(refreshTokenHash, refreshPayload);
          span.attributes["db_persisted"] = true;
        } catch (dbError) {
          span.attributes["db_persisted"] = false;
          span.attributes["db_error"] = dbError instanceof Error ? dbError.message : "Unknown error";
        }

        span.attributes["success"] = true;
        return stringified;
      },
    );
  }

  /**
   * Clears encryption data from a session
   * @param accessToken - The access token to clear encryption data for
   */
  async clearSessionEncryption(accessToken: string): Promise<void> {
    try {
      const tokenHash = tokenHashString(accessToken);
      const cache = await getCache();

      // Get existing session data
      const sessionData = await cache.get<ITokensSessionData>(
        CACHE_NAMESPACES.AUTH.JWT_SESSION,
        tokenHash,
      );

      if (!sessionData) {
        return; // Session doesn't exist, nothing to clear
      }

      // Remove encryption data but keep the session
      const updatedSession: ITokensSessionData = {
        ...sessionData,
        encryptionData: undefined,
      };

      // Update session without encryption data
      await cache.set(
        CACHE_NAMESPACES.AUTH.JWT_SESSION,
        tokenHash,
        updatedSession,
        { ttl: JWT_TOKEN_CONFIG.tokenTTL.authExpiration },
      );
    } catch (error) {
      // Re-throw intentional HTTP exceptions
      if (error instanceof AppHttpException) {
        throw error;
      }

      // Log unexpected errors (but don't throw - this is a cleanup operation)
      useLogger(LoggerLevels.error, {
        message: "Unexpected error clearing session encryption",
        messageKey: "session.clear_session_encryption.unexpected_error",
        raw: error,
        section: loggerAppSections.SESSION,
      });
    }
  }

  /**
   * Checks if a session has cached encryption data
   * @param accessToken - The access token to check
   * @returns Promise<boolean> - True if session has encryption data
   */
  async hasSessionEncryption(accessToken: string): Promise<boolean> {
    try {
      const tokenHash = tokenHashString(accessToken);
      const cache = await getCache();

      const sessionData = await cache.get<ITokensSessionData>(
        CACHE_NAMESPACES.AUTH.JWT_SESSION,
        tokenHash,
      );

      return !!(sessionData?.encryptionData?.encryptedPasswordDerivedKey);
    } catch (_error) {
      return false;
    }
  }

  /**
   * Updates user session by validating refresh token and generating new tokens
   * @param refreshToken - The refresh token to validate
   * @param deviceInfo - Device information for fingerprinting
   * @param ipAddress - IP address of the user
   * @returns Promise<ISessionCreationResult> - Contains new access token, refresh token, and expiration times
   * @throws Error if refresh token is invalid or update fails
   */
  async updateUserSession(
    refreshToken: string,
    deviceInfo: ITokensDeviceTypeOptions,
    ipAddress: string,
    oldSessionKey?: string,
    oldAccessToken?: string,
  ): Promise<ISessionCreationResult> {
    return await tracedWithServiceErrorHandling(
      "SessionCreationService.updateUserSession",
      {
        service: "SessionCreationService",
        method: "updateUserSession",
        section: loggerAppSections.SESSION,
        details: { ipAddress },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["ip_address"] = ipAddress;
        span.attributes["has_old_session_key"] = !!oldSessionKey;

        // Validate device info and IP
        const validatedDeviceInfo = useValidateDeviceInfo(deviceInfo, true);
        const ipAddressResponse = useValidateIpBeforeInsert([ipAddress]);
        if (!ipAddressResponse.isSuccess) {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }

        // Validate refresh token with fingerprint validation using SessionValidationService
        const refreshTokenValidator = getSessionValidationService();
        const refreshTokenData = await refreshTokenValidator.validateRefreshToken(
          refreshToken,
          validatedDeviceInfo,
        );

        if (!refreshTokenData) {
          span.attributes["token_validation_failed"] = true;
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        const userId = refreshTokenData.userId;
        const sessionId = refreshTokenData.sessionId ?? generateIdRandom();
        span.attributes["user_id"] = userId;
        span.attributes["session_id"] = sessionId;

        // Fetch user with environment information for the JWT payload
        const userWithEnvironment = await this.userLookupService.findUserById(
          userId,
        );

        if (!userWithEnvironment) {
          span.attributes["user_not_found"] = true;
          throwHttpError("USER.NOT_FOUND");
        }

        span.attributes["environment_id"] = userWithEnvironment.environmentId;

        // Generate new access token with environmentId and cached user profile
        const newAccessToken = await generateJwtAuthToken(
          {
            sub: userId,
            type: JWT_TOKEN_TYPES.AUTH,
            aud: JWT_TOKEN_CONFIG.audiences.auth,
            environmentId: userWithEnvironment.environmentId,
          },
          ipAddress,
          validatedDeviceInfo,
          {
            firstName: userWithEnvironment.firstName,
            lastName: userWithEnvironment.lastName,
          },
          sessionId,
        );

        let maxAgeType: number = 0;

        if (refreshTokenData.maxAgeType === JWT_TOKEN_CONFIG.tokenTTL.lifeSpan) {
          maxAgeType = JWT_TOKEN_CONFIG.tokenTTL.lifeSpan;
        } else if (refreshTokenData.maxAgeType === JWT_TOKEN_CONFIG.tokenTTL.lifeSpanLongLived) {
          maxAgeType = JWT_TOKEN_CONFIG.tokenTTL.lifeSpanLongLived;
        } else {
          maxAgeType = JWT_TOKEN_CONFIG.tokenTTL.lifeSpan;
        }

        const now = getTimeNow();

        const newRefreshToken = await this.createAndStoreRefreshToken(
          sessionId,
          userId,
          validatedDeviceInfo,
          ipAddress,
          now,
          now + (maxAgeType * 1000),
          maxAgeType,
        );
        const newAccessTokenHash = tokenHashString(newAccessToken);
        const newRefreshTokenHash = tokenHashString(newRefreshToken);
        const oldRefreshTokenHash = tokenHashString(refreshToken);
        const oldAccessTokenHash = oldAccessToken ? tokenHashString(oldAccessToken) : undefined;

        // Generate a new ephemeral session key for the rotated tokens.
        // The old key decrypts from the old refresh token; the new key encrypts for new tokens.
        const newSessionKey = generateEphemeralSessionKey();

        // Re-cache encryption keys BEFORE deleting old refresh token
        // This ensures we can retrieve the keys from the old token before it's gone
        await this.reCacheEncryptionKeys(
          userId,
          refreshToken,
          newAccessToken,
          newRefreshToken,
          maxAgeType,
          oldSessionKey,
          newSessionKey,
        );

        // Now safe to delete the old refresh token after keys have been transferred
        const cache = await getCache();

        await cache.withLock(`user_sessions_lock:${userId}`, async () => {
          const existingSessions = await cache.get<ITokensCurrentSessions[]>(
            CACHE_NAMESPACES.AUTH.USER_SESSIONS,
            userId,
          );
          const currentSessions = existingSessions ?? [];

          const replacementSession: ITokensCurrentSessions = {
            sessionId,
            ipAddress,
            userAgent: validatedDeviceInfo.userAgent,
            createdAt: refreshTokenData.createdAt,
            accessTokenHash: newAccessTokenHash,
            refreshTokenHash: newRefreshTokenHash,
            lastRotatedAt: now,
          };

          const matchIndex = currentSessions.findIndex((session) =>
            matchesCurrentSession(session, {
              sessionId: refreshTokenData.sessionId,
              accessTokenHash: oldAccessTokenHash,
              refreshTokenHash: oldRefreshTokenHash,
            })
          );

          const updatedSessions = matchIndex >= 0
            ? currentSessions.map((session, index) => index === matchIndex ? replacementSession : session)
            : trimAndAppendSession(currentSessions, replacementSession);

          await cache.set(
            CACHE_NAMESPACES.AUTH.USER_SESSIONS,
            userId,
            updatedSessions,
            { ttl: JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration },
          );
        });

        await cache.delete(
          CACHE_NAMESPACES.AUTH.REFRESH_TOKENS,
          oldRefreshTokenHash,
        );

        try {
          await this.refreshTokenRepository.deleteByTokenHash(oldRefreshTokenHash);
        } catch {
          // Non-critical — cleanup job will handle it
        }

        if (oldAccessTokenHash) {
          await cache.delete(
            CACHE_NAMESPACES.AUTH.JWT_SESSION,
            oldAccessTokenHash,
          );
        }

        const sessionResult = {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresAt: now + (JWT_TOKEN_CONFIG.tokenTTL.authExpiration * 1000),
          refreshExpiresAt: now +
            (JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration * 1000),
          sessionKey: newSessionKey,
        };

        span.attributes["success"] = true;
        span.attributes["expires_at"] = sessionResult.expiresAt;
        span.attributes["refresh_expires_at"] = sessionResult.refreshExpiresAt;
        return sessionResult;
      },
    );
  }

  /**
   * Re-caches encryption keys (password-derived and PRF-derived) from the old refresh token to the new tokens
   * This ensures encryption keys persist across token refreshes (even after access token expires)
   * Supports both password-based authentication and passkey (PRF) authentication flows
   * @param userId - The user ID
   * @param oldRefreshToken - The old refresh token to retrieve keys from
   * @param newAccessToken - The new access token to cache the keys with
   * @param newRefreshToken - The new refresh token to cache the keys with
   * @param maxAgeType - The refresh token max age type for TTL
   * @private
   */
  private async reCacheEncryptionKeys(
    userId: string,
    oldRefreshToken: string,
    newAccessToken: string,
    newRefreshToken: string,
    maxAgeType: number,
    oldSessionKey?: string,
    newSessionKey?: string,
  ): Promise<void> {
    return await traced("SessionCreationService.reCacheEncryptionKeys", "service", async (span) => {
      span.attributes["user_id"] = userId;
      span.attributes["max_age_type"] = maxAgeType;
      span.attributes["has_old_session_key"] = !!oldSessionKey;
      span.attributes["has_new_session_key"] = !!newSessionKey;

      try {
        // Check if user has enhanced encryption enabled (for logging purposes)
        const encryptionService = new UserEnhancedEncryptionSettingsService();
        const hasEncryption = await encryptionService.hasEnhancedEncryptionEnabled(
          userId,
        );

        span.attributes["has_encryption"] = hasEncryption;

        // Track if we found any encryption keys to re-cache
        let foundAnyKey = false;

        // === PASSWORD-DERIVED KEY HANDLING ===
        // Retrieve password derived key from old refresh token (decrypt with old session key)
        // This works even if the access token expired (refresh tokens last 7 days)
        // IMPORTANT: This key is needed regardless of whether enhanced encryption is enabled,
        // as it's used for both app-controlled and user-controlled encryption modes.
        const passwordDerivedKey = await EncryptionSystemUserService
          .fetchPasswordDerivedKeyFromRefreshToken(oldRefreshToken, oldSessionKey);

        span.attributes["password_key_found"] = !!passwordDerivedKey;

        if (passwordDerivedKey && newSessionKey) {
          foundAnyKey = true;

          // Cache with new access token (short-lived, 15 minutes) using new session key
          await EncryptionSystemUserService.storePasswordDerivedKeyInCache(
            newAccessToken,
            JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
            passwordDerivedKey,
            newSessionKey,
          );

          // Cache with new refresh token (long-lived) using new session key
          await EncryptionSystemUserService.storePasswordDerivedKeyWithRefreshToken(
            newRefreshToken,
            JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
            passwordDerivedKey,
            newSessionKey,
          );

          span.attributes["password_key_success"] = true;
        }

        // === PRF-DERIVED KEY HANDLING (for passkey users) ===
        // Retrieve PRF-derived key from old refresh token (decrypt with old session key)
        const prfKeyData = await EncryptionSystemUserService
          .fetchPRFDerivedKeyFromRefreshToken(oldRefreshToken, oldSessionKey);

        span.attributes["prf_key_found"] = !!prfKeyData;

        if (prfKeyData && newSessionKey) {
          foundAnyKey = true;

          // Cache PRF key with new access token (short-lived, 15 minutes) using new session key
          const { PasskeyPRFService } = await import("../encryption/passkey-prf.service.ts");
          await PasskeyPRFService.cachePRFDerivedKey(
            newAccessToken,
            JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
            prfKeyData.prfDerivedKey,
            prfKeyData.prfCredentialId,
            newSessionKey,
          );

          // Cache PRF key with new refresh token (long-lived) using new session key
          await EncryptionSystemUserService.storePRFDerivedKeyWithRefreshToken(
            newRefreshToken,
            JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
            prfKeyData.prfDerivedKey,
            prfKeyData.prfCredentialId,
            newSessionKey,
          );

          span.attributes["prf_key_success"] = true;
        }

        span.attributes["success"] = foundAnyKey;

        if (!foundAnyKey) {
          // Log that we couldn't find any keys, but don't fail the refresh
          // This can happen if the old refresh token was cleared or expired
          span.attributes["no_keys_found"] = true;
          useLogger(LoggerLevels.info, {
            message: "No encryption keys found during refresh re-cache; user may need to re-authenticate",
            messageKey: "session.re_cache_keys.no_keys_found",
            details: {
              userId: userId,
              hasEnhancedEncryption: hasEncryption,
            },
            section: loggerAppSections.SESSION,
          });

          useLogger(LoggerLevels.warn, {
            message: "Could not re-cache encryption keys during token refresh",
            messageKey: "session.re_cache_keys.not_found",
            details: {
              userId: userId,
              oldRefreshTokenHash: tokenHashString(oldRefreshToken).substring(0, 10) + "...",
            },
            section: loggerAppSections.SESSION,
          });
        }
      } catch (error) {
        // Log the error but don't fail the token refresh operation
        // The user can still use the new token, they just won't have cached encryption keys
        useLogger(LoggerLevels.error, {
          message: "Unexpected error re-caching encryption keys",
          messageKey: "session.re_cache_keys.unexpected_error",
          details: {
            userId: userId,
          },
          raw: error,
          section: loggerAppSections.SESSION,
        });
      }
    });
  }
}
