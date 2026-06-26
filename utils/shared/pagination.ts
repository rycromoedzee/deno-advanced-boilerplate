/**
 * @file utils/shared/pagination.ts
 * @description Shared pagination offset + metadata computation
 */

import type { IPaginationMetadata } from "@interfaces/documents.ts";

/** The query offset plus the canonical pagination metadata for one page. */
export interface PaginationCalculation {
  /** Zero-based row offset for a `LIMIT ... OFFSET ...` query. */
  offset: number;
  /** Canonical response pagination metadata. */
  pagination: IPaginationMetadata;
}

/**
 * Compute the query offset and the canonical `IPaginationMetadata` for a page.
 *
 * The caller MUST clamp `limit` to its domain ceiling BEFORE calling — clamping
 * is intentionally NOT centralised here. The 100-vs-500 cap question is tracked
 * in `plans/refactor-review-log.md` (R2-D); until it is resolved each call site
 * preserves its existing ceiling via `Math.min(limit, CAP)`.
 *
 * Replaces the `(page - 1) * limit` + hand-rolled `{totalPages, hasNext, hasPrev}`
 * block that was duplicated across the list services.
 */
export function calculatePagination(
  page: number,
  limit: number,
  total: number,
): PaginationCalculation {
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * limit;
  const totalPages = total > 0 && limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    offset,
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    },
  };
}
