/**
 * @file constants/validation/string-lengths.ts
 * @description Standard string length constraints used across validation schemas
 *
 * Provides centralized string length limits to ensure consistency across the application.
 * These constraints are used in Zod validation schemas throughout the codebase.
 */

/**
 * Standard string length constraints used across validation schemas
 */
export const STRING_LENGTH_CONSTRAINTS = {
  // Names
  NAME_MIN: 1,
  NAME_MAX: 255,

  // Descriptions
  DESCRIPTION_SHORT_MAX: 500,
  DESCRIPTION_STANDARD_MAX: 1000,
  DESCRIPTION_LONG_MAX: 2000,

  // Content
  COMMENT_CONTENT_MIN: 1,
  COMMENT_CONTENT_MAX: 10000,

  // Search
  SEARCH_QUERY_MAX: 255,

  // UI Elements
  ICON_IDENTIFIER_MAX: 50,
  TAG_NAME_MIN: 1,
  TAG_NAME_MAX: 50,

  // API Keys
  API_KEY_NAME_MIN: 1,
  API_KEY_NAME_MAX: 100,
} as const;
