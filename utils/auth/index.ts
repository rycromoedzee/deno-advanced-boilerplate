/**
 * @file utils/auth/index.ts
 * @description Barrel exports for auth utilities
 */
/**
 * Auth-specific Utilities Index
 *
 * This module exports all auth-related utilities for easy importing.
 */

export { RateLimitingService } from "./rate-limiting.ts";
export type { RateLimitConfig, RateLimitData, RateLimitResult } from "./rate-limiting.ts";
export { AUTH_RATE_LIMIT_KEY_PREFIX } from "./rate-limiting.ts";
export { AuthServiceCacheKeys, buildRateLimitKey, RATE_LIMIT_KEY_VERSION } from "./cache-keys.ts";
export type { RateLimitScheme } from "./cache-keys.ts";
export {
  canonicalizeUsername,
  isReservedUsername,
  isValidUsernameFormat,
  RESERVED_USERNAMES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_REGEX,
} from "./username.ts";
