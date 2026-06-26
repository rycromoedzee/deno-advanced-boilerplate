/**
 * @file utils/auth/username.ts
 * @description Username validation/normalization helpers
 */
export const RESERVED_USERNAMES = [
  "admin",
  "root",
  "system",
  "support",
  "api",
  "null",
  "undefined",
];

/**
 * Canonical username format rules. Shared by every layer that validates a
 * username so the rule lives in exactly one place:
 * - route Zod schemas (`USERNAME_REGEX`) for fail-fast 400s, and
 * - the service layer (`isValidUsernameFormat`) for defense-in-depth.
 *
 * A username is a login identifier and must NOT contain an `@` (that would
 * make it ambiguous with an email), spaces, or other punctuation.
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export function canonicalizeUsername(username: string): string {
  return username.normalize("NFC").toLowerCase();
}

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.includes(canonicalizeUsername(username));
}

/**
 * Validates the *format* of a username (length + allowed characters) against
 * the canonical rules above. This is a pure check — uniqueness and the
 * reserved-list are validated separately (DB lookup / `isReservedUsername`).
 */
export function isValidUsernameFormat(username: string): boolean {
  const canonical = canonicalizeUsername(username);
  return (
    canonical.length >= USERNAME_MIN_LENGTH &&
    canonical.length <= USERNAME_MAX_LENGTH &&
    USERNAME_REGEX.test(canonical)
  );
}
