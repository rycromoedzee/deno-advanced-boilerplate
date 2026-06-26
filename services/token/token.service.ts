/**
 * @file services/token/token.service.ts
 * @description Token service (token)
 */
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getTokenHelperService } from "./index.ts";
import { ITokensDeviceTypeOptions, ITokensPayloadCreateJWT, ITokensSessionData } from "./config.ts";
import { tokenHashString } from "./token-utils.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { nodeRandomBytes as randomBytes } from "@deps";
import { loggerAppSections } from "@logger/index.ts";

/**
 * Token Service (JWT, Refresh, API Key)
 * ------------------------------------------------
 * Provides helpers for signing, verifying, and refreshing JWT tokens using various algorithms.
 * Handles key retrieval from environment, token fingerprinting, and secure refresh token generation.
 *
 * - Uses Ed25519 or other supported algorithms for signing/verification
 * - Integrates with Deno.env for key management
 * - Implements secure refresh token generation
 * - Provides fingerprinting for user refresh token validation
 *
 * All functions are production-ready and follow best practices for security and error handling.
 */

/**
 * Generates a signed JWT access token, stores session data, and updates user session list in cache.
 * @param payload - JWT payload with subject, type, audience, and optional environmentId.
 * @param ipAddress - IP address of the user for session tracking.
 * @param deviceInfo - Device information for the session.
 * @param userProfile - Optional cached user profile data (firstName, lastName) to avoid per-request DB lookups.
 * @returns Promise<string> The signed JWT token.
 * @throws HTTPException on generation errors.
 */
export async function generateJwtAuthToken(
  payload: ITokensPayloadCreateJWT,
  ipAddress: string,
  deviceInfo: ITokensDeviceTypeOptions,
  userProfile?: { firstName: string; lastName: string },
  sessionId?: string,
): Promise<string> {
  return await tracedWithServiceErrorHandling(
    "generateJwtAuthToken",
    {
      service: "TokenService",
      method: "generateJwtAuthToken",
      section: loggerAppSections.JWT,
      details: { userId: payload.sub, tokenType: payload.type },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async (span) => {
      span.attributes["user_id"] = payload.sub;
      span.attributes["token_type"] = payload.type;
      span.attributes["has_environment_id"] = !!payload.environmentId;

      const cache = await getCache();
      const tokenHelper = getTokenHelperService();

      const meta = payload.environmentId ? { environmentId: payload.environmentId } : undefined;
      const token = await tokenHelper.signTokenJWT(
        JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
        payload.sub,
        payload.type,
        payload.aud,
        meta,
      );

      const hashed = tokenHashString(token);
      const sessionData: ITokensSessionData = {
        sessionId,
        userId: payload.sub,
        tokenHash: hashed,
        deviceInfo,
        createdAt: getTimeNow(),
        ipAddress,
        environmentId: payload.environmentId,
        // Cache user profile to avoid per-request DB lookups in auth middleware
        firstName: userProfile?.firstName,
        lastName: userProfile?.lastName,
      };

      await cache.set(
        CACHE_NAMESPACES.AUTH.JWT_SESSION,
        hashed,
        sessionData,
        { ttl: JWT_TOKEN_CONFIG.tokenTTL.authExpiration },
      );

      span.attributes["success"] = true;
      return token;
    },
  );
}

/**
 * Generates a secure random password reset token.
 * Note: This returns a random token, NOT a JWT.
 * @returns string The secure random reset token (base64url encoded).
 * @throws HTTPException on generation errors.
 */
export function generateSecureResetToken(): string {
  try {
    return randomBytes(64).toString("base64url");
  } catch (error) {
    // caller owns logging
    throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
  }
}

// Keep legacy export for backwards compatibility
export const generateJwtResetToken = generateSecureResetToken;
