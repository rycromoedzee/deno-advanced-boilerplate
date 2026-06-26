/**
 * @file constants/errors/user.ts
 * @description User error message constants
 */
/**
 * User Management Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * User Management Errors
 */
export const USER_ERRORS = {
  NOT_FOUND: {
    message: "User not found",
    messageKey: "user.not-found",
    statusCode: 404,
  },
  ALREADY_EXISTS: {
    message: "User already exists",
    messageKey: "user.already-exists",
    statusCode: 409,
  },
  CREATION_FAILED: {
    message: "Failed to create user",
    messageKey: "user.creation-failed",
    statusCode: 500,
  },
  UPDATE_FAILED: {
    message: "Failed to update user",
    messageKey: "user.update-failed",
    statusCode: 500,
  },
  DELETION_FAILED: {
    message: "Failed to delete user",
    messageKey: "user.deletion-failed",
    statusCode: 500,
  },
  INVALID_EMAIL: {
    message: "Invalid email address format",
    messageKey: "user.invalid-email",
    statusCode: 400,
  },
  EMAIL_ALREADY_EXISTS: {
    message: "Email address already in use",
    messageKey: "user.email-already-exists",
    statusCode: 409,
  },
  WEAK_PASSWORD: {
    message: "Password does not meet security requirements",
    messageKey: "user.weak-password",
    statusCode: 400,
  },
  LIST_FAILED: {
    message: "Failed to list users",
    messageKey: "user.list-failed",
    statusCode: 500,
  },
  GET_FAILED: {
    message: "Failed to get user",
    messageKey: "user.get-failed",
    statusCode: 500,
  },
  PERMISSION_DENIED: {
    message: "Permission denied",
    messageKey: "user.permission-denied",
    statusCode: 403,
  },
  INVALID_PERMISSION: {
    message: "Invalid permission",
    messageKey: "user.invalid-permission",
    statusCode: 400,
  },
  ADMIN_ONLY_OPERATION: {
    message: "This operation requires admin privileges",
    messageKey: "user.admin-only-operation",
    statusCode: 403,
  },
  IDENTITY_NOT_FOUND: {
    message: "Identity not found",
    messageKey: "user.identity-not-found",
    statusCode: 404,
  },
  USERNAME_ALREADY_EXISTS: {
    message: "Username already in use",
    messageKey: "user.username-already-exists",
    statusCode: 409,
  },
  USERNAME_INVALID_FORMAT: {
    message: "Username may only contain letters, numbers, underscores, and hyphens",
    messageKey: "user.username-invalid-format",
    statusCode: 400,
  },
  RESERVED_USERNAME: {
    message: "Username is reserved",
    messageKey: "user.reserved-username",
    statusCode: 400,
  },
  CANNOT_CHANGE_USERNAME_WITH_PASSKEY: {
    message: "Username cannot be changed while passkeys are registered",
    messageKey: "user.cannot-change-username-with-passkey",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

/**
 * Recovery Phrase Errors
 */
export const RECOVERY_PHRASE_ERRORS = {
  INVALID: {
    message: "Invalid recovery phrase",
    messageKey: "recovery-phrase.invalid",
    statusCode: 400,
  },
  GENERATION_FAILED: {
    message: "Failed to generate valid recovery phrase",
    messageKey: "recovery-phrase.generation-failed",
    statusCode: 500,
  },
  HASH_FAILED: {
    message: "Failed to create recovery phrase hash",
    messageKey: "recovery-phrase.hash-failed",
    statusCode: 500,
  },
  CREATE_FAILED: {
    message: "Failed to generate and store recovery phrase",
    messageKey: "recovery-phrase.create-failed",
    statusCode: 500,
  },
  STORE_FAILED: {
    message: "Failed to store recovery phrase verification data",
    messageKey: "recovery-phrase.store-failed",
    statusCode: 500,
  },
  RESET_FAILED: {
    message: "Failed to reset recovery phrase",
    messageKey: "recovery-phrase.reset-failed",
    statusCode: 500,
  },
  REMOVE_FAILED: {
    message: "Failed to remove recovery phrase",
    messageKey: "recovery-phrase.remove-failed",
    statusCode: 500,
  },
} as const satisfies ErrorCategory;

export const USER_API_KEY_ERRORS = {
  CREATION_FAILED: {
    message: "Failed to create API key",
    messageKey: "user-api-key.creation-failed",
    statusCode: 500,
  },
  NO_PERMISSION: {
    message: "Failed to create API key, no permission",
    messageKey: "user-api-key.no-permission",
    statusCode: 403,
  },
  MAX_NUMBER_OF_KEYS: {
    message: "At maximum quota for API keys ",
    messageKey: "user-api-key.max-quota",
    statusCode: 403,
  },
  BAD_REQUEST: {
    message: "Bad request",
    messageKey: "user-api-key.bad-request",
    statusCode: 400,
  },
  REVOCATION_FAILED: {
    message: "Failed to revoke API key",
    messageKey: "user-api-key.revocation-failed",
    statusCode: 500,
  },
  IP_RESTRICTION_FAILED: {
    message: "API key IP restriction validation failed",
    messageKey: "user-api-key.ip-restriction-failed",
    statusCode: 400,
  },
  DOMAIN_RESTRICTION_FAILED: {
    message: "API key domain restriction validation failed",
    messageKey: "user-api-key.domain-restriction-failed",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

export type UserApiKeyErrorKey = keyof typeof USER_API_KEY_ERRORS;
export type UserErrorKey = keyof typeof USER_ERRORS;
export type RecoveryPhraseErrorKey = keyof typeof RECOVERY_PHRASE_ERRORS;
