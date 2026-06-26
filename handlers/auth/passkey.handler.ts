/**
 * @file handlers/auth/passkey.handler.ts
 * @description Route handlers for passkey-based login
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { passkeyLoginBeginRoute, passkeyLoginVerifyRoute } from "@routes/auth/passkey.route.ts";
import { getPasskeyLoginService } from "@services/auth/index.ts";
import { useSetCookie, useSetSessionKeyCookie, useSetSignedCookie } from "@utils/cookie.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { SchemaPasskeyLoginBeginResponse, SchemaPasskeyLoginVerifyResponse } from "@models/auth/auth-response.model.ts";

const passkeyLoginService = getPasskeyLoginService();

/**
 * Converts an ArrayBuffer-like object (with numeric keys) to a base64 string.
 * WebAuthn PRF results are returned as ArrayBuffers which get serialized as
 * {"0": 194, "1": 248, ...} when sent over JSON.
 */
function arrayBufferLikeToBase64(bufferLike: unknown): string | undefined {
  if (!bufferLike || typeof bufferLike !== "object") {
    return undefined;
  }

  // If it's already a string, return it
  if (typeof bufferLike === "string") {
    return bufferLike;
  }

  // Convert object with numeric keys to Uint8Array
  const obj = bufferLike as Record<string, unknown>;
  const keys = Object.keys(obj).map(Number).filter((k) => !isNaN(k));

  if (keys.length === 0) {
    return undefined;
  }

  const maxKey = Math.max(...keys);
  const uint8Array = new Uint8Array(maxKey + 1);

  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number") {
      uint8Array[key] = value;
    }
  }

  // Convert to base64
  return btoa(String.fromCharCode(...uint8Array));
}

/**
 * Extracts PRF output from either the request's prfOutput field or from
 * clientExtensionResults.prf.results.first (fallback for frontends that
 * don't extract and send PRF output separately).
 */
function extractPrfOutput(
  prfOutput: { first?: string } | undefined,
  clientExtensionResults: Record<string, unknown>,
): string | undefined {
  // First, try the explicit prfOutput field
  if (prfOutput?.first) {
    return prfOutput.first;
  }

  // Fallback: extract from clientExtensionResults.prf.results.first
  const extResults = clientExtensionResults as { prf?: { results?: { first?: unknown } } };
  const prfResults = extResults?.prf?.results;

  if (prfResults?.first) {
    return arrayBufferLikeToBase64(prfResults.first);
  }

  return undefined;
}

/**
 * POST /api/auth/passkey/begin
 * Initiates passkey login by looking up user credentials
 */
export const passkeyLoginBeginHandler = defineHandler(
  {
    route: passkeyLoginBeginRoute,
    operationName: "auth_passkey_login_begin",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaPasskeyLoginBeginResponse,
  },
  async ({ c, body }) => {
    const { username } = body;
    const url = new URL(c.req.url);
    const hostname = url.hostname;

    const result = await passkeyLoginService.beginPasskeyLogin(username, hostname);

    return {
      data: {
        isAuthCompleted: false as const,
        nextStep: "passkey-verify" as const,
        attemptId: result.attemptId,
        requestOptions: result.requestOptions,
        prfEvaluationRequest: result.prfEvaluationRequest,
      },
      status: 200 as const,
    };
  },
);

/**
 * POST /api/auth/passkey/verify
 * Verifies passkey authentication and creates session
 */
export const passkeyLoginVerifyHandler = defineHandler(
  {
    route: passkeyLoginVerifyRoute,
    operationName: "auth_passkey_login_verify",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaPasskeyLoginVerifyResponse,
  },
  async ({ c, body }) => {
    const { attemptId, credential, prfOutput } = body;

    const requestContext = IPLookupUtils.getRequestContext(c);
    const url = c.req.url;
    const hostname = new URL(url).hostname;

    // Extract PRF output from either explicit field or clientExtensionResults
    const extractedPrfOutput = extractPrfOutput(prfOutput, credential.clientExtensionResults);

    const result = await passkeyLoginService.verifyPasskeyLogin(
      attemptId,
      credential,
      url,
      hostname,
      {
        userAgent: requestContext.userAgent,
        accept: requestContext.headers["accept"] || "unknown",
        lang: requestContext.headers["Accept-Language"] || "unknown",
      },
      requestContext.ip,
      c,
      extractedPrfOutput, // Pass extracted PRF output for encryption key derivation
    );

    // Set session cookies
    useSetCookie(
      c,
      AUTH_HEADER_NAMING.access,
      result.accessToken,
      JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
    );
    await useSetSignedCookie(
      c,
      AUTH_HEADER_NAMING.refresh,
      result.refreshToken,
      JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
    );
    // Set ephemeral session key cookie — used to decrypt cached derived keys on future requests
    useSetSessionKeyCookie(c, result.sessionKey, JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration);

    return {
      data: {
        isAuthCompleted: true as const,
        message: result.message,
        userId: result.userId,
        environmentId: result.environmentId,
        displayName: result.displayName,
        // Include stale passkey credential ID if present (escrow expired case)
        ...(result.stalePasskeyCredentialId && {
          stalePasskeyCredentialId: result.stalePasskeyCredentialId,
        }),
      },
      status: 200 as const,
    };
  },
);
