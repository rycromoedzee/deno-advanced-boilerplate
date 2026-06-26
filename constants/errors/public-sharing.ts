/**
 * @file constants/errors/public-sharing.ts
 * @description Public Sharing error message constants
 */
/**
 * Public Sharing Error Constants
 * @description Error definitions for public sharing service operations
 * @note Errors are intentionally generic to prevent information disclosure
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Public sharing-specific errors
 * Note: Use NOT_FOUND for both missing and access-denied cases to prevent enumeration
 */
export const PUBLIC_SHARE_ERRORS = {
  /**
   * Generic not found error - use for:
   * - Share not found
   * - Share expired
   * - Access denied (to prevent enumeration)
   */
  NOT_FOUND: {
    message: "Public share not found or expired",
    messageKey: "public-share.not-found",
    statusCode: 404,
  },
  PASSWORD_REQUIRED: {
    message: "Password required for this public share",
    messageKey: "public-share.password-required",
    statusCode: 401,
  },
  INVALID_PASSWORD: {
    message: "Invalid password for public share",
    messageKey: "public-share.invalid-password",
    statusCode: 401,
  },
  /**
   * Invalid share key - the shareKey provided via header doesn't match
   * This could indicate a malformed or tampered link
   */
  INVALID_SHARE_KEY: {
    message: "Invalid or corrupted share link",
    messageKey: "public-share.invalid-share-key",
    statusCode: 400,
  },
  /**
   * Share key missing from request
   */
  SHARE_KEY_REQUIRED: {
    message: "Share key is required",
    messageKey: "public-share.share-key-required",
    statusCode: 400,
  },
  CREATE_FAILED: {
    message: "Failed to create public share",
    messageKey: "public-share.create-failed",
    statusCode: 500,
  },
  REVOKE_FAILED: {
    message: "Failed to revoke public share",
    messageKey: "public-share.revoke-failed",
    statusCode: 500,
  },
  GET_FAILED: {
    message: "Failed to get public share",
    messageKey: "public-share.get-failed",
    statusCode: 500,
  },
  VERIFY_PASSWORD_FAILED: {
    message: "Failed to verify public share password",
    messageKey: "public-share.verify-password-failed",
    statusCode: 500,
  },
  GET_MASTER_KEY_FAILED: {
    message: "Failed to get data master key for public share",
    messageKey: "public-share.get-master-key-failed",
    statusCode: 500,
  },
} as const satisfies ErrorCategory;

export type PublicShareErrorKey = keyof typeof PUBLIC_SHARE_ERRORS;
