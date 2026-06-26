/**
 * @file constants/errors/auth.ts
 * @description Auth error message constants
 */
/**
 * Authentication and Authorization Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Authentication and Authorization Errors
 */
export const AUTH_ERRORS = {
  UNAUTHORIZED: {
    message: "Unauthorized",
    messageKey: "auth.not-authorized",
    statusCode: 401,
  },
  INVALID_CREDENTIALS: {
    message: "Invalid username or password",
    messageKey: "auth.invalid-credentials",
    statusCode: 401,
  },
  TOKEN_EXPIRED: {
    message: "Authentication token has expired",
    messageKey: "auth.token-expired",
    statusCode: 401,
  },
  TOKEN_INVALID: {
    message: "Invalid authentication token",
    messageKey: "auth.token-invalid",
    statusCode: 401,
  },
  INSUFFICIENT_PERMISSIONS: {
    message: "Insufficient permissions to perform this action",
    messageKey: "auth.insufficient-permissions",
    statusCode: 403,
  },
  ACCOUNT_LOCKED: {
    message: "Account is temporarily locked due to security measures",
    messageKey: "auth.account-locked",
    statusCode: 423,
  },
  ACCOUNT_LOCKED_TOO_MANY_ATTEMPTS: {
    message: "Account temporarily locked due to too many failed login attempts",
    messageKey: "auth.account-locked-too-many-attempts",
    statusCode: 423,
  },
  ACCOUNT_DISABLED: {
    message: "Account has been disabled",
    messageKey: "auth.account-disabled",
    statusCode: 403,
  },
  TWO_FACTOR_REQUIRED: {
    message: "Two-factor authentication is required",
    messageKey: "auth.two-factor-required",
    statusCode: 428,
  },
  TWO_FACTOR_INVALID: {
    message: "Invalid two-factor authentication code",
    messageKey: "auth.two-factor-invalid",
    statusCode: 401,
  },
  TWO_FACTOR_CODE_REQUIRED: {
    message: "2FA code from another device is required to delete this device",
    messageKey: "auth.2fa-code-required",
    statusCode: 403,
  },
  INVALID_2FA_CODE: {
    message: "Invalid 2FA code provided",
    messageKey: "auth.invalid-2fa-code",
    statusCode: 401,
  },
  USER_VERIFICATION_REQUIRED: {
    message: "User verification required",
    messageKey: "auth.user-verification-required",
    statusCode: 401,
  },
  SESSION_EXPIRED: {
    message: "Session has expired. Please log in again",
    messageKey: "auth.session-expired",
    statusCode: 401,
  },
  LOGIN_REQUIRED: {
    message: "Login required to access this resource",
    messageKey: "auth.login-required",
    statusCode: 401,
  },
  ENCRYPTION_FAILED: {
    message: "Cryptographic operation failed",
    messageKey: "auth.encryption-failed",
    statusCode: 500,
  },
  TOKEN_GENERATION_FAILED: {
    message: "Authentication token generation failed",
    messageKey: "auth.token-generation-failed",
    statusCode: 500,
  },
  SESSION_CREATION_FAILED: {
    message: "Session creation failed",
    messageKey: "auth.session-creation-failed",
    statusCode: 500,
  },
  TEMPORARILY_BLOCKED: {
    message: "Account temporarily blocked. Please try again later",
    messageKey: "auth.temporarily-blocked",
    statusCode: 429,
  },
  MAGIC_KEY_GENERATE_FAILED: {
    statusCode: 500,
    message: "Auth magic key link generation failed",
    messageKey: "auth.magic-key-link-failed",
  },
  MAGIC_KEY_VERIFY_FAILED: {
    statusCode: 500,
    message: "Auth magic key link verification failed",
    messageKey: "auth.magic-key-link-verification-failed",
  },
  MAGIC_LINK_KEY_FACTOR_REQUIRED: {
    statusCode: 403,
    message: "Magic link sign-in requires a passkey or recovery phrase",
    messageKey: "auth.magic-link-key-factor-required",
  },
  MAGIC_LINK_COMPLETION_UNSUPPORTED: {
    statusCode: 409,
    message: "Magic link sign-in is not yet available for this account configuration",
    messageKey: "auth.magic-link-completion-unsupported",
  },
  INVALID_RECOVERY_PHRASE: {
    message: "Invalid recovery phrase",
    messageKey: "auth.invalid-recovery-phrase",
    statusCode: 401,
  },
  RECOVERY_NOT_AVAILABLE: {
    message: "Account recovery is not available for this account",
    messageKey: "auth.recovery-not-available",
    statusCode: 400,
  },
  TOKEN_ALREADY_USED: {
    message: "This token has already been used",
    messageKey: "auth.token-already-used",
    statusCode: 401,
  },
  PASSWORD_NOT_SET: {
    message: "User does not have a password set",
    messageKey: "auth.password-not-set",
    statusCode: 400,
  },
  PASSWORD_PREVIOUSLY_USED: {
    message: "Cannot reuse a recently used password",
    messageKey: "auth.password-previously-used",
    statusCode: 400,
  },
  CREDS_INVALID: {
    message: "Invalid credentials",
    messageKey: "auth.creds-invalid",
    statusCode: 401,
  },
  PASSWORD_CHALLENGE: {
    message: "PASSWORD_CHALLENGE",
    messageKey: "PASSWORD_CHALLENGE",
    statusCode: 428,
  },
  PASSKEY_CHALLENGE: {
    message: "PASSKEY_CHALLENGE",
    messageKey: "PASSKEY_CHALLENGE",
    statusCode: 428,
  },
  TWO_FACTOR_CHALLENGE: {
    message: "2FA_CHALLENGE",
    messageKey: "2FA_CHALLENGE",
    statusCode: 428,
  },
} as const satisfies ErrorCategory;

export type AuthErrorKey = keyof typeof AUTH_ERRORS;
