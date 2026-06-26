/**
 * @file utils/auth/cache-keys.ts
 * @description Auth cache key builders
 */
/**
 * Auth Cache Key Utilities
 *
 * This module provides utilities for generating consistent cache keys
 * for auth-related operations using Blake3 hashing.
 *
 * ## Rate-limit key factory
 *
 * {@link buildRateLimitKey} is the single authoritative place where all three
 * rate-limit key schemes are assembled. The three consumers delegate here so
 * that the on-disk key format is auditable in one file:
 *
 *   | scheme     | `buildRateLimitKey` call                                          | emitted key                              |
 *   | ---------- | ----------------------------------------------------------------- | ---------------------------------------- |
 *   | auth       | `buildRateLimitKey("auth", identifier)` / `(…, identifier, ip)`  | `rate-limit:<identifier>[:<ip>]`         |
 *   | middleware | `buildRateLimitKey("middleware-user", userId, path)`              | `user:<userId>:<path>`                   |
 *   | middleware | `buildRateLimitKey("middleware-anon", fingerprint)`               | `anon:<fingerprint>`                     |
 *   | session    | `buildRateLimitKey("session", limitType, key)`                    | `<LIMIT_TYPE>:<key>`                     |
 *
 * WIRE CONTRACT: changing any prefix or body shape resets in-flight counters
 * on deploy (one-time cache miss). Coordinate with the disjointness test in
 * `tests/unit/utils/auth/rate-limit-key-contracts.test.ts`.
 */

import { bytesToHex } from "@deps";
import { hashData } from "@utils/text/index.ts";

// ---------------------------------------------------------------------------
// Rate-limit key factory
// ---------------------------------------------------------------------------

/**
 * Bump this when any key format changes intentionally. Embedding the version
 * in a constant (rather than inline strings) means a future format change is a
 * one-line edit here that triggers the disjointness test and forces a conscious
 * deploy-window decision.
 *
 * Current version: 1 (initial consolidated factory — all three schemes
 * produce the same wire format as they did before consolidation, so existing
 * counters survive a rolling deploy onto this version).
 */
export const RATE_LIMIT_KEY_VERSION = 1 as const;

/**
 * The four logical rate-limit schemes that share `CACHE_NAMESPACES.RATE_LIMITS`.
 *
 * | scheme              | emitted prefix  | body                                          |
 * | ------------------- | --------------- | --------------------------------------------- |
 * | `"auth"`            | `rate-limit:`   | `<identifier>` or `<identifier>:<ipAddress>`  |
 * | `"middleware-user"` | `user:`         | `<userId>:<path>`                             |
 * | `"middleware-anon"` | `anon:`         | `<fingerprint>` (fixed-width blake3 hex)       |
 * | `"session"`         | (none)          | `<LIMIT_TYPE>:<key>`                          |
 */
export type RateLimitScheme =
  | "auth"
  | "middleware-user"
  | "middleware-anon"
  | "session";

/**
 * Build a rate-limit cache key for one of the three schemes that share the
 * `CACHE_NAMESPACES.RATE_LIMITS` namespace.
 *
 * This is the single authoritative key-building site. Each scheme's module
 * delegates here so the full wire format is visible in one place. The emitted
 * key shapes are identical to what each scheme produced independently before
 * this factory was introduced — existing in-flight counters are preserved
 * across a rolling deploy.
 *
 * ### Auth scheme (`"auth"`)
 * ```
 * buildRateLimitKey("auth", identifier)          → "rate-limit:<identifier>"
 * buildRateLimitKey("auth", identifier, ip)      → "rate-limit:<identifier>:<ip>"
 * ```
 *
 * ### Middleware authenticated scheme (`"middleware-user"`)
 * ```
 * buildRateLimitKey("middleware-user", userId, path) → "user:<userId>:<path>"
 * ```
 *
 * ### Middleware anonymous scheme (`"middleware-anon"`)
 * ```
 * buildRateLimitKey("middleware-anon", fingerprint) → "anon:<fingerprint>"
 * ```
 * `fingerprint` must already be a 16-byte blake3 hex string produced by the
 * middleware's composite-fingerprint hash.
 *
 * ### Session scheme (`"session"`)
 * ```
 * buildRateLimitKey("session", limitType, key) → "<LIMIT_TYPE>:<key>"
 * ```
 * `limitType` must be a member of `SESSION_SECURITY_CONFIG.RATE_LIMITS_TTL`
 * (e.g. `"SESSION_CREATION"`, `"API_KEY_CREATION"`).
 *
 * WIRE CONTRACT: the emitted string is persisted to cache. Changing any
 * format resets in-flight counters on deploy and MUST be coordinated with
 * `tests/unit/utils/auth/rate-limit-key-contracts.test.ts`.
 */
export function buildRateLimitKey(scheme: "auth", identifier: string, ipAddress?: string): string;
export function buildRateLimitKey(scheme: "middleware-user", userId: string, path: string): string;
export function buildRateLimitKey(scheme: "middleware-anon", fingerprint: string): string;
export function buildRateLimitKey(scheme: "session", limitType: string, key: string): string;
export function buildRateLimitKey(
  scheme: RateLimitScheme,
  first: string,
  second?: string,
): string {
  switch (scheme) {
    case "auth":
      return second !== undefined ? `rate-limit:${first}:${second}` : `rate-limit:${first}`;
    case "middleware-user":
      return `user:${first}:${second}`;
    case "middleware-anon":
      return `anon:${first}`;
    case "session":
      return `${first}:${second}`;
  }
}

// ---------------------------------------------------------------------------
// General auth cache key helpers
// ---------------------------------------------------------------------------

/**
 * Auth Service Cache Keys
 *
 * Generates deterministic, consistent cache keys for auth service operations
 * such as rate limiting, session tracking, passkey challenges, and TOTP.
 */
export class AuthServiceCacheKeys {
  /**
   * Generate a cache key from multiple components
   * @param components Array of strings to combine for the key
   * @param options Optional configuration for key generation
   * @returns A consistent cache key string
   */
  static generateKey(
    components: string[],
    options: {
      separator?: string;
      prefix?: string;
      suffix?: string;
      hashLength?: number;
    } = {},
  ): string {
    const {
      separator = ":",
      prefix = "",
      suffix = "",
      hashLength = 16,
    } = options;

    // Combine components with separator
    const combined = components.join(separator);

    // Add prefix and suffix if provided
    const fullString = prefix + combined + suffix;

    // Generate Blake3 hash
    const hash = hashData(fullString, hashLength);

    // Convert to hex string
    return bytesToHex(hash);
  }

  /**
   * Generate a cache key for authentication attempts
   * @param identifier User identifier (email, user ID, etc.)
   * @param ipAddress IP address of the request
   * @param additionalContext Optional additional context (user agent, etc.)
   * @returns A cache key for authentication attempts
   */
  static generateAuthAttemptKey(
    identifier: string,
    ipAddress: string,
    additionalContext?: string,
  ): string {
    const components = [identifier, ipAddress];

    if (additionalContext) {
      components.push(additionalContext);
    }

    return this.generateKey(components, {
      prefix: "auth-attempt:",
      hashLength: 16,
    });
  }

  /**
   * Generate a cache key for rate limiting
   * @param identifier User identifier or IP address
   * @param operation The operation being rate limited
   * @param window Optional time window identifier
   * @returns A cache key for rate limiting
   */
  static generateRateLimitKey(
    identifier: string,
    operation: string,
    window?: string,
  ): string {
    const components = [identifier, operation];

    if (window) {
      components.push(window);
    }

    return this.generateKey(components, {
      prefix: "rate-limit:",
      hashLength: 16,
    });
  }

  /**
   * Generate a cache key for session data
   * @param sessionId Session identifier
   * @param userId Optional user ID
   * @returns A cache key for session data
   */
  static generateSessionKey(
    sessionId: string,
    userId?: string,
  ): string {
    const components = userId ? [sessionId, userId] : [sessionId];

    return this.generateKey(components, {
      prefix: "session:",
      hashLength: 16,
    });
  }

  /**
   * Generate a cache key for TOTP operations
   * @param userId User ID
   * @param operation Type of TOTP operation (e.g., "recent-codes", "rate-limit")
   * @returns A cache key for TOTP operations
   */
  static generateTOTPKey(
    userId: string,
    operation: string,
  ): string {
    return this.generateKey([userId, operation], {
      prefix: "totp:",
      hashLength: 16,
    });
  }

  /**
   * Generate a cache key for progressive delay
   * @param identifier User identifier (email, user ID, etc.)
   * @param ipAddress IP address of the request
   * @returns A cache key for progressive delay tracking
   */
  static generateProgressiveDelayKey(
    identifier: string,
    ipAddress: string,
  ): string {
    return this.generateKey([identifier, ipAddress], {
      prefix: "progressive-delay:",
      hashLength: 16,
    });
  }

  /**
   * Generate a cache key for passkey challenges
   * @param attemptId Unique identifier for the authentication attempt
   * @returns A cache key for passkey challenges
   */
  static generatePasskeyChallengeKey(attemptId: string): string {
    return this.generateKey([attemptId], {
      prefix: "passkey-challenge:",
      hashLength: 16,
    });
  }

  /**
   * Generate a cache key for passkey attempt data
   * @param attemptId Unique identifier for the authentication attempt
   * @returns A cache key for passkey attempt data
   */
  static generatePasskeyAttemptKey(attemptId: string): string {
    return this.generateKey([attemptId], {
      prefix: "passkey-attempt:",
      hashLength: 16,
    });
  }

  /**
   * Generate a cache key for user-specific data
   * @param userId User ID
   * @param dataType Type of data being cached
   * @param additionalIdentifier Optional additional identifier
   * @returns A cache key for user-specific data
   */
  static generateUserKey(
    userId: string,
    dataType: string,
    additionalIdentifier?: string,
  ): string {
    const components = additionalIdentifier ? [userId, dataType, additionalIdentifier] : [userId, dataType];

    return this.generateKey(components, {
      prefix: "user:",
      hashLength: 16,
    });
  }

  /**
   * Generate a cache key for IP-based data
   * @param ipAddress IP address
   * @param dataType Type of data being cached
   * @param additionalContext Optional additional context
   * @returns A cache key for IP-based data
   */
  static generateIPKey(
    ipAddress: string,
    dataType: string,
    additionalContext?: string,
  ): string {
    const components = additionalContext ? [ipAddress, dataType, additionalContext] : [ipAddress, dataType];

    return this.generateKey(components, {
      prefix: "ip:",
      hashLength: 16,
    });
  }

  /**
   * Generate a generic cache key with custom components
   * @param namespace Namespace for the key
   * @param components Array of components to combine
   * @returns A generic cache key
   */
  static generateGenericKey(
    namespace: string,
    components: string[],
  ): string {
    return this.generateKey(components, {
      prefix: `${namespace}:`,
      hashLength: 16,
    });
  }
}
