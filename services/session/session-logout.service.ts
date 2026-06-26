/**
 * @file services/session/session-logout.service.ts
 * @description Service responsible for handling user logout operations
 */
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { getSessionRevocationService } from "./singletons.ts";
import { ITokensCurrentSessions, ITokensRefreshTokenData, ITokensSessionData } from "@services/token/config.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { tokenHashString } from "@services/token/index.ts";
import { traced } from "@services/tracing/index.ts";
import type { Span } from "@interfaces/tracing.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";

function shouldRemoveUserSession(
  session: ITokensCurrentSessions,
  match: { sessionId?: string; accessTokenHash: string; refreshTokenHash: string },
): boolean {
  if (match.sessionId && session.sessionId === match.sessionId) {
    return true;
  }

  const accessTokenHash = session.accessTokenHash ?? session.tokenHash;
  return accessTokenHash === match.accessTokenHash || session.refreshTokenHash === match.refreshTokenHash;
}

/**
 * Service responsible for handling user logout operations
 */
export class SessionLogoutService {
  /**
   * Logs out the current session by invalidating the access token and refresh token
   * @param accessToken - The access token from the cookie
   * @param refreshToken - The refresh token from the signed cookie
   * @returns Promise<boolean> - True if logout was successful, false otherwise
   */
  async logoutCurrentSession(
    accessToken: string,
    refreshToken: string,
  ): Promise<boolean> {
    return await traced(
      "SessionLogout.logoutCurrentSession",
      "service",
      async (span: Span) => {
        span.attributes["has_access_token"] = !!accessToken;
        span.attributes["has_refresh_token"] = !!refreshToken;

        try {
          const cache = await getCache();
          const accessTokenHash = tokenHashString(accessToken);
          const refreshTokenHash = tokenHashString(refreshToken);
          const [sessionData, refreshTokenData] = await Promise.all([
            cache.get<ITokensSessionData>(
              CACHE_NAMESPACES.AUTH.JWT_SESSION,
              accessTokenHash,
            ),
            cache.get<ITokensRefreshTokenData>(
              CACHE_NAMESPACES.AUTH.REFRESH_TOKENS,
              refreshTokenHash,
            ),
          ]);
          const userId = sessionData?.userId || refreshTokenData?.userId;
          const sessionId = sessionData?.sessionId || refreshTokenData?.sessionId;

          span.attributes["resolved_user_id"] = userId ?? "unknown";
          span.attributes["resolved_session_id"] = sessionId ?? "unknown";

          const revocationService = getSessionRevocationService();
          await Promise.all([
            revocationService.revokeJWTSession(accessToken),
            revocationService.revokeRefreshToken(refreshToken),
            this.removeSessionFromUserSessions({
              userId,
              sessionId,
              accessTokenHash,
              refreshTokenHash,
            }),
          ]);

          span.attributes["success"] = true;
          return true;
        } catch (error) {
          span.attributes["success"] = false;
          span.error = {
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : "Unknown error",
          };

          await useLogger(LoggerLevels.error, {
            message: "SESSION => Failed to logout user session",
            section: loggerAppSections.AUTH,
            messageKey: "logout_failure",
            details: {
              accessTokenHash: accessToken ? tokenHashString(accessToken).substring(0, 10) + "..." : "missing",
              refreshTokenHash: refreshToken ? tokenHashString(refreshToken).substring(0, 10) + "..." : "missing",
            },
            raw: error,
          });

          // Even if revocation fails, we still want to clear the cookies
          // So we return true to indicate the logout process should continue
          return true;
        }
      },
    );
  }

  /**
   * Removes the session from the user's active sessions list in cache
   * @param accessToken - The access token to remove
   * @param refreshToken - The refresh token to remove
   * @private
   */
  private async removeSessionFromUserSessions(
    sessionContext: {
      userId?: string;
      sessionId?: string;
      accessTokenHash: string;
      refreshTokenHash: string;
    },
  ): Promise<void> {
    return await traced(
      "SessionLogout.removeSessionFromUserSessions",
      "cache.delete",
      async (span: Span) => {
        try {
          if (!sessionContext.userId) {
            span.attributes["session_found"] = false;
            span.attributes["reason"] = "missing_user_id";
            return;
          }

          const cache = await getCache();
          const userId = sessionContext.userId;
          span.attributes["access_token_hash_prefix"] = sessionContext.accessTokenHash.substring(0, 10) + "...";
          span.attributes["refresh_token_hash_prefix"] = sessionContext.refreshTokenHash.substring(0, 10) + "...";
          span.attributes["session_found"] = true;
          span.attributes["user_id"] = userId;
          span.attributes["session_id"] = sessionContext.sessionId ?? "unknown";

          await cache.withLock(`user_sessions_lock:${userId}`, async () => {
            // Get the user's active sessions
            const userSessions = await cache.get<ITokensCurrentSessions[]>(
              CACHE_NAMESPACES.AUTH.USER_SESSIONS,
              userId,
            );

            if (!userSessions || userSessions.length === 0) {
              // No sessions found for this user
              span.attributes["sessions_count"] = 0;
              return;
            }

            span.attributes["sessions_count"] = userSessions.length;

            // Filter out the current session
            const updatedSessions = userSessions.filter(
              (session) => !shouldRemoveUserSession(session, sessionContext),
            );

            span.attributes["remaining_sessions"] = updatedSessions.length;

            // Update the cache with the filtered sessions
            await cache.set(
              CACHE_NAMESPACES.AUTH.USER_SESSIONS,
              userId,
              updatedSessions,
              { ttl: JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration },
            );
          });

          span.attributes["success"] = true;
        } catch (error) {
          span.attributes["success"] = false;
          span.error = {
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : "Unknown error",
          };

          // Log the error but don't fail the logout
          await useLogger(LoggerLevels.error, {
            message: "SESSION => Failed to remove session from user sessions list",
            section: loggerAppSections.AUTH,
            messageKey: "remove_session_failure",
            raw: error,
          });
        }
      },
    );
  }
}
