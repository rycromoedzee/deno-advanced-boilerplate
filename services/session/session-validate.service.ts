/**
 * @file services/session/session-validate.service.ts
 * @description Session Validate service (session)
 */
// services/user/session/session-validation.service.ts
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";

import { ensureMinimumProcessingTime, getTimeNow, safeEqual, TIMING_PROFILES } from "@utils/shared/index.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import {
  getTokenHelperService,
  ITokensDeviceTypeOptions,
  ITokensPayloadJWT,
  ITokensRefreshTokenData,
  ITokensSessionData,
  JWTAuthTokenCreateFingerprint,
  tokenHashString,
  TokenHelperService,
} from "@services/token/index.ts";
import { loggerAppSections, LoggerLevels, useLogSecurityEvent } from "@logger/index.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";
import { traced } from "@services/tracing/index.ts";
import { REVOCATION_CHALLENGE_WINDOW_MS } from "./session.constants.ts";
import { RefreshTokenRepository } from "./refresh-token.repository.ts";

export interface ValidateJWTSessionOptions {
  preloadedSession?: ITokensSessionData | null;
}

export class ChallengeEligibleSessionRevocationError extends Error {
  readonly revokedAt: number;
  readonly userId?: string;
  readonly sessionData?: ITokensSessionData | null;

  constructor(
    revokedAt: number,
    userId?: string,
    sessionData?: ITokensSessionData | null,
  ) {
    super("JWT session was revoked within the active challenge window");
    this.name = "ChallengeEligibleSessionRevocationError";
    this.revokedAt = revokedAt;
    this.userId = userId;
    this.sessionData = sessionData;
  }
}

/**
 * Service responsible for validating JWT sessions and refresh tokens
 */
export class SessionValidationService {
  private tokenHelper: TokenHelperService;
  private refreshTokenRepository: RefreshTokenRepository;

  constructor() {
    this.tokenHelper = getTokenHelperService();
    this.refreshTokenRepository = new RefreshTokenRepository();
  }

  /**
   * Logs session validation failures for security monitoring
   * @param reason - Reason for validation failure
   * @param tokenHash - Hashed token (safe to log)
   */
  private async logSessionValidationFailure(
    reason: string,
    tokenHash: string,
  ): Promise<void> {
    // Log "not_found" cases at INFO level (expected when cache is cleared)
    // Log security-critical failures at WARN level (revoked, mismatches, expired)
    const isNotFoundCase = reason.includes("not_found");
    const logLevel = isNotFoundCase ? LoggerLevels.info : LoggerLevels.warn;
    const severity = reason.includes("revoked") || reason.includes("mismatch") ? "high" : isNotFoundCase ? "low" : "medium";

    await useLogSecurityEvent(
      logLevel,
      `Session validation failed: ${reason}`,
      severity,
      loggerAppSections.SESSION,
      "Session.Validation_Failed",
      {
        reason,
        tokenHashPrefix: tokenHash.substring(0, 8) + "...",
        timestamp: getTimeNow(),
      },
    );
  }

  /**
   * Validate JWT session (15-minute tokens) with timing attack protection
   * @param token - JWT token to validate
   * @returns Promise<ITokensSessionData> - Session data if valid
   * @throws HTTP 401 exception if session is invalid
   */
  async validateJWTSession(
    token: string,
    audience: string = JWT_TOKEN_CONFIG.audiences.auth,
    jwtTokenType: JWT_TOKEN_TYPES = JWT_TOKEN_TYPES.AUTH,
    options: ValidateJWTSessionOptions = {},
  ): Promise<ITokensSessionData> {
    return await traced("SessionValidationService.validateJWTSession", "service", async (span) => {
      const startTime = performance.now();
      span.attributes["audience"] = audience;
      span.attributes["jwt_token_type"] = jwtTokenType;

      if (!token) {
        span.attributes["success"] = false;
        span.attributes["failure_reason"] = "token_missing";
        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.FAST,
        );
        throwHttpError("AUTH.UNAUTHORIZED");
      }

      const tokenHash = tokenHashString(token);
      span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";

      try {
        const tokenData = await this.tokenHelper.useVerifyTokenJWT(
          token,
          audience,
        );

        if (tokenData.type !== jwtTokenType) {
          span.attributes["success"] = false;
          span.attributes["failure_reason"] = "token_type_mismatch";
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        const cache = await getCache();
        const cachedSession = options.preloadedSession !== undefined
          ? options.preloadedSession
          : await cache.get<ITokensSessionData>(CACHE_NAMESPACES.AUTH.JWT_SESSION, tokenHash);

        span.attributes["cache_session_found"] = !!cachedSession;

        if (cachedSession?.revokedAt) {
          span.attributes["session_revoked_found"] = true;
          span.attributes["session_revoked_at"] = cachedSession.revokedAt;

          if ((getTimeNow() - cachedSession.revokedAt) < REVOCATION_CHALLENGE_WINDOW_MS) {
            span.attributes["success"] = false;
            span.attributes["failure_reason"] = "token_recently_revoked";
            throw new ChallengeEligibleSessionRevocationError(
              cachedSession.revokedAt,
              cachedSession.userId || (tokenData.sub as string | undefined),
              cachedSession,
            );
          }

          span.attributes["success"] = false;
          span.attributes["failure_reason"] = "token_revoked";
          await this.logSessionValidationFailure("token_revoked", tokenHash);
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        if (!cachedSession) {
          span.attributes["success"] = false;
          span.attributes["failure_reason"] = "session_not_found";
          await this.logSessionValidationFailure("session_not_found", tokenHash);
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        span.attributes["success"] = true;
        return cachedSession;
      } catch (error) {
        span.attributes["success"] = false;

        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.FAST,
        );

        if (
          error instanceof AppHttpException ||
          error instanceof ChallengeEligibleSessionRevocationError
        ) {
          throw error;
        }

        await useLogSecurityEvent(
          LoggerLevels.error,
          "JWT session validation error",
          "critical",
          loggerAppSections.SESSION,
          "Session.Validation_Error",
          { error: error instanceof Error ? error.message : "Unknown error" },
        );

        throwHttpError("AUTH.UNAUTHORIZED", error);
      }
    });
  }

  /**
   * Validate refresh token with device fingerprint validation and timing attack protection
   * @param token - Refresh token to validate
   * @param deviceInfo - Device information for fingerprint validation
   * @returns Promise<ITokensRefreshTokenData | null> - Token data if valid, null if invalid
   */
  async validateRefreshToken(
    token: string,
    deviceInfo?: ITokensDeviceTypeOptions,
  ): Promise<ITokensRefreshTokenData | null> {
    return await traced("SessionValidationService.validateRefreshToken", "service", async (span) => {
      const startTime = performance.now();
      span.attributes["has_device_info"] = !!deviceInfo;

      try {
        if (!token) {
          span.attributes["token_missing"] = true;
          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.FAST,
          );
          return null;
        }

        const cache = await getCache();
        const tokenHash = tokenHashString(token);
        span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";

        let [revokedAt, cachedRefreshToken] = await Promise.all([
          cache.get<number>(CACHE_NAMESPACES.AUTH.TOKEN_REVOKED, tokenHash),
          cache.get<ITokensRefreshTokenData>(
            CACHE_NAMESPACES.AUTH.REFRESH_TOKENS,
            tokenHash,
          ),
        ]);

        if (revokedAt) {
          span.attributes["revoked"] = true;
          span.attributes["revoked_at"] = revokedAt;

          await this.logSessionValidationFailure(
            "refresh_token_revoked",
            tokenHash,
          );

          await useLogSecurityEvent(
            LoggerLevels.warn,
            "Refresh token validation failed - token was revoked",
            "high",
            loggerAppSections.AUTH,
            "Auth.Refresh_Token_Revoked",
            {
              tokenHashPrefix: tokenHash.substring(0, 8) + "...",
              revokedAt,
              timestamp: getTimeNow(),
            },
          );

          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.FAST,
          );
          return null;
        }

        if (!cachedRefreshToken) {
          try {
            const dbToken = await this.refreshTokenRepository.findByTokenHash(tokenHash);
            if (dbToken) {
              span.attributes["db_fallback_hit"] = true;
              cachedRefreshToken = dbToken;

              const remainingTtlMs = dbToken.expiresAt - getTimeNow();
              if (remainingTtlMs > 0) {
                const cache = await getCache();
                await cache.set(
                  CACHE_NAMESPACES.AUTH.REFRESH_TOKENS,
                  tokenHash,
                  dbToken,
                  { ttl: Math.floor(remainingTtlMs / 1000) },
                );
              }
            }
          } catch {
            span.attributes["db_fallback_error"] = true;
          }

          if (!cachedRefreshToken) {
            span.attributes["token_not_found"] = true;
            await this.logSessionValidationFailure(
              "refresh_token_not_found",
              tokenHash,
            );
            await ensureMinimumProcessingTime(
              startTime,
              TIMING_PROFILES.FAST,
            );
            return null;
          }
        }

        if (deviceInfo && cachedRefreshToken.fingerprint) {
          const currentFingerprint = JWTAuthTokenCreateFingerprint(
            deviceInfo.userAgent,
            deviceInfo.accept,
            deviceInfo.lang,
          );

          const fingerprintValid = safeEqual(
            currentFingerprint,
            cachedRefreshToken.fingerprint,
          );

          if (!fingerprintValid) {
            span.attributes["fingerprint_mismatch"] = true;
            await this.logSessionValidationFailure(
              "refresh_token_fingerprint_mismatch",
              tokenHash,
            );
            await ensureMinimumProcessingTime(
              startTime,
              TIMING_PROFILES.FAST,
            );
            return null;
          }
        }

        const tokenAge = getTimeNow() - cachedRefreshToken.createdAt;
        const isExpired = tokenAge >= (JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration * 1000);

        if (isExpired) {
          span.attributes["expired"] = true;
          await cache.delete(CACHE_NAMESPACES.AUTH.REFRESH_TOKENS, tokenHash);
          await this.logSessionValidationFailure(
            "refresh_token_expired",
            tokenHash,
          );
          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.FAST,
          );
          return null;
        }

        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.FAST,
        );

        span.attributes["success"] = true;
        span.attributes["user_id"] = cachedRefreshToken.userId;
        return cachedRefreshToken;
      } catch (error) {
        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.FAST,
        );

        // Log the error for debugging
        await useLogSecurityEvent(
          LoggerLevels.error,
          "Refresh token validation error",
          "critical",
          loggerAppSections.SESSION,
          "Session.Refresh_Token_Validation_Error",
          { error: error instanceof Error ? error.message : "Unknown error" },
        );

        return null;
      }
    });
  }

  /**
   * Validate JWT session (15-minute tokens) with timing attack protection and return payload
   * @param token - JWT token to validate
   * @param audience - Expected audience value
   * @param jwtTokenType - Expected JWT token type
   * @returns Promise<{sessionData: ITokensSessionData, payload: IJWTPayload}> - Session data and payload if valid
   * @throws HTTP 401 exception if session is invalid
   */
  async validateJWTSessionWithPayload(
    token: string,
    audience: string = JWT_TOKEN_CONFIG.audiences.auth,
    jwtTokenType: JWT_TOKEN_TYPES = JWT_TOKEN_TYPES.AUTH,
    options: ValidateJWTSessionOptions = {},
  ): Promise<{ sessionData: ITokensSessionData; payload: ITokensPayloadJWT }> {
    return await traced("SessionValidationService.validateJWTSessionWithPayload", "service", async (span) => {
      const startTime = performance.now();
      span.attributes["audience"] = audience;
      span.attributes["jwt_token_type"] = jwtTokenType;

      if (!token) {
        span.attributes["success"] = false;
        span.attributes["failure_reason"] = "token_missing";
        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.FAST,
        );
        throwHttpError("AUTH.UNAUTHORIZED");
      }

      const tokenHash = tokenHashString(token);
      span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";

      try {
        const payload = await this.tokenHelper.useVerifyTokenJWT(
          token,
          audience,
        );

        if (payload.type !== jwtTokenType) {
          span.attributes["success"] = false;
          span.attributes["failure_reason"] = "token_type_mismatch";
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        const cache = await getCache();
        const cachedSession = options.preloadedSession !== undefined ? options.preloadedSession : await cache.get<ITokensSessionData>(
          CACHE_NAMESPACES.AUTH.JWT_SESSION,
          tokenHash,
        );

        span.attributes["cache_session_found"] = !!cachedSession;

        if (cachedSession?.revokedAt) {
          span.attributes["session_revoked_found"] = true;
          span.attributes["session_revoked_at"] = cachedSession.revokedAt;

          if ((getTimeNow() - cachedSession.revokedAt) < REVOCATION_CHALLENGE_WINDOW_MS) {
            span.attributes["success"] = false;
            span.attributes["failure_reason"] = "token_recently_revoked";
            throw new ChallengeEligibleSessionRevocationError(
              cachedSession.revokedAt,
              cachedSession.userId || (payload.sub as string | undefined),
              cachedSession,
            );
          }

          span.attributes["success"] = false;
          span.attributes["failure_reason"] = "token_revoked";
          await this.logSessionValidationFailure("token_revoked", tokenHash);
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        if (!cachedSession) {
          span.attributes["success"] = false;
          span.attributes["failure_reason"] = "session_not_found";
          await this.logSessionValidationFailure("session_not_found", tokenHash);
          throwHttpError("AUTH.UNAUTHORIZED");
        }

        span.attributes["success"] = true;
        span.attributes["token_type"] = (payload.type as unknown) as string;
        span.attributes["subject"] = payload.sub as string;

        return {
          sessionData: cachedSession,
          payload: payload as ITokensPayloadJWT,
        };
      } catch (error) {
        span.attributes["success"] = false;

        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.FAST,
        );

        if (
          error instanceof AppHttpException ||
          error instanceof ChallengeEligibleSessionRevocationError
        ) {
          throw error;
        }

        await useLogSecurityEvent(
          LoggerLevels.error,
          "JWT session validation error",
          "critical",
          loggerAppSections.SESSION,
          "Session.Validation_Error",
          { error: error instanceof Error ? error.message : "Unknown error" },
        );

        throwHttpError("AUTH.UNAUTHORIZED", error);
      }
    });
  }
}
