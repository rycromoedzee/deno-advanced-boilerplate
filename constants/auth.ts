/**
 * @file constants/auth.ts
 * @description Authentication and password constraints
 *
 * Provides centralized password requirements for different contexts.
 */

/**
 * Authentication and password constraints
 */
export const PASSWORD_CONSTRAINTS = {
  // User account passwords (strong requirements)
  USER_MIN_LENGTH: 10,
  USER_MAX_LENGTH: 128,
  USER_REQUIRES_UPPERCASE: true,
  USER_REQUIRES_LOWERCASE: true,
  USER_REQUIRES_NUMBER: true,
  USER_REQUIRES_SPECIAL: true,

  // Public share passwords (lighter requirements)
  SHARE_MIN_LENGTH: 8,
  SHARE_MAX_LENGTH: 128,
  SHARE_REQUIRES_COMPLEXITY: false,
} as const;
