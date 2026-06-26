/**
 * @file utils/cookie.ts
 * @description Auth-cookie helpers (set/get/clear) plus the ephemeral session-key
 *   cookie logic.
 *
 * Not split: although session-key handling is conceptually narrower than the
 * generic get/set cookie helpers, every helper here is auth-shaped (all hardcode
 * httpOnly/secure/sameSite:Lax and the `AUTH_HEADER_NAMING` cookie namespace), and
 * the two halves are co-imported by the same handler files (login, two-factor,
 * challenge, refresh, logout, passkey). Splitting would force two imports in six
 * files for no locality gain. Treated as one cohesive auth-cookie module.
 */
import { getCookie, getSignedCookie, HonoContext, randomBytes, setCookie, setSignedCookie } from "@deps";
import { envConfig } from "@config/env.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";

type AuthHeaderName = typeof AUTH_HEADER_NAMING[keyof typeof AUTH_HEADER_NAMING];

export const useSetCookie = (
  c: HonoContext,
  cookieName: AuthHeaderName,
  value: string,
  maxAge: number,
) => {
  return setCookie(c, cookieName, value, {
    path: "/",
    secure: envConfig.isProduction,
    domain: envConfig.isProduction ? `.${envConfig.baseDomain}` : undefined,
    httpOnly: true,
    maxAge: maxAge,
    sameSite: "Lax",
  });
};

export const useSetSignedCookie = async (
  c: HonoContext,
  cookieName: string,
  value: string,
  maxAge: number,
) => {
  return await setSignedCookie(
    c,
    cookieName,
    value,
    envConfig.auth.refreshKey!,
    {
      path: "/",
      secure: envConfig.isProduction,
      domain: envConfig.isProduction ? `.${envConfig.baseDomain}` : undefined,
      httpOnly: true,
      maxAge: maxAge,
      sameSite: "Lax",
    },
  );
};

export const useGetCookie = (c: HonoContext, cookieName: string) => {
  return getCookie(c, cookieName);
};

export const useGetSignedCookie = async (c: HonoContext, cookieName: string) => {
  return await getSignedCookie(c, envConfig.auth.refreshKey!, cookieName);
};

/**
 * Generates a new cryptographically random ephemeral session key.
 * This key is returned to the client as a cookie and used to encrypt
 * the derived password key in cache. Since the server never stores
 * this key, a cache dump alone cannot decrypt user data.
 *
 * @returns base64-encoded 32-byte random value
 */
export const generateEphemeralSessionKey = (): string => {
  const keyBytes = randomBytes(32);
  // Use base64url encoding (RFC 4648) — no +, /, or = characters that would get URL-encoded in cookies
  return btoa(String.fromCharCode(...keyBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

/**
 * Sets the ephemeral session key cookie.
 * - httpOnly: true — prevents JS access (auto-sent by browser on every request)
 * - secure: enforced in production
 * - sameSite: Lax — consistent with other auth cookies
 */
export const useSetSessionKeyCookie = (
  c: HonoContext,
  sessionKey: string,
  maxAge: number,
) => {
  return setCookie(c, AUTH_HEADER_NAMING.sessionKey, sessionKey, {
    path: "/",
    secure: envConfig.isProduction,
    domain: envConfig.isProduction ? `.${envConfig.baseDomain}` : undefined,
    httpOnly: true,
    maxAge: maxAge,
    sameSite: "Lax",
  });
};

/**
 * Clears the session key cookie (on logout or session invalidation)
 */
export const useClearSessionKeyCookie = (c: HonoContext) => {
  return setCookie(c, AUTH_HEADER_NAMING.sessionKey, "", {
    path: "/",
    secure: envConfig.isProduction,
    domain: envConfig.isProduction ? `.${envConfig.baseDomain}` : undefined,
    httpOnly: true,
    maxAge: 0,
    sameSite: "Lax",
  });
};
