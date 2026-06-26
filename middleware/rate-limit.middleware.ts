/**
 * @file middleware/rate-limit.middleware.ts
 * @description Rate Limit middleware
 */
// middleware/rate-limit.middleware.ts

import { bytesToHex, type HonoContext } from "@deps";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { getClientIP, getIPSecurityCheck, getUserAgent } from "@middleware/request-context.middleware.ts";
import { hashData } from "@utils/text/index.ts";
import { buildRateLimitKey } from "@utils/auth/cache-keys.ts";

function hash(str: string) {
  return bytesToHex(hashData(str, 16));
}

/**
 * Request rate-limit key prefixes — exported for the disjointness contract test.
 *
 * Keys are assembled by {@link buildRateLimitKey} in `utils/auth/cache-keys.ts`
 * (the single authoritative key-building site). These constants are kept here
 * so that `tests/unit/utils/auth/rate-limit-key-contracts.test.ts` can assert
 * the wire format without depending on internal factory state.
 *
 *   - Authenticated: `user:<userId>:<path>` — PLAIN body, per-user per-route.
 *   - Anonymous:     `anon:<fingerprint>`   — body is a 16-byte blake3 hex
 *     hash of a composite fingerprint (IP + method + path + UA + headers).
 *
 * Either form MAY be further prefixed by a feature bucket via `options.keyPrefix`.
 * See `buildRateLimitKey("middleware-user" | "middleware-anon", ...)` for the
 * full contract.
 */
export const RATE_LIMIT_KEY_PREFIX_USER = "user:" as const;
export const RATE_LIMIT_KEY_PREFIX_ANON = "anon:" as const;

/**
 * Retrieve authenticated user ID (set by auth middleware)
 */
function getUserId(c: HonoContext): string | null {
  return c.get(AUTH_HEADER_NAMING.internalUsageAuthUserIdDetails) as string ||
    null;
}

export type RateLimitOptions = {
  /**
   * Max number of requests allowed
   */
  max: number;

  /**
   * Time window in milliseconds (e.g., 15 * 60 * 1000 = 15 minutes)
   */
  window: number;

  /**
   * Optional: Block duration after hitting max (default: 2x window)
   */
  blockDuration?: number;

  /**
   * Skip rate limiting (e.g., user based on a user role)
   */
  skip?: (c: HonoContext) => boolean | Promise<boolean>;

  /**
   * Enable dynamic rate limiting based on IP reputation
   */
  enableIPBasedAdjustment?: boolean;

  /**
   * Multiplier for suspicious IPs (e.g., 0.5 = half the normal limit)
   */
  suspiciousIPMultiplier?: number;

  /**
   * Optional key prefix to separate rate limit buckets by feature
   */
  keyPrefix?: string;

  /**
   * Optional custom key generator (overrides default keying)
   */
  keyGenerator?: (c: HonoContext) => string | Promise<string>;
};

// === 🖌️ COMPOSITE FINGERPRINT (Route + Method + Headers) ===
function generateFingerprint(c: HonoContext): string {
  const req = c.req;
  const headers = req.raw.headers;

  const ip = getClientIP(c) || "0.0.0.0";
  const method = req.method;
  const path = req.path;

  const userAgent = (headers.get("user-agent") || "none")
    .replace(/\/[\d.[\]_]*/g, "/?");
  const accept = sortAndNormalize(headers.get("accept") || "*/*");
  const encoding = sortAndNormalize(headers.get("accept-encoding") || "none");
  const language = (headers.get("accept-language") || "en")
    .split(",")[0]?.trim().split("-")[0] || "en";
  const secChUa = sortAndNormalize(headers.get("sec-ch-ua") || "");

  const isAutomation = userAgent.includes("Headless") ||
    userAgent.includes("WebDriver") ||
    secChUa.includes("Headless");

  const components = [
    "v2", // Fingerprint schema version
    ip,
    method,
    path,
    userAgent,
    accept,
    encoding,
    language,
    secChUa,
    isAutomation ? "auto:1" : "auto:0",
  ];

  return hash(components.join("|"));
}

function sortAndNormalize(value: string): string {
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s)
    .sort()
    .join(",");
}

type RateLimitData = {
  count: number;
  firstRequest: number;
  blockExpiry?: number;
};

export function rateLimit(options: RateLimitOptions) {
  return async (c: HonoContext, next: () => Promise<void>) => {
    // 🔽 Allow dynamic bypass (e.g., admin IPs, test mode)
    if (options.skip && (await options.skip(c))) {
      return await next();
    }

    const userId = getUserId(c);
    const fingerprint = generateFingerprint(c);
    // WIRE/CACHE CONTRACT — delegates to buildRateLimitKey in utils/auth/cache-keys.ts.
    const baseKey = options.keyGenerator
      ? await options.keyGenerator(c)
      : (userId ? buildRateLimitKey("middleware-user", userId, c.req.path) : buildRateLimitKey("middleware-anon", fingerprint));
    const cacheKey = options.keyPrefix ? `${options.keyPrefix}:${baseKey}` : baseKey;

    const now = getTimeNow();
    const windowMs = options.window;
    let maxAttempts = options.max;
    const blockDurationMs = options.blockDuration ?? windowMs * 2;

    // 🛡️ Apply IP-based rate limit adjustments using shared context
    if (options.enableIPBasedAdjustment) {
      const _clientIP = getClientIP(c);
      const userAgent = getUserAgent(c);

      // Use pre-computed IP security check from requestContextMiddleware
      const ipSecurityCheck = getIPSecurityCheck(c);

      if (ipSecurityCheck) {
        if (ipSecurityCheck.metadata?.isInfrastructure) {
          // Datacenter IPs: check for bot signals
          const isLikelyBot = !c.req.header("cookie") &&
            /bot|crawler|spider|python|curl|wget|headless/i.test(userAgent);

          if (isLikelyBot) {
            maxAttempts = Math.max(1, Math.floor(maxAttempts * 0.1)); // 90% reduction
          } else {
            maxAttempts = Math.max(1, Math.floor(maxAttempts * 0.5)); // 50% reduction
          }
        } else if (ipSecurityCheck.metadata?.isAnonymizer) {
          // Tor/VPN: reduce limits but allow legitimate users
          maxAttempts = Math.max(1, Math.floor(maxAttempts * 0.3)); // 70% reduction
        } else if (ipSecurityCheck.isSuspicious) {
          // Generic suspicious: existing behavior
          const multiplier = options.suspiciousIPMultiplier ?? 0.3;
          maxAttempts = Math.max(1, Math.floor(maxAttempts * multiplier));
        }
      }
    }

    const cache = await getCache();

    let data: RateLimitData | null = await cache.get<RateLimitData>(
      CACHE_NAMESPACES.RATE_LIMITS,
      cacheKey,
    );

    // 🕰️ Reset if outside window
    if (data && now - data.firstRequest > windowMs) {
      data = null;
    }

    // 🛑 Check if blocked
    if (data?.blockExpiry && now < data?.blockExpiry) {
      return c.json(
        {
          error: "Too many requests. You are blocked.",
          retryAfter: Math.ceil((data?.blockExpiry - now) / 1000),
        },
        429,
      );
    }

    // ➕ Increment or initialize
    if (!data) {
      data = {
        count: 1,
        firstRequest: now,
      };
    } else {
      data.count += 1;
    }

    // 🚨 Exceeded max?
    if (data.count > maxAttempts) {
      data.blockExpiry = now + blockDurationMs;

      await cache.set(CACHE_NAMESPACES.RATE_LIMITS, cacheKey, data, {
        ttl: blockDurationMs / 1000,
      });

      return c.json(
        {
          error: "Rate limit exceeded. Temporarily blocked.",
          retryAfter: blockDurationMs,
        },
        429,
      );
    }

    await cache.set(CACHE_NAMESPACES.RATE_LIMITS, cacheKey, data, {
      ttl: Math.max(60, Math.ceil(windowMs - (now - data.firstRequest))),
    });

    await next();
  };
}
