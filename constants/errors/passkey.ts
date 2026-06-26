/**
 * @file constants/errors/passkey.ts
 * @description Passkey error message constants
 */
/**
 * Passkey Management Error Constants
 */

import type { ErrorCategory } from "./types.ts";

export const PASSKEY_ERRORS = {
  NOT_FOUND: {
    message: "Passkey not found",
    messageKey: "passkey.not-found",
    statusCode: 404,
  },
  CANNOT_DELETE_LAST_NO_PASSWORD: {
    message: "Cannot delete last passkey without a password",
    messageKey: "passkey.cannot-delete-last-no-password",
    statusCode: 400,
  },
  CANNOT_DELETE_LAST_WITH_ENCRYPTION: {
    message: "Cannot delete last passkey while enhanced encryption is enabled",
    messageKey: "passkey.cannot-delete-last-with-encryption",
    statusCode: 400,
  },
  REAUTH_REQUIRED_FOR_DELETE: {
    message: "Recent re-authentication required to delete passkey",
    messageKey: "passkey.reauth-required-for-delete",
    statusCode: 401,
  },
  CANNOT_ADD_WITHOUT_PASSWORD_OR_RECOVERY: {
    message: "Cannot add passkey without password or recovery",
    messageKey: "passkey.cannot-add-without-password-or-recovery",
    statusCode: 400,
  },
  CANNOT_ADD_PRF_WITHOUT_PASSWORD: {
    message: "Cannot add passkey with PRF without password",
    messageKey: "passkey.cannot-add-prf-without-password",
    statusCode: 400,
  },
  ALREADY_EXISTS: {
    message: "Passkey already exists for this user",
    messageKey: "passkey.already-exists",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

export type PasskeyErrorKey = keyof typeof PASSKEY_ERRORS;
