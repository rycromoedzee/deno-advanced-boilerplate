/**
 * @file middleware/auth.middleware.ts
 * @description Auth middleware
 */
/**
 * Authentication Middleware
 *
 * Full auth middleware with security features:
 * - JWT and API key validation
 * - Tracing breadcrumbs (warning/error only)
 * - Security event logging for JWT/API key failures, IP monitoring, anonymizer detection
 * - Challenge flow via auth-challenge.service.ts
 * - Revoked token handling
 * - IP change detection with security logging
 * - TraceContext userId updates
 * - firstName/lastName context values
 * - Timing attack protection (minimum processing time)
 *
 * Environment status (suspended) and feature flag checks are handled
 * by featureGuardMiddleware (see feature-guard.middleware.ts).
 *
 * Uses shared context from request-context.middleware.ts for IP, user agent, and IP security checks.
 * Uses getGlobalDB() + globalTables for user lookups.
 */

import type { HonoContext, HonoNext } from "@deps";
import { eq, HTTPException, setCookie } from "@deps";
import { envConfig } from "@config/env.ts";
import { ITokensSessionData } from "@services/token/config.ts";
import { AUTH_HEADER_NAMING, getSessionApiKeyValidation, getSessionValidationService } from "@services/session/index.ts";
import { loggerAppSections, LoggerLevels, useLogSecurityEvent } from "@logger/index.ts";
import { IPLookupUtils } from "@utils/network/ip-lookup.ts";
import { getClientIP, getIPSecurityCheck, getUserAgent } from "@middleware/request-context.middleware.ts";
import { getGlobalDB, globalTables } from "@db/db.ts";
import { requestContext as tenantRequestContext } from "@db/context.ts";
import { useGetCookie } from "@utils/cookie.ts";
import { getTraceContext } from "@services/tracing/index.ts";
import { executeChallengeFlow, handleRevokedTokenChallenge } from "@services/auth/auth-challenge.service.ts";
import { ChallengeEligibleSessionRevocationError } from "@services/session/session-validate.service.ts";
import { getCachedUserAdminStatus } from "@services/permissions/index.ts";
import { setAuthenticatedContext } from "@utils/auth/context.ts";
import { tokenHashString } from "@services/token/index.ts";

// ==========================================
// Constants
// ==========================================

/**
 * Minimum processing time (ms) for failure paths to prevent timing attacks.
 * Set to match typical successful auth duration (~15ms) so failures are
 * indistinguishable from successes via response time.
 * Not applied on success — no padding needed when auth completes normally.
 */
const MIN_PROCESSING_TIME_MS = 15;

// ==========================================
// Singletons
// ==========================================

const apiKeyValidationService = getSessionApiKeyValidation();

// ==========================================
// Helper Functions
// ==========================================

const Throw401 = () => {
  throw new HTTPException(401, { message: "User not authenticated" });
};

/**
 * Clear the refresh token cookie (set maxAge to 0)
 */
function clearRefreshTokenCookie(c: HonoContext): void {
  setCookie(c, AUTH_HEADER_NAMING.refresh, "", {
    path: "/",
    secure: envConfig.isProduction,
    domain: envConfig.isProduction ? `.${envConfig.baseDomain}` : undefined,
    httpOnly: true,
    maxAge: 0,
    sameSite: "Lax",
  });
}

/**
 * Fetch user profile names from the global DB and resolve tenant admin from the permissions cache/tenant DB.
 */
async function fetchUserContext(userId: string, environmentId: string): Promise<
  {
    isAdmin: boolean;
    firstName: string;
    lastName: string;
  } | null
> {
  const [result, isAdmin] = await Promise.all([
    getGlobalDB()
      .select({
        firstName: globalTables.users.firstName,
        lastName: globalTables.users.lastName,
      })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, userId))
      .limit(1),
    getCachedUserAdminStatus(userId, environmentId),
  ]);

  if (result.length === 0) return null;
  return {
    isAdmin,
    firstName: result[0].firstName,
    lastName: result[0].lastName,
  };
}

/**
 * Ensure a minimum processing time to prevent timing-based attacks
 */
async function enforceMinProcessingTime(startTime: number): Promise<void> {
  const elapsed = performance.now() - startTime;
  if (elapsed < MIN_PROCESSING_TIME_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_PROCESSING_TIME_MS - elapsed));
  }
}

// ==========================================
// Main Middleware
// ==========================================

export const authMiddleware = async (c: HonoContext, next: HonoNext) => {
  const traceContext = getTraceContext();

  // Skip non-API and public routes
  if (!(c.req.path.startsWith("/api"))) return await next();
  if (c.req.path.startsWith("/api/auth/")) return await next();
  if (c.req.path.startsWith("/api/public/")) return await next();
  if (c.req.path.startsWith("/api/internal/")) return await next();
  if (c.req.path.startsWith("/api/webhooks/")) return await next();
  if (c.req.path.startsWith("/api/security/csp/report")) return await next();

  const startTime = performance.now();

  // Use shared context from requestContextMiddleware (IP + user agent already extracted once)
  const clientIP = getClientIP(c);
  const clientUserAgent = getUserAgent(c);
  const anonymizedIP = clientIP ? IPLookupUtils.anonymizeIP(clientIP) : "unknown";

  // Extract tokens and keys
  const jwtToken = useGetCookie(c, AUTH_HEADER_NAMING.access);
  const refreshToken = useGetCookie(c, AUTH_HEADER_NAMING.refresh);
  const sessionKey = useGetCookie(c, AUTH_HEADER_NAMING.sessionKey) || undefined;
  const apiKey = c.req.header(AUTH_HEADER_NAMING.api);

  if (!jwtToken && !apiKey && !refreshToken) {
    traceContext.addBreadcrumb("auth", "No credentials provided", "warning", {
      ip: anonymizedIP,
      path: c.req.path,
    });
    await enforceMinProcessingTime(startTime);
    Throw401();
  }

  // Use pre-computed IP security check from requestContextMiddleware
  const ipSecurityCheck = getIPSecurityCheck(c);

  // Log anonymizer/VPN/proxy detection (warning-level breadcrumb)
  if (ipSecurityCheck?.metadata?.isAnonymizer) {
    traceContext.addBreadcrumb("auth", "Anonymizer/VPN/proxy detected", "warning", {
      ip: anonymizedIP,
      riskScore: ipSecurityCheck.riskScore,
      category: ipSecurityCheck.category,
      sourceCategories: ipSecurityCheck.metadata.sourceCategories?.join(",") ?? "unknown",
    });

    await useLogSecurityEvent(
      LoggerLevels.warn,
      "Anonymizer detected during auth",
      "medium",
      loggerAppSections.AUTH,
      "Auth.Anonymizer_Detected",
      {
        ip: anonymizedIP,
        userAgent: clientUserAgent,
        riskScore: ipSecurityCheck.riskScore,
        category: ipSecurityCheck.category,
        sourceCategories: ipSecurityCheck.metadata.sourceCategories,
        path: c.req.path,
      },
    );
  }

  // ==========================================
  // JWT Validation
  // ==========================================

  let jwtValidationResult: {
    success: boolean;
    userId?: string;
    environmentId?: string;
    sessionData?: ITokensSessionData;
  } = { success: false };

  if (jwtToken) {
    if (!refreshToken) {
      traceContext.addBreadcrumb("auth", "JWT without refresh token", "warning", {
        ip: anonymizedIP,
      });
      await enforceMinProcessingTime(startTime);
      Throw401();
    }

    try {
      const data = await getSessionValidationService().validateJWTSession(jwtToken);
      jwtValidationResult = {
        success: true,
        userId: data.userId,
        environmentId: data.environmentId,
        sessionData: data,
      };
    } catch (error) {
      if (error instanceof ChallengeEligibleSessionRevocationError) {
        await handleRevokedTokenChallenge(
          c,
          jwtToken,
          error.userId,
          clearRefreshTokenCookie,
          error.sessionData,
          error.revokedAt,
        );
      }

      if (error instanceof HTTPException && error.status === 428) {
        throw error;
      }

      // JWT validation failed
      jwtValidationResult = { success: false };

      traceContext.addBreadcrumb("auth", "JWT validation failed", "warning", {
        ip: anonymizedIP,
        error: error instanceof Error ? error.message : "Unknown",
      });
    }
  }

  // ==========================================
  // API Key Validation
  // ==========================================

  let apiKeyValidationResult: {
    success: boolean;
    userId?: string;
    environmentId?: string;
  } = { success: false };

  if (apiKey) {
    try {
      const result = await apiKeyValidationService.validateApiKey(
        apiKey,
        clientIP || undefined,
        new URL(c.req.url).hostname,
      );
      apiKeyValidationResult = {
        success: true,
        userId: result.userId,
        environmentId: result.environmentId,
      };
    } catch (error) {
      apiKeyValidationResult = { success: false };

      traceContext.addBreadcrumb("auth", "API key validation failed", "warning", {
        ip: anonymizedIP,
        error: error instanceof Error ? error.message : "Unknown",
      });

      await useLogSecurityEvent(
        LoggerLevels.warn,
        "API key validation failed",
        "medium",
        loggerAppSections.AUTH,
        "Auth.API_Key_Validation_Failed",
        {
          ip: anonymizedIP,
          apiKeyHash: tokenHashString(apiKey),
          userAgent: clientUserAgent,
          error: error instanceof Error ? error.message : "Unknown",
          path: c.req.path,
        },
      );
    }
  }

  // ==========================================
  // JWT Authenticated Flow
  // ==========================================

  if (jwtValidationResult.success && jwtValidationResult.userId && jwtValidationResult.environmentId) {
    const sessionData = jwtValidationResult.sessionData;
    const userId = jwtValidationResult.userId;
    const environmentId = jwtValidationResult.environmentId;

    // Resolve names from session cache or DB and resolve admin from permission cache/tenant DB.
    let userDetails: { isAdmin: boolean; firstName: string; lastName: string } | null = null;

    if (sessionData?.firstName !== undefined && sessionData?.lastName !== undefined) {
      const resolvedIsAdmin = await getCachedUserAdminStatus(userId, environmentId);
      userDetails = {
        isAdmin: resolvedIsAdmin,
        firstName: sessionData.firstName!,
        lastName: sessionData.lastName!,
      };
    } else {
      userDetails = await fetchUserContext(userId, environmentId);
    }

    if (!userDetails) {
      traceContext.addBreadcrumb("auth", "User not found in DB after JWT validation", "error", {
        userId,
        ip: anonymizedIP,
      });
      await enforceMinProcessingTime(startTime);
      return Throw401();
    }

    // IP change detection
    let ipChangeDetected = false;
    if (sessionData?.ipAddress && clientIP && sessionData.ipAddress !== clientIP) {
      ipChangeDetected = true;

      traceContext.addBreadcrumb("auth", "IP address change detected", "warning", {
        userId,
        previousIP: IPLookupUtils.anonymizeIP(sessionData.ipAddress),
        currentIP: anonymizedIP,
      });

      await useLogSecurityEvent(
        LoggerLevels.warn,
        "IP address change detected during session",
        "high",
        loggerAppSections.AUTH,
        "Auth.IP_Change_Detected",
        {
          userId,
          previousIP: IPLookupUtils.anonymizeIP(sessionData.ipAddress),
          currentIP: anonymizedIP,
          userAgent: clientUserAgent,
          path: c.req.path,
        },
      );
    }

    // Determine if challenge is needed:
    // - IP changed during session
    // - IP flagged as suspicious/malicious by threat intelligence
    const isSuspiciousIP = ipSecurityCheck?.action === "challenge" || ipSecurityCheck?.action === "block";
    const needsChallenge = ipChangeDetected || isSuspiciousIP;

    if (needsChallenge && jwtToken && refreshToken) {
      traceContext.addBreadcrumb("auth", "Challenge flow triggered", "warning", {
        userId,
        ip: anonymizedIP,
        reason: ipChangeDetected ? "ip_change" : "suspicious_ip",
        action: ipSecurityCheck?.action ?? "none",
        riskScore: ipSecurityCheck?.riskScore ?? 0,
      });

      await useLogSecurityEvent(
        LoggerLevels.warn,
        "Auth challenge triggered",
        "high",
        loggerAppSections.AUTH,
        "Auth.Challenge_Triggered",
        {
          userId,
          ip: anonymizedIP,
          reason: ipChangeDetected ? "ip_change" : "suspicious_ip",
          action: ipSecurityCheck?.action ?? "none",
          riskScore: ipSecurityCheck?.riskScore ?? 0,
          isAnonymizer: ipSecurityCheck?.metadata?.isAnonymizer ?? false,
          path: c.req.path,
        },
      );

      // executeChallengeFlow always throws 428
      await executeChallengeFlow(c, userId, jwtToken, refreshToken, ipChangeDetected, clearRefreshTokenCookie);
    }

    // Set authenticated context. sessionData is threaded so the encryption-key
    // path can reuse the already-validated session instead of re-running
    // validateJWTSession (a redundant second verify whose failure was swallowed
    // into ENCRYPTION.KEY_NOT_FOUND rather than acting as a real auth gate).
    setAuthenticatedContext(
      c,
      userId,
      environmentId,
      userDetails.isAdmin,
      userDetails.firstName,
      userDetails.lastName,
      sessionKey,
      sessionData,
    );

    return await tenantRequestContext.run({
      environmentId,
      userId,
    }, () => next());
  }

  // ==========================================
  // API Key Authenticated Flow
  // ==========================================

  if (apiKeyValidationResult.success && apiKeyValidationResult.userId && apiKeyValidationResult.environmentId) {
    const userId = apiKeyValidationResult.userId;
    const environmentId = apiKeyValidationResult.environmentId;

    const userDetails = await fetchUserContext(userId, environmentId);
    if (!userDetails) {
      traceContext.addBreadcrumb("auth", "User not found in DB after API key validation", "error", {
        userId,
        ip: anonymizedIP,
      });
      await enforceMinProcessingTime(startTime);
      return Throw401();
    }

    // Log IP monitoring for API key access from suspicious IPs
    if (ipSecurityCheck?.isSuspicious) {
      await useLogSecurityEvent(
        LoggerLevels.warn,
        "API key used from suspicious IP",
        "medium",
        loggerAppSections.AUTH,
        "Auth.API_Key_Suspicious_IP",
        {
          userId,
          ip: anonymizedIP,
          action: ipSecurityCheck.action,
          riskScore: ipSecurityCheck.riskScore,
          category: ipSecurityCheck.category,
          sourceCategories: ipSecurityCheck.metadata.sourceCategories,
          path: c.req.path,
        },
      );
    }

    setAuthenticatedContext(
      c,
      userId,
      environmentId,
      userDetails.isAdmin,
      userDetails.firstName,
      userDetails.lastName,
    );

    return await tenantRequestContext.run({
      environmentId,
      userId,
    }, () => next());
  }

  // ==========================================
  // No valid authentication
  // ==========================================

  traceContext.addBreadcrumb("auth", "All authentication methods failed", "warning", {
    ip: anonymizedIP,
    hasJwt: !!jwtToken,
    hasApiKey: !!apiKey,
    hasRefresh: !!refreshToken,
    path: c.req.path,
  });

  // Only log security event when there's no refresh token — having a refresh token
  // means the client can still attempt a token refresh, which is a normal flow
  if (!refreshToken) {
    await useLogSecurityEvent(
      LoggerLevels.warn,
      "Authentication failed - no valid credentials",
      "medium",
      loggerAppSections.AUTH,
      "Auth.All_Methods_Failed",
      {
        ip: anonymizedIP,
        userAgent: clientUserAgent,
        hasJwt: !!jwtToken,
        hasApiKey: !!apiKey,
        hasRefresh: false,
        path: c.req.path,
      },
    );
  }

  await enforceMinProcessingTime(startTime);
  Throw401();
};
