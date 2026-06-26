/**
 * @file services/session/session-revocation.service.ts
 * @description Service responsible for revoking sessions and tokens
 */
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { tokenHashString } from "@services/token/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { ITokensCurrentSessions } from "@services/token/config.ts";
import { and, eq } from "@deps";
import { throwHttpError } from "@utils/http-exception.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import type { Span } from "@interfaces/tracing.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { RefreshTokenRepository } from "./refresh-token.repository.ts";

/**
 * Maximum number of sessions to process in a single batch when revoking all sessions.
 * This prevents memory pressure from users with an unusually high number of sessions.
 */
const MAX_SESSIONS_PER_BATCH = 100;

function getSessionAccessTokenHash(session: ITokensCurrentSessions): string | undefined {
  return session.accessTokenHash ?? session.tokenHash;
}

function isCurrentSessionEntry(
  session: ITokensCurrentSessions,
  currentSessionId: string | undefined,
  currentTokenHash: string,
): boolean {
  if (currentSessionId && session.sessionId === currentSessionId) {
    return true;
  }

  return getSessionAccessTokenHash(session) === currentTokenHash;
}

async function revokeCachedSessionEntries(
  cache: Awaited<ReturnType<typeof getCache>>,
  session: ITokensCurrentSessions,
  now: number,
): Promise<void> {
  const accessTokenHash = getSessionAccessTokenHash(session);
  const refreshTokenHash = session.refreshTokenHash;

  if (accessTokenHash) {
    try {
      await cache.delete(CACHE_NAMESPACES.AUTH.JWT_SESSION, accessTokenHash);
    } catch {
      await cache.set(
        CACHE_NAMESPACES.AUTH.TOKEN_REVOKED,
        accessTokenHash,
        now,
        { ttl: JWT_TOKEN_CONFIG.tokenTTL.authExpiration },
      );
    }
  }

  if (refreshTokenHash) {
    try {
      await cache.delete(CACHE_NAMESPACES.AUTH.REFRESH_TOKENS, refreshTokenHash);
    } catch {
      await cache.set(
        CACHE_NAMESPACES.AUTH.TOKEN_REVOKED,
        refreshTokenHash,
        now,
        { ttl: JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration },
      );
    }
  }
}

/**
 * Service responsible for revoking sessions and tokens
 */
export class SessionRevocationService {
  /**
   * Revoke JWT session
   * @param token - The JWT token to revoke
   */
  async revokeJWTSession(token: string): Promise<void> {
    return await traced(
      "SessionRevocation.revokeJWTSession",
      "cache.delete",
      async (span: Span) => {
        const tokenHash = tokenHashString(token);
        span.attributes["token_hash_prefix"] = tokenHash.substring(0, 10) + "...";

        try {
          const cache = await getCache();
          await cache.delete(CACHE_NAMESPACES.AUTH.JWT_SESSION, tokenHash);
          span.attributes["success"] = true;
        } catch (error) {
          span.attributes["success"] = false;
          span.error = {
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : "Unknown error",
          };

          await useLogger(LoggerLevels.critical, {
            message: "SESSION => Failed to revoke JWT session from cache",
            section: loggerAppSections.AUTH,
            messageKey: "revocation_failure",
            raw: error,
          });

          // Fallback: add to revoked tokens list
          const cache = await getCache();
          await cache.set(
            CACHE_NAMESPACES.AUTH.TOKEN_REVOKED,
            tokenHash,
            getTimeNow(),
            { ttl: JWT_TOKEN_CONFIG.tokenTTL.authExpiration },
          );
        }
      },
    );
  }

  /**
   * Revoke refresh token
   * @param token - The refresh token to revoke
   */
  async revokeRefreshToken(token: string): Promise<void> {
    return await traced(
      "SessionRevocation.revokeRefreshToken",
      "cache.delete",
      async (span: Span) => {
        const hashedRefresh = tokenHashString(token);
        span.attributes["token_hash_prefix"] = hashedRefresh.substring(0, 10) + "...";

        try {
          const cache = await getCache();
          await cache.delete(CACHE_NAMESPACES.AUTH.REFRESH_TOKENS, hashedRefresh);

          try {
            const repo = new RefreshTokenRepository();
            await repo.deleteByTokenHash(hashedRefresh);
          } catch {
            // Non-critical — cleanup job will handle expired tokens
          }

          span.attributes["success"] = true;
        } catch (error) {
          span.attributes["success"] = false;
          span.error = {
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : "Unknown error",
          };

          await useLogger(LoggerLevels.critical, {
            message: "SESSION => Failed to revoke refresh token from cache",
            section: loggerAppSections.AUTH,
            messageKey: "revocation_failure",
            raw: error,
          });

          // Fallback: add to revoked tokens list
          const cache = await getCache();
          await cache.set(
            CACHE_NAMESPACES.AUTH.TOKEN_REVOKED,
            hashedRefresh,
            getTimeNow(),
            { ttl: JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration },
          );
        }
      },
    );
  }

  /**
   * When revoking all user sessions - covers BOTH token types
   * Processes sessions in batches to prevent memory pressure for users with many sessions.
   * @param userId - The user ID to revoke all sessions for
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    return await traced(
      "SessionRevocation.revokeAllUserSessions",
      "cache.delete",
      async (span: Span) => {
        span.attributes["user_id"] = userId;

        try {
          const cache = await getCache();
          let userSessionsList: ITokensCurrentSessions[] = [];

          await cache.withLock(`user_sessions_lock:${userId}`, async () => {
            const sessions = await cache.get<ITokensCurrentSessions[]>(
              CACHE_NAMESPACES.AUTH.USER_SESSIONS,
              userId,
            );
            userSessionsList = sessions ?? [];

            // Clear the user sessions cache atomically with the read
            await cache.delete(CACHE_NAMESPACES.AUTH.USER_SESSIONS, userId);
          });

          span.attributes["sessions_found"] = userSessionsList.length > 0;
          span.attributes["sessions_count"] = userSessionsList.length;

          if (userSessionsList.length > 0) {
            const totalSessions = userSessionsList.length;
            const now = getTimeNow();

            // Log warning if exceeding batch limit
            if (totalSessions > MAX_SESSIONS_PER_BATCH) {
              await useLogger(LoggerLevels.warn, {
                message: "User has unusually high number of sessions, processing in batches",
                section: loggerAppSections.AUTH,
                messageKey: "revoke_all_sessions_high_count",
                details: {
                  userId,
                  sessionCount: totalSessions,
                  maxPerBatch: MAX_SESSIONS_PER_BATCH,
                },
              });
            }

            // Process in batches
            for (let i = 0; i < totalSessions; i += MAX_SESSIONS_PER_BATCH) {
              const batch = userSessionsList.slice(i, i + MAX_SESSIONS_PER_BATCH);
              await Promise.all(
                batch.map((session) => revokeCachedSessionEntries(cache, session, now)),
              );
            }
          }

          try {
            const repo = new RefreshTokenRepository();
            await repo.deleteByUserId(userId);
          } catch {
            // Non-critical — cleanup job will handle expired tokens
          }

          span.attributes["success"] = true;
        } catch (error) {
          span.attributes["success"] = false;
          span.error = {
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : "Unknown error",
          };

          await useLogger(LoggerLevels.error, {
            message: "SESSION => Cache operation error during revoke all sessions",
            section: loggerAppSections.AUTH,
            messageKey: "revoke_all_sessions_failure",
            details: { userId },
            raw: error,
          });
        }
      },
    );
  }

  /**
   * Revoke an API key by setting it to inactive and clearing cache
   * @param apiKeyId - The ID of the API key to revoke
   * @param userId - The user ID who owns the API key (for security validation)
   */
  async revokeApiKey(apiKeyId: string, userId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "SessionRevocation.revokeApiKey",
      {
        service: "SessionRevocationService",
        method: "revokeApiKey",
        section: loggerAppSections.AUTH,
        details: { apiKeyId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        span.attributes["api_key_id"] = apiKeyId;
        span.attributes["user_id"] = userId;

        const db = await getTenantDB();

        // First verify the API key exists and belongs to the user
        const apiKeyRecord = await traced(
          "SessionRevocation.fetchApiKeyForRevoke",
          "db.query",
          () => {
            return db
              .select({
                id: tenantTables.apiKeys.id,
                keyHash: tenantTables.apiKeys.keyHash,
                userId: tenantTables.apiKeys.userId,
                isActive: tenantTables.apiKeys.isActive,
              })
              .from(tenantTables.apiKeys)
              .where(
                and(
                  eq(tenantTables.apiKeys.id, apiKeyId),
                  eq(tenantTables.apiKeys.userId, userId),
                ),
              )
              .limit(1);
          },
        );

        if (!apiKeyRecord || apiKeyRecord.length === 0) {
          span.attributes["validation_failed"] = "key_not_found";
          throwHttpError("API_KEY.NOT_FOUND");
        }

        const keyRecord = apiKeyRecord[0];

        if (!keyRecord.isActive) {
          span.attributes["validation_failed"] = "key_already_revoked";
          throwHttpError("API_KEY.INACTIVE");
        }

        // Deactivate the API key in database
        await traced(
          "SessionRevocation.deactivateApiKey",
          "db.query",
          () => {
            return db
              .update(tenantTables.apiKeys)
              .set({
                isActive: false,
              })
              .where(eq(tenantTables.apiKeys.id, apiKeyId));
          },
        );

        // Clear the API key from cache
        const cache = await getCache();
        await cache.delete(CACHE_NAMESPACES.AUTH.API_KEY, keyRecord.keyHash);

        span.attributes["success"] = true;

        await useLogger(LoggerLevels.info, {
          message: "SESSION => API key revoked successfully",
          section: loggerAppSections.AUTH,
          messageKey: "api_key_revoked",
          details: {
            apiKeyId,
            userId,
            keyHash: keyRecord.keyHash.substring(0, 10) + "...",
          },
        });
      },
    );
  }

  /**
   * Invalidates all sessions for a user EXCEPT the current one.
   * Used after master key rotation to ensure all other sessions are invalidated.
   *
   * @param userId - The user ID
   * @param currentAccessToken - The access token to keep active
   */
  async invalidateAllSessionsExcept(
    userId: string,
    currentAccessToken: string,
  ): Promise<void> {
    return await traced(
      "SessionRevocation.invalidateAllSessionsExcept",
      "cache.delete",
      async (span: Span) => {
        span.attributes["user_id"] = userId;
        span.attributes["current_token_prefix"] = currentAccessToken.substring(0, 10) + "...";

        try {
          const cache = await getCache();
          const currentTokenHash = tokenHashString(currentAccessToken);
          const currentSessionData = await cache.get(
            CACHE_NAMESPACES.AUTH.JWT_SESSION,
            currentTokenHash,
          ) as { sessionId?: string } | null;
          const currentSessionId = currentSessionData?.sessionId;

          // Get all sessions for the user (atomic RMW)
          let userSessionsList: ITokensCurrentSessions[] = [];
          await cache.withLock(`user_sessions_lock:${userId}`, async () => {
            const sessions = await cache.get<ITokensCurrentSessions[]>(
              CACHE_NAMESPACES.AUTH.USER_SESSIONS,
              userId,
            );
            userSessionsList = sessions ?? [];

            if (userSessionsList.length > 0) {
              const remainingSessions = userSessionsList.filter(
                (session) => isCurrentSessionEntry(session, currentSessionId, currentTokenHash),
              );

              if (remainingSessions.length > 0) {
                await cache.set(
                  CACHE_NAMESPACES.AUTH.USER_SESSIONS,
                  userId,
                  remainingSessions,
                  { ttl: JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration },
                );
              } else {
                await cache.delete(CACHE_NAMESPACES.AUTH.USER_SESSIONS, userId);
              }
            }
          });

          span.attributes["sessions_found"] = userSessionsList.length > 0;
          span.attributes["sessions_count"] = userSessionsList.length;

          if (userSessionsList.length > 0) {
            const sessionsToInvalidate = userSessionsList.filter(
              (session) => !isCurrentSessionEntry(session, currentSessionId, currentTokenHash),
            );

            span.attributes["sessions_to_invalidate"] = sessionsToInvalidate.length;
            const now = getTimeNow();

            // Process in batches to prevent memory pressure
            for (let i = 0; i < sessionsToInvalidate.length; i += MAX_SESSIONS_PER_BATCH) {
              const batch = sessionsToInvalidate.slice(i, i + MAX_SESSIONS_PER_BATCH);
              await Promise.all(
                batch.map((session) => revokeCachedSessionEntries(cache, session, now)),
              );
            }

            try {
              const repo = new RefreshTokenRepository();
              await Promise.all(
                sessionsToInvalidate
                  .filter((s) => s.refreshTokenHash)
                  .map((s) => repo.deleteByTokenHash(s.refreshTokenHash!)),
              );
            } catch {
              // Non-critical — cleanup job will handle expired tokens
            }

            if (!currentSessionId && currentTokenHash) {
              span.attributes["current_session_matching_strategy"] = "access_token_hash";
            } else {
              span.attributes["current_session_matching_strategy"] = "session_id";
            }
          } else {
            span.attributes["current_session_matching_strategy"] = currentSessionId ? "session_id" : "access_token_hash";
          }

          if (currentSessionId) {
            span.attributes["current_session_id"] = currentSessionId;
          } else {
            span.attributes["current_session_id"] = "unknown";
          }

          span.attributes["success"] = true;
        } catch (error) {
          span.attributes["success"] = false;
          span.error = {
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : "Unknown error",
          };

          await useLogger(LoggerLevels.error, {
            message: "SESSION => Error invalidating sessions except current",
            section: loggerAppSections.AUTH,
            messageKey: "invalidate_sessions_except_failed",
            details: { userId },
            raw: error,
          });
        }
      },
    );
  }
}
