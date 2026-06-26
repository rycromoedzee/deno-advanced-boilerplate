/**
 * @file utils/auth/context.ts
 * @description Auth context helpers
 */
import type { HonoContext } from "@deps";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getTraceContext } from "@services/tracing/index.ts";
import type { ITokensSessionData } from "@services/token/index.ts";

/**
 * Authentication context interface
 * Contains user details for authenticated requests
 */
export interface AuthContext {
  userId: string;
  environmentId: string;
  isAdmin: boolean;
  firstName: string;
  lastName: string;
  fullName: string;
}

/**
 * Retrieves authenticated user context from request
 *
 * This utility provides centralized, type-safe access to authentication context.
 * It validates that all required fields are present in the request context,
 * ensuring complete authentication information is available for all operations.
 *
 * @param c - Hono context object from the request handler
 * @returns AuthContext with userId, environmentId, isAdmin, firstName, lastName, and fullName
 * @throws HTTP 401 (AUTH.UNAUTHORIZED) if required auth fields are missing
 */
export const getAuthContext = (c: HonoContext): AuthContext => {
  const userId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails);
  const environmentId = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserEnvironmentIdDetails);
  const isAdmin = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIsAdmin);
  const firstName = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserFirstName) || "";
  const lastName = c.get(AUTH_HEADER_NAMING.internalUsageAuthUserLastName) || "";

  if (!userId || !environmentId) {
    throwHttpError("AUTH.UNAUTHORIZED");
  }

  return {
    userId,
    environmentId,
    isAdmin: isAdmin ?? false,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
  };
};

/**
 * Set authenticated context values on the Hono context and update trace context userId
 *
 * @param c - Hono context object from the request handler
 * @param userId - Authenticated user ID
 * @param environmentId - User's environment ID
 * @param isAdmin - Whether the user has admin privileges
 * @param firstName - User's first name
 * @param lastName - User's last name
 * @param sessionKey - Optional session key
 */
export const setAuthenticatedContext = (
  c: HonoContext,
  userId: string,
  environmentId: string,
  isAdmin: boolean,
  firstName: string,
  lastName: string,
  sessionKey?: string,
  // The validated JWT session, threaded so the encryption-key path can reuse it
  // instead of re-running validateJWTSession. SENSITIVE — contains encryption-
  // derived keys. Only the JWT auth flow passes this (post-validation); the API-
  // key flow omits it. Never log/trace/serialize this value.
  sessionData?: ITokensSessionData | null,
): void => {
  c.set(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails, userId);
  c.set(AUTH_HEADER_NAMING.internalUsageAuthUserEnvironmentIdDetails, environmentId);
  c.set(AUTH_HEADER_NAMING.internalUsageAuthUserIsAdmin, isAdmin);
  c.set(AUTH_HEADER_NAMING.internalUsageAuthUserFirstName, firstName);
  c.set(AUTH_HEADER_NAMING.internalUsageAuthUserLastName, lastName);

  if (sessionKey) {
    c.set(AUTH_HEADER_NAMING.internalSessionKey, sessionKey);
  }

  if (sessionData) {
    c.set(AUTH_HEADER_NAMING.internalValidatedSession, sessionData);
  }

  // Update trace context with userId for downstream spans
  try {
    const traceContext = getTraceContext();
    const ctx = traceContext.getContext();
    if (ctx) {
      ctx.userId = userId;
    }
  } catch {
    // TraceContext may not be initialized — non-critical
  }
};
