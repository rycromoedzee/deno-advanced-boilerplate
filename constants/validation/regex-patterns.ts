/**
 * @file constants/validation/regex-patterns.ts
 * @description Regex patterns used in validation schemas
 *
 * Provides centralized regex patterns to ensure consistency across the application.
 */

/**
 * Regex patterns used in validation schemas
 */
export const REGEX_PATTERNS = {
  HEX_COLOR: /^#[0-9A-Fa-f]{6}$/,
  MIME_TYPE: /^[a-z]+\/[a-z0-9\-\+\.]+$/i,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const;

/**
 * Helper messages for regex validation errors
 */
export const REGEX_ERROR_MESSAGES = {
  HEX_COLOR: "Invalid hex color format (expected #RRGGBB)",
  MIME_TYPE: "Invalid MIME type format",
  UUID: "Invalid UUID format",
} as const;
