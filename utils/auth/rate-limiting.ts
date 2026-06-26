/**
 * @file utils/auth/rate-limiting.ts
 * @description Auth rate-limiting helpers
 */
/**
 * Rate Limiting Utilities
 *
 * This module provides utilities for implementing rate limiting patterns
 * across different services and use cases.
 */

import { getTimeNow } from "@utils/shared/index.ts";
import { loggerAppSections, LoggerLevels, useLogSecurityEvent } from "@logger/index.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { getThreatIntelligenceService } from "@services/threat-intelligence/index.ts";
import { THREAT_INTELLIGENCE_RISK_THRESHOLDS } from "@utils/shared/index.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { buildRateLimitKey } from "@utils/auth/cache-keys.ts";

// Get singleton instance via getter function
const threatIntelligenceService = getThreatIntelligenceService();

/**
 * Auth rate-limit key prefix — exported for the disjointness contract test.
 *
 * Keys are assembled by {@link buildRateLimitKey} in `utils/auth/cache-keys.ts`
 * (the single authoritative key-building site). This constant is kept here so
 * that `tests/unit/utils/auth/rate-limit-key-contracts.test.ts` can assert the
 * wire format without depending on internal factory state.
 *
 * Shape: `rate-limit:<identifier>` | `rate-limit:<identifier>:<ipAddress>`
 * See `buildRateLimitKey("auth", ...)` for the full contract.
 */
export const AUTH_RATE_LIMIT_KEY_PREFIX = "rate-limit:" as const;

/**
 * Rate limiting configuration interface
 */
export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  blockDurationMs?: number;
  enableIPBasedAdjustment?: boolean;
  exponentialBase?: number;
  maxDelayMs?: number;
}

/**
 * Rate limit result interface
 */
export interface RateLimitResult {
  shouldBlock: boolean;
  shouldDelay: boolean;
  delayMs: number;
  nextAllowedAt: number;
  attemptCount: number;
  isBlocked: boolean;
  blockExpiresAt?: number;
  remainingAttempts?: number;
}

/**
 * Rate limiting data interface
 */
export interface RateLimitData {
  count: number;
  windowStart: number;
  lastAttemptAt: number;
  isBlocked?: boolean;
  blockExpiresAt?: number;
  riskScore?: number;
}

/**
 * Rate Limiting Service
 *
 * Provides methods for implementing rate limiting with optional IP-based adjustments
 */
export class RateLimitingService {
  /**
   * Check rate limit for a given identifier
   * @param identifier Unique identifier (user ID, IP, etc.)
   * @param config Rate limiting configuration
   * @param ipAddress Optional IP address for risk-based adjustments
   * @param userAgent Optional user agent for risk assessment
   * @returns Rate limit result
   */
  static async checkRateLimit(
    identifier: string,
    config: RateLimitConfig,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<RateLimitResult> {
    const cache = await getCache();
    const now = getTimeNow();

    // Generate cache key
    const cacheKey = this.generateCacheKey(identifier, ipAddress);

    // Get existing rate limit data
    let rateLimitData = await cache.get<RateLimitData>(
      CACHE_NAMESPACES.RATE_LIMITS,
      cacheKey,
    );

    // Initialize if not exists
    if (!rateLimitData) {
      rateLimitData = {
        count: 0,
        windowStart: now,
        lastAttemptAt: now,
      };
    }

    // Check if window has expired
    if (now - rateLimitData.windowStart > config.windowMs / 1000) {
      rateLimitData.count = 0;
      rateLimitData.windowStart = now;
    }

    // Check if currently blocked
    if (
      rateLimitData.isBlocked &&
      rateLimitData.blockExpiresAt &&
      now < rateLimitData.blockExpiresAt
    ) {
      return {
        shouldBlock: true,
        shouldDelay: true,
        delayMs: (rateLimitData.blockExpiresAt - now) * 1000,
        nextAllowedAt: rateLimitData.blockExpiresAt,
        attemptCount: rateLimitData.count,
        isBlocked: true,
        blockExpiresAt: rateLimitData.blockExpiresAt,
      };
    }

    // Check if rate limit exceeded
    if (rateLimitData.count >= config.maxAttempts) {
      const blockDuration = config.blockDurationMs || config.windowMs;
      const blockExpiresAt = now + (blockDuration / 1000);

      // Update data with block
      rateLimitData.isBlocked = true;
      rateLimitData.blockExpiresAt = blockExpiresAt;

      // Store updated data
      await cache.set(
        CACHE_NAMESPACES.RATE_LIMITS,
        cacheKey,
        rateLimitData,
        { ttl: blockDuration / 1000 },
      );

      // Log security event
      await this.logSecurityEvent(
        "Rate limit exceeded",
        "high",
        {
          identifier,
          ipAddress: ipAddress ? IPLookupUtils.anonymizeIP(ipAddress) : undefined,
          attemptCount: rateLimitData.count,
          maxAttempts: config.maxAttempts,
          windowMs: config.windowMs,
          blockDuration,
        },
      );

      return {
        shouldBlock: true,
        shouldDelay: true,
        delayMs: blockDuration,
        nextAllowedAt: blockExpiresAt,
        attemptCount: rateLimitData.count,
        isBlocked: true,
        blockExpiresAt,
      };
    }

    // Calculate delay if needed
    let delayMs = 0;
    let shouldDelay = false;

    if (config.exponentialBase && rateLimitData.count > 0) {
      const baseDelay = 1000; // 1 second base delay
      delayMs = baseDelay * Math.pow(config.exponentialBase, rateLimitData.count - 1);

      // Apply IP-based risk adjustment if enabled
      if (config.enableIPBasedAdjustment && ipAddress) {
        try {
          const ipSecurityCheck = await threatIntelligenceService.checkIP(
            ipAddress,
            {
              path: "/auth",
              method: "POST",
              userAgent: userAgent || "",
            },
          );

          const riskScore = ipSecurityCheck.riskScore;

          if (riskScore >= THREAT_INTELLIGENCE_RISK_THRESHOLDS.BLOCK) {
            delayMs *= 3; // High risk: triple delay
          } else if (riskScore >= THREAT_INTELLIGENCE_RISK_THRESHOLDS.CHALLENGE) {
            delayMs *= 2; // Medium-high risk: double delay
          } else if (riskScore >= THREAT_INTELLIGENCE_RISK_THRESHOLDS.MONITOR) {
            delayMs *= 1.5; // Medium risk: 1.5x delay
          }
        } catch (error) {
          console.warn("Failed to get IP security assessment:", error);
        }
      }

      // Cap at maximum delay
      if (config.maxDelayMs) {
        delayMs = Math.min(delayMs, config.maxDelayMs);
      }

      shouldDelay = delayMs > 0;
    }

    const remainingAttempts = config.maxAttempts - rateLimitData.count - 1;

    return {
      shouldBlock: false,
      shouldDelay,
      delayMs,
      nextAllowedAt: now + (delayMs / 1000),
      attemptCount: rateLimitData.count,
      isBlocked: false,
      remainingAttempts,
    };
  }

  /**
   * Record an attempt for rate limiting
   * @param identifier Unique identifier (user ID, IP, etc.)
   * @param config Rate limiting configuration
   * @param ipAddress Optional IP address for risk-based adjustments
   * @param userAgent Optional user agent for risk assessment
   * @returns Rate limit result after recording the attempt
   */
  static async recordAttempt(
    identifier: string,
    config: RateLimitConfig,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<RateLimitResult> {
    const cache = await getCache();
    const now = getTimeNow();

    // Generate cache key
    const cacheKey = this.generateCacheKey(identifier, ipAddress);

    // Get existing rate limit data
    let rateLimitData = await cache.get<RateLimitData>(
      CACHE_NAMESPACES.RATE_LIMITS,
      cacheKey,
    );

    // Initialize if not exists
    if (!rateLimitData) {
      rateLimitData = {
        count: 0,
        windowStart: now,
        lastAttemptAt: now,
      };
    }

    // Check if window has expired
    if (now - rateLimitData.windowStart > config.windowMs / 1000) {
      rateLimitData.count = 0;
      rateLimitData.windowStart = now;
    }

    // Increment count
    rateLimitData.count += 1;
    rateLimitData.lastAttemptAt = now;

    // Get IP risk score if needed
    if (config.enableIPBasedAdjustment && ipAddress) {
      try {
        const ipSecurityCheck = await threatIntelligenceService.checkIP(
          ipAddress,
          {
            path: "/auth",
            method: "POST",
            userAgent: userAgent || "",
          },
        );
        rateLimitData.riskScore = ipSecurityCheck.riskScore;
      } catch (error) {
        console.warn("Failed to get IP security assessment:", error);
      }
    }

    // Check if should be blocked
    if (rateLimitData.count >= config.maxAttempts) {
      const blockDuration = config.blockDurationMs || config.windowMs;
      const blockExpiresAt = now + (blockDuration / 1000);

      rateLimitData.isBlocked = true;
      rateLimitData.blockExpiresAt = blockExpiresAt;

      // Store updated data
      await cache.set(
        CACHE_NAMESPACES.RATE_LIMITS,
        cacheKey,
        rateLimitData,
        { ttl: blockDuration / 1000 },
      );

      // Log security event
      await this.logSecurityEvent(
        "Rate limit exceeded",
        "high",
        {
          identifier,
          ipAddress: ipAddress ? IPLookupUtils.anonymizeIP(ipAddress) : undefined,
          attemptCount: rateLimitData.count,
          maxAttempts: config.maxAttempts,
          windowMs: config.windowMs,
          blockDuration,
        },
      );

      return {
        shouldBlock: true,
        shouldDelay: true,
        delayMs: blockDuration,
        nextAllowedAt: blockExpiresAt,
        attemptCount: rateLimitData.count,
        isBlocked: true,
        blockExpiresAt,
      };
    }

    // Calculate delay
    let delayMs = 0;
    let shouldDelay = false;

    if (config.exponentialBase && rateLimitData.count > 0) {
      const baseDelay = 1000; // 1 second base delay
      delayMs = baseDelay * Math.pow(config.exponentialBase, rateLimitData.count - 1);

      // Apply risk-based multiplier
      if (rateLimitData.riskScore) {
        if (rateLimitData.riskScore >= THREAT_INTELLIGENCE_RISK_THRESHOLDS.BLOCK) {
          delayMs *= 3; // High risk: triple delay
        } else if (rateLimitData.riskScore >= THREAT_INTELLIGENCE_RISK_THRESHOLDS.CHALLENGE) {
          delayMs *= 2; // Medium-high risk: double delay
        } else if (rateLimitData.riskScore >= THREAT_INTELLIGENCE_RISK_THRESHOLDS.MONITOR) {
          delayMs *= 1.5; // Medium risk: 1.5x delay
        }
      }

      // Cap at maximum delay
      if (config.maxDelayMs) {
        delayMs = Math.min(delayMs, config.maxDelayMs);
      }

      shouldDelay = delayMs > 0;
    }

    // Store updated data
    await cache.set(
      CACHE_NAMESPACES.RATE_LIMITS,
      cacheKey,
      rateLimitData,
      { ttl: config.windowMs / 1000 },
    );

    const remainingAttempts = config.maxAttempts - rateLimitData.count;

    // Log if getting close to limit
    if (remainingAttempts <= 2) {
      await this.logSecurityEvent(
        "Rate limit warning",
        "medium",
        {
          identifier,
          ipAddress: ipAddress ? IPLookupUtils.anonymizeIP(ipAddress) : undefined,
          attemptCount: rateLimitData.count,
          maxAttempts: config.maxAttempts,
          remainingAttempts,
        },
      );
    }

    return {
      shouldBlock: false,
      shouldDelay,
      delayMs,
      nextAllowedAt: now + (delayMs / 1000),
      attemptCount: rateLimitData.count,
      isBlocked: false,
      remainingAttempts,
    };
  }

  /**
   * Reset rate limit for a given identifier
   * @param identifier Unique identifier (user ID, IP, etc.)
   * @param ipAddress Optional IP address
   * @returns True if reset was successful
   */
  static async resetRateLimit(
    identifier: string,
    ipAddress?: string,
  ): Promise<boolean> {
    try {
      const cache = await getCache();
      const cacheKey = this.generateCacheKey(identifier, ipAddress);

      await cache.delete(CACHE_NAMESPACES.RATE_LIMITS, cacheKey);

      return true;
    } catch (error) {
      console.error("Failed to reset rate limit:", error);
      return false;
    }
  }

  /**
   * Get current rate limit status for a given identifier
   * @param identifier Unique identifier (user ID, IP, etc.)
   * @param ipAddress Optional IP address
   * @returns Current rate limit data or null if not found
   */
  static async getRateLimitStatus(
    identifier: string,
    ipAddress?: string,
  ): Promise<RateLimitData | null> {
    try {
      const cache = await getCache();
      const cacheKey = this.generateCacheKey(identifier, ipAddress);

      return await cache.get<RateLimitData>(
        CACHE_NAMESPACES.RATE_LIMITS,
        cacheKey,
      );
    } catch (error) {
      console.error("Failed to get rate limit status:", error);
      return null;
    }
  }

  /**
   * Generate a consistent cache key for rate limiting.
   *
   * Delegates to {@link buildRateLimitKey} in `utils/auth/cache-keys.ts` —
   * the single authoritative key-building site for all three rate-limit schemes.
   *
   * Shape:  `rate-limit:<identifier>`  |  `rate-limit:<identifier>:<ipAddress>`
   *
   * @param identifier Unique identifier
   * @param ipAddress Optional IP address
   * @returns Cache key string
   */
  private static generateCacheKey(
    identifier: string,
    ipAddress?: string,
  ): string {
    return buildRateLimitKey("auth", identifier, ipAddress);
  }

  /**
   * Log security events for rate limiting
   * @param message Event message
   * @param severity Event severity
   * @param details Event details
   */
  private static async logSecurityEvent(
    message: string,
    severity: "low" | "medium" | "high" | "critical",
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await useLogSecurityEvent(
        LoggerLevels.warn,
        message,
        severity,
        loggerAppSections.AUTH,
        `Security.Rate_Limiting`,
        {
          ...details,
          timestamp: new Date().toISOString(),
        },
      );
    } catch (error) {
      console.error("Failed to log security event:", error);
    }
  }
}
