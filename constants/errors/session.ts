/**
 * @file constants/errors/session.ts
 * @description Session error message constants
 */
/**
 * Session Management Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * API Key Related Errors
 */
export const API_KEY_ERRORS = {
  NOT_FOUND: {
    message: "API key not found or access denied",
    messageKey: "api-key.not-found",
    statusCode: 404,
  },
  INACTIVE: {
    message: "Cannot use inactive API key",
    messageKey: "api-key.inactive",
    statusCode: 409,
  },
  EXPIRED: {
    message: "API key has expired",
    messageKey: "api-key.expired",
    statusCode: 401,
  },
  CREATION_FAILED: {
    message: "Failed to create API key",
    messageKey: "api-key.creation-failed",
    statusCode: 500,
  },
  INVALID_PERMISSIONS: {
    message: "Invalid permissions specified for API key",
    messageKey: "api-key.invalid-permissions",
    statusCode: 400,
  },
  LIMIT_EXCEEDED: {
    message: "Maximum number of API keys reached",
    messageKey: "api-key.limit-exceeded",
    statusCode: 429,
  },
  INVALID_EXPIRATION: {
    message: "New expiration date must be in the future",
    messageKey: "api-key.invalid-expiration",
    statusCode: 400,
  },
  IP_RESTRICTION_FAILED: {
    message: "API key IP restriction validation failed",
    messageKey: "api-key.ip-restriction-failed",
    statusCode: 400,
  },
  DOMAIN_RESTRICTION_FAILED: {
    message: "API key domain restriction validation failed",
    messageKey: "api-key.domain-restriction-failed",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

/**
 * Session Management Errors
 */
export const SESSION_ERRORS = {
  CREATION_FAILED: {
    message: "Failed to create session",
    messageKey: "session.creation-failed",
    statusCode: 500,
  },
  INVALID_SESSION: {
    message: "Invalid or expired session",
    messageKey: "session.invalid",
    statusCode: 401,
  },
  SESSION_EXPIRED: {
    message: "Session has expired",
    messageKey: "session.expired",
    statusCode: 401,
  },
  CONCURRENT_LIMIT_EXCEEDED: {
    message: "Maximum concurrent sessions exceeded",
    messageKey: "session.concurrent-limit-exceeded",
    statusCode: 429,
  },
  DEVICE_NOT_RECOGNIZED: {
    message: "Device not recognized, additional verification required",
    messageKey: "session.device-not-recognized",
    statusCode: 403,
  },
} as const satisfies ErrorCategory;

export type ApiKeyErrorKey = keyof typeof API_KEY_ERRORS;
export type SessionErrorKey = keyof typeof SESSION_ERRORS;
