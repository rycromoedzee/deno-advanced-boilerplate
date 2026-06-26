/**
 * @file constants/pagination.ts
 * @description Pagination configuration constants
 *
 * Provides centralized pagination defaults and limits to ensure consistency.
 */

/**
 * Pagination configuration constants
 */
export const PAGINATION_DEFAULTS = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  DEFAULT_SORT_ORDER: "desc" as const,

  MAX_LIMIT: 100,
  MIN_PAGE: 1,

  // Specialized limits
  ACCESS_LOG_DEFAULT_LIMIT: 50,
  ACCESS_LOG_MAX_LIMIT: 100,
} as const;

/**
 * Higher limit ceiling for INTERNAL / ADMIN-UI endpoints that legitimately list
 * large datasets (e.g. threat-intelligence management). Normal, user-facing API
 * endpoints MUST use `PAGINATION_DEFAULTS.MAX_LIMIT` (100). Use
 * `ADMIN_PAGINATION_MAX` only for internal tooling, and route the clamp through
 * this constant (not a bare `500`) so the admin ceiling is auditable in one place.
 */
export const ADMIN_PAGINATION_MAX = 500;

/**
 * Sort order enum
 */
export const SORT_ORDER = {
  ASC: "asc",
  DESC: "desc",
} as const;
