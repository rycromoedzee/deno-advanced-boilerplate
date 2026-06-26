/**
 * @file services/session/session-rate-limit.service.ts
 * @description Service responsible for managing rate limiting for session operations
 */
import { CACHE_NAMESPACES, getCache, GlobalCacheService } from "@services/cache/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { envConfig } from "@config/env.ts";
import { SESSION_SECURITY_CONFIG } from "./session.constants.ts";
import { traced } from "@services/tracing/index.ts";
import { buildRateLimitKey } from "@utils/auth/cache-keys.ts";

/**
 * Build a session rate-limit cache key.
 *
 * Delegates to {@link buildRateLimitKey} in `utils/auth/cache-keys.ts` —
 * the single authoritative key-building site for all three rate-limit schemes.
 *
 * Shape:  `<LIMIT_TYPE>:<key>`  e.g. `SESSION_CREATION:1.2.3.4`
 *
 * `LIMIT_TYPE` is a member of {@link SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL}.
 * Because these names are upper-case constants and the other schemes use
 * lower-case prefixes (`rate-limit:`, `user:`, `anon:`), keys never collide.
 *
 * WIRE CONTRACT: the emitted string is persisted to cache. Changing this shape
 * resets all in-flight session rate-limit counters on deploy and MUST be
 * coordinated with `tests/unit/utils/auth/rate-limit-key-contracts.test.ts`.
 *
 * @param limitType Member of {@link SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL}.
 * @param key       Identity/IP the limit is tracked against (plain).
 * @returns A key unique within the `rate_limits` namespace.
 */
export function buildSessionRateLimitKey(
  limitType: keyof typeof SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL,
  key: string,
): string {
  return buildRateLimitKey("session", limitType, key);
}

/**
 * Service responsible for managing rate limiting for session operations
 */
export class SessionRateLimiter {
  private cache: GlobalCacheService | null = null;
  private cacheInitializationPromise: Promise<GlobalCacheService> | null = null;

  /**
   * Ensures cache is initialized before use - thread-safe lazy initialization
   * Uses a promise to prevent race conditions when multiple calls happen simultaneously
   * @private
   */
  // deno-lint-ignore require-await
  private async ensureCache(): Promise<GlobalCacheService> {
    // Return existing cache if already initialized
    if (this.cache) {
      return this.cache;
    }

    // If initialization is in progress, wait for it
    if (this.cacheInitializationPromise) {
      return this.cacheInitializationPromise;
    }

    // Start initialization and store the promise
    this.cacheInitializationPromise = getCache().then((cache) => {
      this.cache = cache;
      return cache;
    }).catch((error) => {
      // Reset promise on failure so next call can retry
      this.cacheInitializationPromise = null;
      throw error;
    });

    return this.cacheInitializationPromise;
  }

  /**
   * Check if an operation is rate limited
   * @param key - Unique identifier for the rate limit (e.g., IP address, user ID)
   * @param limitType - Type of rate limit to check
   * @returns Promise<{ allowed: boolean; remainingAttempts: number; resetTime: number }>
   */
  async checkRateLimit(
    key: string,
    limitType: keyof typeof SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL,
  ): Promise<
    { allowed: boolean; remainingAttempts: number; resetTime: number }
  > {
    return await traced("SessionRateLimiter.checkRateLimit", "service", async (span) => {
      span.attributes["limit_type"] = limitType;
      span.attributes["key_prefix"] = key.substring(0, 8) + "...";

      try {
        if (!envConfig.rateLimit.enabled) {
          span.attributes["rate_limiting_disabled"] = true;
          return {
            allowed: true,
            remainingAttempts: SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL[limitType].MAX_ATTEMPTS,
            resetTime: getTimeNow() +
              (SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL[limitType].WINDOW_SECONDS * 1000),
          };
        }

        const cache = await this.ensureCache();

        const config = SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL[limitType];
        // WIRE/CACHE CONTRACT — see buildSessionRateLimitKey above.
        // NOTE: rateLimitKey and blockKey are intentionally the same string so
        // that a block marker overwrites/extends the attempt counter's slot.
        const rateLimitKey = buildSessionRateLimitKey(limitType, key);
        const blockKey = buildSessionRateLimitKey(limitType, key);
        const now = getTimeNow();

        // Check if currently blocked
        const blockInfo = await cache.get(
          CACHE_NAMESPACES.RATE_LIMITS,
          blockKey,
        ) as { blockedUntil: number } | null;

        if (blockInfo && blockInfo.blockedUntil > now) {
          span.attributes["blocked"] = true;
          span.attributes["blocked_until"] = blockInfo.blockedUntil;

          await this.logSecurityEvent("RATE_LIMIT_BLOCKED", {
            key,
            limitType,
            blockedUntil: blockInfo.blockedUntil,
          });

          return {
            allowed: false,
            remainingAttempts: 0,
            resetTime: blockInfo.blockedUntil,
          };
        }

        // Get current attempt count
        const attemptData = await cache.get(
          CACHE_NAMESPACES.RATE_LIMITS,
          rateLimitKey,
        ) as { count: number; windowStart: number } | null;

        const windowStart = attemptData?.windowStart || now;
        const currentCount = attemptData?.count || 0;

        // Check if we're in a new window
        if (now - windowStart > (config.WINDOW_SECONDS * 1000)) {
          // Reset counter for new window
          await cache.set(
            CACHE_NAMESPACES.RATE_LIMITS,
            rateLimitKey,
            { count: 1, windowStart: now },
            { ttl: config.WINDOW_SECONDS },
          );

          span.attributes["window_reset"] = true;
          span.attributes["remaining_attempts"] = config.MAX_ATTEMPTS - 1;

          return {
            allowed: true,
            remainingAttempts: config.MAX_ATTEMPTS - 1,
            resetTime: now + (config.WINDOW_SECONDS * 1000),
          };
        }

        // Check if limit exceeded
        if (currentCount >= config.MAX_ATTEMPTS) {
          // Block the key
          await cache.set(
            CACHE_NAMESPACES.RATE_LIMITS,
            blockKey,
            { blockedUntil: now + (config.BLOCK_DURATION_SECONDS * 1000) },
            { ttl: config.BLOCK_DURATION_SECONDS },
          );

          span.attributes["limit_exceeded"] = true;
          span.attributes["attempt_count"] = currentCount;

          await this.logSecurityEvent("RATE_LIMIT_EXCEEDED", {
            key,
            limitType,
            attemptCount: currentCount,
            maxAttempts: config.MAX_ATTEMPTS,
          });

          return {
            allowed: false,
            remainingAttempts: 0,
            resetTime: now + (config.BLOCK_DURATION_SECONDS * 1000),
          };
        }

        // Increment counter
        await cache.set(
          CACHE_NAMESPACES.RATE_LIMITS,
          rateLimitKey,
          { count: currentCount + 1, windowStart },
          { ttl: config.WINDOW_SECONDS },
        );

        span.attributes["allowed"] = true;
        span.attributes["remaining_attempts"] = config.MAX_ATTEMPTS - (currentCount + 1);

        return {
          allowed: true,
          remainingAttempts: config.MAX_ATTEMPTS - (currentCount + 1),
          resetTime: windowStart + (config.WINDOW_SECONDS * 1000),
        };
      } catch (error) {
        span.attributes["error"] = error instanceof Error ? error.message : "Unknown error";

        // Log the error
        await this.logSecurityEvent("RATE_LIMIT_ERROR", {
          key,
          limitType,
          error: error instanceof Error ? error.message : "Unknown error",
        });

        // Option for fail-closed behavior (more secure, less available)
        if (envConfig.rateLimit?.failClosed) {
          span.attributes["fail_closed"] = true;
          return { allowed: false, remainingAttempts: 0, resetTime: getTimeNow() + 300 };
        }

        // Fail-open behavior (current default - more available, less secure)
        return {
          allowed: true,
          remainingAttempts: SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL[limitType].MAX_ATTEMPTS,
          resetTime: getTimeNow() +
            (SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL[limitType].WINDOW_SECONDS * 1000),
        };
      }
    });
  }

  /**
   * Log security events with proper formatting
   * @private
   */
  private async logSecurityEvent(
    eventType: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await useLogger(LoggerLevels.warn, {
        message: `Security event: ${eventType}`,
        section: loggerAppSections.AUTH,
        messageKey: `SECURITY_${eventType}`,
        details: {
          eventType,
          timestamp: new Date().toISOString(),
          ...details,
        },
        meta: {
          component: "SessionRateLimiter",
          severity: "medium",
        },
      });
    } catch (error) {
      // Fallback to structured console output if logger fails
      // Using structured format for log aggregation compatibility
      console.error(JSON.stringify({
        level: "error",
        message: `Failed to log security event: ${eventType}`,
        component: "SessionRateLimiter",
        section: loggerAppSections.AUTH,
        details: {
          originalEventType: eventType,
          originalDetails: details,
        },
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      }));
    }
  }
}
