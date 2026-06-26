/**
 * @file middleware/super-admin.middleware.ts
 * @description Super Admin middleware
 */
import type { HonoContext, HonoNext } from "@deps";
import { and, eq, getCookie, HTTPException, setCookie } from "@deps";
import { envConfig } from "@config/env.ts";
import { getTokenHelperService } from "@services/token/index.ts";
import { loggerAppSections, LoggerLevels, useLogSecurityEvent } from "@logger/index.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { ensureMinimumProcessingTime, safeEqual, TIMING_PROFILES } from "@utils/shared/index.ts";
import { getDB, tables } from "@db/index.ts";
import { INTERNAL_TOOLING_IP_WHITELIST_TAG } from "@db/enums/index.ts";
import { ITokensPayloadJWT } from "@services/token/config.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { getClientIP, getUserAgent } from "@middleware/request-context.middleware.ts";

/**
 * Super Admin Middleware
 * Protects admin-only endpoints with consistent authentication
 */
export async function superAdminMiddleware(c: HonoContext, next: HonoNext) {
  const startTime = performance.now();
  const isDebugEnabled = Deno.env.get("INTERNAL_TOOL_DEBUG") === "true";

  // Use shared context from requestContextMiddleware (IP already extracted once)
  const clientIP = getClientIP(c);
  const userAgent = getUserAgent(c);
  const endpoint = c.req.path;
  const method = c.req.method;

  // Allow admin UI static assets to load without auth so the SPA can bootstrap
  if (
    endpoint.startsWith("/internal/__admin/assets/") ||
    endpoint === "/internal/__admin/favicon.ico"
  ) {
    return await next();
  }

  if (isDebugEnabled) {
    console.warn("[admin-debug] middleware entry", {
      endpoint,
      method,
      ip: IPLookupUtils.anonymizeIP(clientIP),
    });
  }

  try {
    if (!envConfig.private.isInternalToolsEnabled) {
      if (isDebugEnabled) {
        console.warn("[admin-debug] denied: internal tools disabled", {
          endpoint,
          method,
          ip: IPLookupUtils.anonymizeIP(clientIP),
        });
      }
      throw new HTTPException(404, { message: "Not Found" });
    }

    if (envConfig.isDevelopment) {
      return await next();
    }

    if (envConfig.private.internalToolToken) {
      const adminTokenFromHeader = c.req.header("Admin-Token");
      const adminTokenFromQuery = c.req.query("admin_token");
      const adminTokenFromCookie = getCookie(c, "Admin-Token") ||
        getCookie(c, "admin_token");
      const adminToken = adminTokenFromHeader ||
        adminTokenFromQuery ||
        adminTokenFromCookie;
      if (
        adminToken && safeEqual(envConfig.private.internalToolToken, adminToken)
      ) {
        if (adminTokenFromHeader || adminTokenFromQuery) {
          setCookie(c, "Admin-Token", adminToken, {
            path: "/internal/__admin",
            secure: envConfig.isProduction,
            domain: envConfig.isProduction ? `.${envConfig.baseDomain}` : undefined,
            httpOnly: true,
            maxAge: 15 * 60,
            sameSite: "Lax",
          });
        }
        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.FAST,
        );
        await logSuccessfulAccess(
          "admin-token",
          clientIP,
          userAgent || "unknown",
          endpoint,
          method,
          performance.now() - startTime,
        );
        return await next();
      }
      if (isDebugEnabled) {
        console.warn("[admin-debug] denied: admin token invalid", {
          reason: adminToken ? "admin_token_mismatch" : "admin_token_missing",
          endpoint,
          method,
          ip: IPLookupUtils.anonymizeIP(clientIP),
        });
      }
    }

    const token = c.req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
      if (isDebugEnabled) {
        console.warn("[admin-debug] denied: missing bearer token", {
          endpoint,
          method,
          ip: IPLookupUtils.anonymizeIP(clientIP),
        });
      }
      throw await logCompleteUnauthorizedAccess(startTime, clientIP, userAgent, endpoint, method);
    }

    let userId: string;
    try {
      const tokenHelperService = getTokenHelperService();
      const user = await tokenHelperService.useVerifyTokenJWT(
        token,
        JWT_TOKEN_CONFIG.audiences.auth,
      ) as ITokensPayloadJWT;
      userId = user.sub.toString();
    } catch (_error) {
      if (isDebugEnabled) {
        console.warn("[admin-debug] denied: invalid bearer token", {
          endpoint,
          method,
          ip: IPLookupUtils.anonymizeIP(clientIP),
        });
      }
      throw await logCompleteUnauthorizedAccess(startTime, clientIP, userAgent, endpoint, method);
    }

    if (envConfig.private.isInternalToolsIpRestricted) {
      await getDB()
        .select()
        .from(tables.whitelistedIPs)
        .where(
          and(
            eq(tables.whitelistedIPs.ipAddress, clientIP),
            eq(tables.whitelistedIPs.reason, INTERNAL_TOOLING_IP_WHITELIST_TAG),
          ),
        )
        .limit(1)
        .then(async (res) => {
          if (res.length === 0) {
            if (isDebugEnabled) {
              console.warn("[admin-debug] denied: IP not whitelisted", {
                endpoint,
                method,
                ip: IPLookupUtils.anonymizeIP(clientIP),
              });
            }
            throw await logCompleteUnauthorizedAccess(startTime, clientIP, userAgent, endpoint, method);
          }
        });
    }

    await logSuccessfulAccess(
      userId,
      clientIP,
      userAgent || "unknown",
      endpoint,
      method,
      performance.now() - startTime,
    );

    c.set("isSuperAdmin", true);
    c.set("superAdminUserId", userId);

    return await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    await useLogSecurityEvent(
      LoggerLevels.critical,
      `Unexpected error in admin middleware`,
      "critical",
      loggerAppSections.INTERNAL,
      `admin-access.Unexpected_Error`,
      {
        error: error instanceof Error ? error.message : String(error),
        endpoint,
        method,
        ip: IPLookupUtils.anonymizeIP(clientIP),
      },
    );

    throw new HTTPException(404, { message: "Not Found" });
  }
}

/**
 * Log successful super admin access
 */
async function logSuccessfulAccess(
  userId: string,
  ip: string,
  userAgent: string,
  endpoint: string,
  method: string,
  processingTime: number,
): Promise<void> {
  await useLogSecurityEvent(
    LoggerLevels.info,
    `admin-access accessed by super admin`,
    "low",
    loggerAppSections.INTERNAL,
    `admin-access.Access_Granted`,
    {
      userId,
      ip: IPLookupUtils.anonymizeIP(ip),
      userAgent: userAgent.substring(0, 200),
      endpoint,
      method,
      processingTime: Math.round(processingTime),
      timestamp: Date.now(),
      success: true,
    },
  );
}

/**
 * Log complete unauthorized access attempt with timing protection
 * Combines timing enforcement and security event logging
 */
async function logCompleteUnauthorizedAccess(
  startTime: number,
  ip: string,
  userAgent: string,
  endpoint: string,
  method: string,
) {
  await ensureMinimumProcessingTime(
    startTime,
    TIMING_PROFILES.FAST,
  );

  const eventDescription = `Unauthorized attempt to access admin endpoint`;

  await useLogSecurityEvent(
    LoggerLevels.warn,
    eventDescription,
    "medium",
    loggerAppSections.INTERNAL,
    `admin-access.no_authentication_unauthorized`,
    {
      success: false,
      reason: "no_authentication",
      eventType: "admin_access",
      endpoint,
      method,
      ip: IPLookupUtils.anonymizeIP(ip),
      userAgent: (userAgent || "unknown").substring(0, 200),
      userId: "unknown",
      timestamp: Date.now(),
    },
  );

  throw new HTTPException(404, { message: "Not Found" });
}
