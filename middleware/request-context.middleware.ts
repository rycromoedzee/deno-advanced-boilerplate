/**
 * @file middleware/request-context.middleware.ts
 * @description Request Context middleware
 */
/**
 * Unified Request Context Middleware
 *
 * Consolidates IP extraction and threat intelligence checks into a single pass.
 * This eliminates redundant IP lookups across auth, rate-limit, tracing, and super-admin middlewares.
 *
 * Features:
 * - Extracts client IP once using shared IPLookupUtils
 * - Runs threat intelligence check once (with env-based enablement check)
 * - Stores all context via c.set() for downstream middlewares
 * - Handles early blocking for known threats (403 with no body)
 *
 * Context values set:
 * - clientIP: string - The extracted client IP
 * - userAgent: string - The user agent header
 * - ipSecurityCheck: ThreatIntelligenceResult | null - Threat check result
 */

import type { HonoContext, HonoNext } from "@deps";
import { getThreatIntelligenceService } from "@services/threat-intelligence/index.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { envConfig } from "@config/env.ts";
import type { ThreatIntelligenceResult } from "@services/threat-intelligence/index.ts";

const threatIntelligenceService = getThreatIntelligenceService();

/**
 * Context keys set by this middleware
 */
export const REQUEST_CONTEXT_KEYS = {
  clientIP: "clientIP",
  userAgent: "userAgent",
  ipSecurityCheck: "ipSecurityCheck",
} as const;

/**
 * Unified request context middleware
 *
 * Should run early in the middleware chain, after logging/tracing but before auth.
 * Respects envConfig.threatIntelligence.enabled and envConfig.isDevelopment.
 */
export const requestContextMiddleware = async (c: HonoContext, next: HonoNext) => {
  // Extract IP and user agent once
  const clientIP = IPLookupUtils.extractIPFromRequest(c);
  const userAgent = c.req.header("user-agent") || "unknown";

  // Store basic context for all downstream middlewares
  c.set(REQUEST_CONTEXT_KEYS.clientIP, clientIP);
  c.set(REQUEST_CONTEXT_KEYS.userAgent, userAgent);

  // Skip threat intelligence check in development or when disabled
  const shouldRunThreatCheck = !envConfig.isDevelopment && envConfig.threatIntelligence.enabled;

  if (!shouldRunThreatCheck) {
    c.set(REQUEST_CONTEXT_KEYS.ipSecurityCheck, null);
    return await next();
  }

  // Skip if no valid IP
  if (!clientIP || clientIP === "unknown") {
    c.set(REQUEST_CONTEXT_KEYS.ipSecurityCheck, null);
    return await next();
  }

  const result = await threatIntelligenceService.checkIP(clientIP, {
    path: c.req.path,
    method: c.req.method,
    userAgent,
  });

  // Store result for downstream middlewares (auth, rate-limit, tracing)
  c.set(REQUEST_CONTEXT_KEYS.ipSecurityCheck, result);

  // Early block for known threats - minimal server resources spent
  // No tracing, no breadcrumbs, no logging for blocked requests to avoid log spam
  if (result.action === "block") {
    return c.body(null, 403);
  }

  return await next();
};

/**
 * Helper to get client IP from context (for downstream middlewares)
 */
export function getClientIP(c: HonoContext): string {
  return c.get(REQUEST_CONTEXT_KEYS.clientIP) || "unknown";
}

/**
 * Helper to get user agent from context (for downstream middlewares)
 */
export function getUserAgent(c: HonoContext): string {
  return c.get(REQUEST_CONTEXT_KEYS.userAgent) || "unknown";
}

/**
 * Helper to get IP security check result from context
 */
export function getIPSecurityCheck(c: HonoContext): ThreatIntelligenceResult | null {
  return c.get(REQUEST_CONTEXT_KEYS.ipSecurityCheck) || null;
}
