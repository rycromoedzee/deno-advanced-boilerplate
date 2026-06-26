/**
 * @file constants/errors/common.ts
 * @description Common error message constants
 */
/**
 * Common HTTP and System Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Common HTTP Errors
 */
export const COMMON_ERRORS = {
  BAD_REQUEST: {
    message: "Bad request",
    messageKey: "common.bad-request",
    statusCode: 400,
  },
  METHOD_NOT_ALLOWED: {
    message: "Method not allowed",
    messageKey: "common.method-not-allowed",
    statusCode: 405,
  },
  NOT_FOUND: {
    message: "Resource not found",
    messageKey: "common.not-found",
    statusCode: 404,
  },
  FORBIDDEN: {
    message: "Access forbidden",
    messageKey: "common.forbidden",
    statusCode: 403,
  },
  INTERNAL_SERVER_ERROR: {
    message: "Internal server error",
    messageKey: "common.internal-server-error",
    statusCode: 500,
  },
  SERVICE_UNAVAILABLE: {
    message: "Service temporarily unavailable",
    messageKey: "common.service-unavailable",
    statusCode: 503,
  },
  INVALID_INPUT: {
    message: "Invalid input provided",
    messageKey: "common.invalid-input",
    statusCode: 400,
  },
  VALIDATION_FAILED: {
    message: "Input validation failed",
    messageKey: "common.validation-failed",
    statusCode: 400,
  },
  TIMEOUT: {
    message: "Request timeout",
    messageKey: "common.timeout",
    statusCode: 408,
  },
  TOO_LARGE: {
    message: "Request entity too large",
    messageKey: "common.too-large",
    statusCode: 413,
  },
  UNSUPPORTED_MEDIA_TYPE: {
    message: "Unsupported media type",
    messageKey: "common.unsupported-media-type",
    statusCode: 415,
  },
  ACCESS_DENIED: {
    message: "Access denied",
    messageKey: "common.access-denied",
    statusCode: 403,
  },
  UNEXPECTED_ERROR: {
    message: "Unexpected error",
    messageKey: "common.unexpected-error",
    statusCode: 500,
  },
  WEBHOOK_PROCESSING_ERROR: {
    message: "Unexpected error processing webhook event",
    messageKey: "common.webhook-processing-error",
    statusCode: 500,
  },
  NOT_IMPLEMENTED: {
    message: "Not implemented",
    messageKey: "common.not-implemented",
    statusCode: 501,
  },
} as const satisfies ErrorCategory;

/**
 * Rate Limiting Errors
 */
export const RATE_LIMIT_ERRORS = {
  EXCEEDED: {
    message: "Rate limit exceeded. Please try again later",
    messageKey: "rate-limit.exceeded",
    statusCode: 429,
  },
  TOO_MANY_REQUESTS: {
    message: "Too many requests from this IP address",
    messageKey: "rate-limit.too-many-requests",
    statusCode: 429,
  },
  API_QUOTA_EXCEEDED: {
    message: "API quota exceeded for this period",
    messageKey: "rate-limit.api-quota-exceeded",
    statusCode: 429,
  },
  VALIDATION_ATTEMPTS_EXCEEDED: {
    message: "Too many failed validation attempts. Please try again later",
    messageKey: "rate-limit.validation-attempts-exceeded",
    statusCode: 429,
  },
} as const satisfies ErrorCategory;

export type CommonErrorKey = keyof typeof COMMON_ERRORS;
export type RateLimitErrorKey = keyof typeof RATE_LIMIT_ERRORS;
