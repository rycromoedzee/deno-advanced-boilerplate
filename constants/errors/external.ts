/**
 * @file constants/errors/external.ts
 * @description External error message constants
 */
/**
 * External Service Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * External Service Integration Errors
 */
export const EXTERNAL_SERVICE_ERRORS = {
  SERVICE_UNAVAILABLE: {
    message: "External service is currently unavailable",
    messageKey: "external.service-unavailable",
    statusCode: 503,
  },
  API_RATE_LIMIT_EXCEEDED: {
    message: "External API rate limit exceeded",
    messageKey: "external.api-rate-limit-exceeded",
    statusCode: 429,
  },
  AUTHENTICATION_FAILED: {
    message: "External service authentication failed",
    messageKey: "external.authentication-failed",
    statusCode: 401,
  },
  INVALID_API_KEY: {
    message: "Invalid external service API key",
    messageKey: "external.invalid-api-key",
    statusCode: 401,
  },
  QUOTA_EXCEEDED: {
    message: "External service quota exceeded",
    messageKey: "external.quota-exceeded",
    statusCode: 429,
  },
  TIMEOUT: {
    message: "External service request timed out",
    messageKey: "external.timeout",
    statusCode: 504,
  },
  INVALID_RESPONSE: {
    message: "Invalid response from external service",
    messageKey: "external.invalid-response",
    statusCode: 502,
  },
  CONFIGURATION_ERROR: {
    message: "External service configuration error",
    messageKey: "external.configuration-error",
    statusCode: 500,
  },
  WEBHOOK_VERIFICATION_FAILED: {
    message: "Webhook signature verification failed",
    messageKey: "external.webhook-verification-failed",
    statusCode: 401,
  },
} as const satisfies ErrorCategory;

/**
 * Email Service Errors
 */
export const EMAIL_ERRORS = {
  SEND_FAILED: {
    message: "Failed to send email",
    messageKey: "email.send-failed",
    statusCode: 500,
  },
  INVALID_RECIPIENT: {
    message: "Invalid email recipient",
    messageKey: "email.invalid-recipient",
    statusCode: 400,
  },
  TEMPLATE_NOT_FOUND: {
    message: "Email template not found",
    messageKey: "email.template-not-found",
    statusCode: 404,
  },
  TEMPLATE_RENDER_FAILED: {
    message: "Email template rendering failed",
    messageKey: "email.template-render-failed",
    statusCode: 500,
  },
  ATTACHMENT_TOO_LARGE: {
    message: "Email attachment too large",
    messageKey: "email.attachment-too-large",
    statusCode: 413,
  },
  DELIVERY_FAILED: {
    message: "Email delivery failed",
    messageKey: "email.delivery-failed",
    statusCode: 500,
  },
  BOUNCED: {
    message: "Email bounced",
    messageKey: "email.bounced",
    statusCode: 422,
  },
  SPAM_DETECTED: {
    message: "Email marked as spam",
    messageKey: "email.spam-detected",
    statusCode: 422,
  },
} as const satisfies ErrorCategory;

export type ExternalServiceErrorKey = keyof typeof EXTERNAL_SERVICE_ERRORS;
export type EmailErrorKey = keyof typeof EMAIL_ERRORS;
