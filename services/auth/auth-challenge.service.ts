/**
 * @file services/auth/auth-challenge.service.ts
 * @description Auth Challenge service (auth)
 */
/**
 * Auth Challenge Service
 *
 * Handles IP-based authentication challenges including:
 * - Detecting revoked tokens with active challenge windows
 * - Revoking tokens and creating challenge verify tokens
 * - Determining challenge type (passkey, 2FA, password)
 */

import type { HonoContext } from "@deps";
import { eq } from "@deps";
import { ITokensSessionData } from "@services/token/config.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { loggerAppSections, LoggerLevels, useLogSecurityEvent } from "@logger/index.ts";
import { getGlobalDB, globalTables } from "@db/db.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { getTokenHelperService, tokenHashString } from "@services/token/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { useSetCookie } from "@utils/cookie.ts";
import { traced } from "@services/tracing/index.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";
import { REVOCATION_CHALLENGE_WINDOW_MS } from "@services/session/session.constants.ts";

/**
 * Create a verify token and set it as a cookie, clear refresh token, store in cache.
 * Shared by both the revoked-token handler and the challenge trigger.
 */
async function issueVerifyTokenAndClearRefresh(
  c: HonoContext,
  userId: string,
  clearRefreshCookie: (c: HonoContext) => void,
  spanName: string,
): Promise<string> {
  const verifyToken = await traced(spanName, "auth", async (span) => {
    span.attributes["user_id"] = userId;
    span.attributes["token_type"] = JWT_TOKEN_TYPES.VERIFY;

    const token = await getTokenHelperService().signTokenJWT(
      JWT_TOKEN_CONFIG.tokenTTL.verify,
      userId,
      JWT_TOKEN_TYPES.VERIFY,
      JWT_TOKEN_CONFIG.audiences.verify,
    );

    span.attributes["token_created"] = true;
    return token;
  });

  useSetCookie(c, AUTH_HEADER_NAMING.access, verifyToken, JWT_TOKEN_CONFIG.tokenTTL.verify);
  clearRefreshCookie(c);

  await (await getCache()).set(
    CACHE_NAMESPACES.AUTH.CHALLENGE_TOKEN,
    tokenHashString(verifyToken),
    getTimeNow(),
    { ttl: JWT_TOKEN_CONFIG.tokenTTL.verify },
  );

  return verifyToken;
}

/**
 * Handle the case where a JWT was revoked but a challenge is still in progress.
 * Returns true if a 428 was thrown (caller should not continue).
 */
export async function handleRevokedTokenChallenge(
  c: HonoContext,
  jwtToken: string,
  jwtValidationUserId: string | undefined,
  clearRefreshCookie: (c: HonoContext) => void,
  cachedSession?: ITokensSessionData | null,
  revokedAt?: number | null,
): Promise<number | null> {
  const cache = await getCache();
  let resolvedSession = cachedSession;
  let resolvedRevokedAt = revokedAt ?? cachedSession?.revokedAt ?? null;

  if (resolvedSession === undefined || resolvedRevokedAt === null) {
    const tokenHash = tokenHashString(jwtToken);
    resolvedSession ??= await cache.get<ITokensSessionData>(
      CACHE_NAMESPACES.AUTH.JWT_SESSION,
      tokenHash,
    );
    resolvedRevokedAt ??= resolvedSession?.revokedAt ?? null;
  }

  if (!resolvedRevokedAt) return null;

  const timeSinceRevocation = getTimeNow() - resolvedRevokedAt;

  if (timeSinceRevocation >= REVOCATION_CHALLENGE_WINDOW_MS) return resolvedRevokedAt;

  const userId = resolvedSession?.userId || jwtValidationUserId;

  if (userId) {
    await issueVerifyTokenAndClearRefresh(
      c,
      userId,
      clearRefreshCookie,
      "AuthMiddleware.createChallengeTokenForRevokedSession",
    );
  }

  throwHttpError("AUTH.PASSWORD_CHALLENGE");

  return resolvedRevokedAt; // unreachable, but satisfies return type
}

/**
 * Determine the user's auth security type (passkey, 2FA, or password-only).
 */
async function getUserAuthSecurityType(userId: string) {
  return await traced("AuthMiddleware.getUserAuthType", "db.query", async (span) => {
    span.attributes["user_id"] = userId;

    const [userRow] = await getGlobalDB()
      .select({ isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, userId))
      .limit(1);

    const [passkeyRow] = await getGlobalDB()
      .select({ id: globalTables.userPasskeys.id })
      .from(globalTables.userPasskeys)
      .where(eq(globalTables.userPasskeys.userId, userId))
      .limit(1);

    const hasPasskey = !!passkeyRow;
    span.attributes["has_2fa"] = userRow?.isTwoFactorEnabled ?? false;
    span.attributes["has_passkey"] = hasPasskey;

    return userRow ? { isTwoFactorEnabled: userRow.isTwoFactorEnabled, hasPasskey } : null;
  });
}

/**
 * Revoke access and refresh tokens, logging the revocation.
 */
async function revokeTokens(
  userId: string,
  jwtToken: string,
  refreshToken: string,
  reason: string,
) {
  await traced("AuthMiddleware.revokeTokens", "cache.set", async (span) => {
    span.attributes["user_id"] = userId;

    const cache = await getCache();
    const accessTokenHash = tokenHashString(jwtToken);
    const refreshTokenHash = tokenHashString(refreshToken);
    const now = getTimeNow();

    span.attributes["access_token_hash"] = accessTokenHash.substring(0, 8) + "...";
    span.attributes["refresh_token_hash"] = refreshTokenHash.substring(0, 8) + "...";

    const cachedSession = await cache.get<ITokensSessionData>(
      CACHE_NAMESPACES.AUTH.JWT_SESSION,
      accessTokenHash,
    );

    if (cachedSession) {
      await cache.set(
        CACHE_NAMESPACES.AUTH.JWT_SESSION,
        accessTokenHash,
        {
          ...cachedSession,
          revokedAt: now,
        },
        { ttl: JWT_TOKEN_CONFIG.tokenTTL.authExpiration },
      );
      span.attributes["access_revocation_strategy"] = "session_state";
    } else {
      span.attributes["access_revocation_strategy"] = "session_missing";
    }

    await cache.set(
      CACHE_NAMESPACES.AUTH.TOKEN_REVOKED,
      refreshTokenHash,
      now,
      { ttl: JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration },
    );

    span.attributes["tokens_revoked"] = 2;

    const [accessRevokedSession, refreshRevoked] = await Promise.all([
      cache.get<ITokensSessionData>(CACHE_NAMESPACES.AUTH.JWT_SESSION, accessTokenHash),
      cache.get<number>(CACHE_NAMESPACES.AUTH.TOKEN_REVOKED, refreshTokenHash),
    ]);
    const accessRevoked = !!accessRevokedSession?.revokedAt;

    span.attributes["access_token_revoked_confirmed"] = !!accessRevoked;
    span.attributes["refresh_token_revoked_confirmed"] = !!refreshRevoked;

    await useLogSecurityEvent(
      LoggerLevels.warn,
      "Tokens revoked due to IP challenge",
      "high",
      loggerAppSections.AUTH,
      "Auth.Tokens_Revoked_For_Challenge",
      {
        userId,
        accessTokenHash: accessTokenHash.substring(0, 8) + "...",
        refreshTokenHash: refreshTokenHash.substring(0, 8) + "...",
        accessRevoked: !!accessRevoked,
        refreshRevoked: !!refreshRevoked,
        reason,
      },
    );
  });
}

/**
 * Execute the full challenge flow: revoke tokens, create verify token,
 * determine challenge type, and throw 428.
 *
 * This function always throws (428) and never returns normally.
 */
export async function executeChallengeFlow(
  c: HonoContext,
  userId: string,
  jwtToken: string,
  refreshToken: string,
  ipChangeDetected: boolean,
  clearRefreshCookie: (c: HonoContext) => void,
): Promise<never> {
  const userAuthSecurityType = await getUserAuthSecurityType(userId);

  await revokeTokens(
    userId,
    jwtToken,
    refreshToken,
    ipChangeDetected ? "IP address change" : "Suspicious IP detected",
  );

  await issueVerifyTokenAndClearRefresh(
    c,
    userId,
    clearRefreshCookie,
    "AuthMiddleware.createChallengeToken",
  );

  if (userAuthSecurityType?.hasPasskey) {
    throwHttpError("AUTH.PASSKEY_CHALLENGE");
  }

  if (userAuthSecurityType?.isTwoFactorEnabled) {
    throwHttpError("AUTH.TWO_FACTOR_CHALLENGE");
  }

  throwHttpError("AUTH.PASSWORD_CHALLENGE");

  // throwHttpError is typed `never`, so this is unreachable; kept to satisfy the linter.
  throw new Error("Unreachable");
}
