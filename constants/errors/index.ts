/**
 * @file constants/errors/index.ts
 * @description Barrel exports for domain error message constants
 */
/**
 * Centralized Error Constants Index
 *
 * This file exports all error constants from their respective modules,
 * providing a single point of access for all error definitions.
 */

// Export shared types
export type { ErrorCategory, ErrorDefinition } from "./types.ts";

// Export authentication errors
export { AUTH_ERRORS } from "./auth.ts";
export type { AuthErrorKey } from "./auth.ts";

// Export session and API key errors
export { API_KEY_ERRORS, SESSION_ERRORS } from "./session.ts";
export type { ApiKeyErrorKey, SessionErrorKey } from "./session.ts";

// Export user management errors
export { RECOVERY_PHRASE_ERRORS, USER_API_KEY_ERRORS, USER_ERRORS } from "./user.ts";
export type { RecoveryPhraseErrorKey, UserApiKeyErrorKey, UserErrorKey } from "./user.ts";

// Export environment-config-user errors
export { ENV_CONFIG_USER_ERRORS } from "./environment-config-user.ts";
export type { EnvConfigUserErrorKey } from "./environment-config-user.ts";

// Export common HTTP errors
export { COMMON_ERRORS, RATE_LIMIT_ERRORS } from "./common.ts";
export type { CommonErrorKey, RateLimitErrorKey } from "./common.ts";

// Export database errors
export { DATABASE_ERRORS } from "./database.ts";
export type { DatabaseErrorKey } from "./database.ts";

// Export encryption and security errors
export { ENCRYPTION_ERRORS, WEBAUTHN_ERRORS } from "./encryption.ts";
export type { EncryptionErrorKey, WebAuthnErrorKey } from "./encryption.ts";

// Export passkey errors
export { PASSKEY_ERRORS } from "./passkey.ts";
export type { PasskeyErrorKey } from "./passkey.ts";

// Export media processing errors
export { MEDIA_ERRORS } from "./media.ts";
export type { MediaErrorKey } from "./media.ts";

// Export validation errors
export { VALIDATION_ERRORS } from "./validation.ts";
export type { ValidationErrorKey } from "./validation.ts";

// Export external service errors
export { EMAIL_ERRORS, EXTERNAL_SERVICE_ERRORS } from "./external.ts";
export type { EmailErrorKey, ExternalServiceErrorKey } from "./external.ts";

// Export storage errors
export { STORAGE_ERRORS } from "./storage.ts";
export type { StorageErrorKey } from "./storage.ts";

// Export job errors
export { JOB_ERRORS } from "./jobs.ts";
export type { JobErrorKey } from "./jobs.ts";

// Export public sharing errors
export { PUBLIC_SHARE_ERRORS } from "./public-sharing.ts";
export type { PublicShareErrorKey } from "./public-sharing.ts";

// Export environment errors
export { ENVIRONMENT_ERRORS } from "./environment.ts";
export type { EnvironmentErrorKey } from "./environment.ts";

// Export document management errors
export { DOCUMENT_ACCESS, DOCUMENT_COMMENT, DOCUMENT_ERRORS, DOCUMENT_FOLDER_ERRORS } from "./documents.ts";
export type { DocumentAccessErrorKey, DocumentCommentErrorKey, DocumentErrorKey, DocumentFolderErrorKey } from "./documents.ts";

// Export upload / multipart errors
export { UPLOAD_ERRORS } from "./upload.ts";
export type { UploadErrorKey } from "./upload.ts";

// Export notes management errors
export { NOTE_ATTACHMENT_ERRORS, NOTE_COLLECTION_ERRORS, NOTE_ERRORS, NOTE_TAG_ERRORS } from "./notes.ts";
export type { NoteAttachmentErrorKey, NoteCollectionErrorKey, NoteErrorKey, NoteTagErrorKey } from "./notes.ts";

/**
 * All error categories combined for easy access
 */
export const ALL_ERRORS = {
  AUTH: AUTH_ERRORS,
  API_KEY: API_KEY_ERRORS,
  SESSION: SESSION_ERRORS,
  USER: USER_ERRORS,
  RECOVERY_PHRASE: RECOVERY_PHRASE_ERRORS,
  COMMON: COMMON_ERRORS,
  RATE_LIMIT: RATE_LIMIT_ERRORS,
  DATABASE: DATABASE_ERRORS,
  ENCRYPTION: ENCRYPTION_ERRORS,
  WEBAUTHN: WEBAUTHN_ERRORS,
  PASSKEY: PASSKEY_ERRORS,
  MEDIA: MEDIA_ERRORS,
  VALIDATION: VALIDATION_ERRORS,
  EXTERNAL_SERVICE: EXTERNAL_SERVICE_ERRORS,
  EMAIL: EMAIL_ERRORS,
  USER_API_KEY: USER_API_KEY_ERRORS,
  STORAGE: STORAGE_ERRORS,
  ENV_CONFIG_USER: ENV_CONFIG_USER_ERRORS,
  PERMISSION: PERMISSION_ERRORS,
  PERMISSION_GROUP: PERMISSION_GROUP_ERRORS,
  JOBS: JOB_ERRORS,
  PUBLIC_SHARE: PUBLIC_SHARE_ERRORS,
  ENVIRONMENT: ENVIRONMENT_ERRORS,
  DOCUMENT: DOCUMENT_ERRORS,
  DOCUMENT_FOLDER: DOCUMENT_FOLDER_ERRORS,
  DOCUMENT_ACCESS: DOCUMENT_ACCESS,
  DOCUMENT_COMMENT: DOCUMENT_COMMENT,
  NOTE: NOTE_ERRORS,
  NOTE_COLLECTION: NOTE_COLLECTION_ERRORS,
  NOTE_ATTACHMENT: NOTE_ATTACHMENT_ERRORS,
  NOTE_TAG: NOTE_TAG_ERRORS,
  UPLOAD: UPLOAD_ERRORS,
} as const;

/**
 * Union type of all error keys for type safety
 */
export type AllErrorKeys =
  | `AUTH.${AuthErrorKey}`
  | `PERMISSION.${PermissionErrorKey}`
  | `PERMISSION_GROUP.${PermissionGroupErrorKey}`
  | `API_KEY.${ApiKeyErrorKey}`
  | `SESSION.${SessionErrorKey}`
  | `USER.${UserErrorKey}`
  | `RECOVERY_PHRASE.${RecoveryPhraseErrorKey}`
  | `COMMON.${CommonErrorKey}`
  | `RATE_LIMIT.${RateLimitErrorKey}`
  | `DATABASE.${DatabaseErrorKey}`
  | `ENCRYPTION.${EncryptionErrorKey}`
  | `WEBAUTHN.${WebAuthnErrorKey}`
  | `PASSKEY.${PasskeyErrorKey}`
  | `MEDIA.${MediaErrorKey}`
  | `VALIDATION.${ValidationErrorKey}`
  | `EXTERNAL_SERVICE.${ExternalServiceErrorKey}`
  | `EMAIL.${EmailErrorKey}`
  | `USER_API_KEY.${UserApiKeyErrorKey}`
  | `STORAGE.${StorageErrorKey}`
  | `ENV_CONFIG_USER.${EnvConfigUserErrorKey}`
  | `JOBS.${JobErrorKey}`
  | `PUBLIC_SHARE.${PublicShareErrorKey}`
  | `ENVIRONMENT.${EnvironmentErrorKey}`
  | `DOCUMENT.${DocumentErrorKey}`
  | `DOCUMENT_FOLDER.${DocumentFolderErrorKey}`
  | `DOCUMENT_ACCESS.${DocumentAccessErrorKey}`
  | `DOCUMENT_COMMENT.${DocumentCommentErrorKey}`
  | `NOTE.${NoteErrorKey}`
  | `NOTE_COLLECTION.${NoteCollectionErrorKey}`
  | `NOTE_ATTACHMENT.${NoteAttachmentErrorKey}`
  | `NOTE_TAG.${NoteTagErrorKey}`
  | `UPLOAD.${UploadErrorKey}`;

/**
 * Helper function to get error definition from error key
 * @param errorKey Error key in format 'CATEGORY.ERROR_NAME' (e.g., 'AUTH.UNAUTHORIZED')
 * @returns ErrorDefinition object with message, messageKey, and statusCode
 * @throws Error if the error key is not found
 */
export function getErrorDefinition(errorKey: AllErrorKeys): ErrorDefinition {
  const [category, key] = errorKey.split(".") as [keyof typeof ALL_ERRORS, string];
  const errorCategory = ALL_ERRORS[category] as ErrorCategory | undefined;
  const error = errorCategory?.[key];

  if (!error) {
    throw new Error(`Error definition not found for key: ${errorKey}`);
  }

  return error;
}

/**
 * Helper function to create error definition with custom message but standard messageKey
 * @param baseErrorKey Base error key from error constants
 * @param customMessage Custom message to override the default
 * @returns ErrorDefinition with custom message
 */
export function createCustomError(
  baseErrorKey: AllErrorKeys,
  customMessage: string,
): ErrorDefinition {
  const baseError = getErrorDefinition(baseErrorKey);
  return {
    ...baseError,
    message: customMessage,
  };
}

// Import statements for the combined object (needed for proper module resolution)
import { AUTH_ERRORS } from "./auth.ts";
import { API_KEY_ERRORS, SESSION_ERRORS } from "./session.ts";
import { RECOVERY_PHRASE_ERRORS, USER_API_KEY_ERRORS, USER_ERRORS } from "./user.ts";
import { ENV_CONFIG_USER_ERRORS } from "./environment-config-user.ts";
import { COMMON_ERRORS, RATE_LIMIT_ERRORS } from "./common.ts";
import { DATABASE_ERRORS } from "./database.ts";
import { ENCRYPTION_ERRORS, WEBAUTHN_ERRORS } from "./encryption.ts";
import { PASSKEY_ERRORS } from "./passkey.ts";
import { MEDIA_ERRORS } from "./media.ts";
import { VALIDATION_ERRORS } from "./validation.ts";
import { EMAIL_ERRORS, EXTERNAL_SERVICE_ERRORS } from "./external.ts";
import { STORAGE_ERRORS } from "./storage.ts";
import { PERMISSION_ERRORS, PERMISSION_GROUP_ERRORS } from "./permissions.ts";
import { JOB_ERRORS } from "./jobs.ts";
import { PUBLIC_SHARE_ERRORS } from "./public-sharing.ts";
import { ENVIRONMENT_ERRORS } from "./environment.ts";
import { DOCUMENT_ACCESS, DOCUMENT_COMMENT, DOCUMENT_ERRORS, DOCUMENT_FOLDER_ERRORS } from "./documents.ts";
import { NOTE_ATTACHMENT_ERRORS, NOTE_COLLECTION_ERRORS, NOTE_ERRORS, NOTE_TAG_ERRORS } from "./notes.ts";
import { UPLOAD_ERRORS } from "./upload.ts";

import type { ErrorCategory, ErrorDefinition } from "./types.ts";
import type { AuthErrorKey } from "./auth.ts";
import type { ApiKeyErrorKey, SessionErrorKey } from "./session.ts";
import type { RecoveryPhraseErrorKey, UserApiKeyErrorKey, UserErrorKey } from "./user.ts";
import type { EnvConfigUserErrorKey } from "./environment-config-user.ts";
import type { CommonErrorKey, RateLimitErrorKey } from "./common.ts";
import type { DatabaseErrorKey } from "./database.ts";
import type { EncryptionErrorKey, WebAuthnErrorKey } from "./encryption.ts";
import type { PasskeyErrorKey } from "./passkey.ts";
import type { MediaErrorKey } from "./media.ts";
import type { ValidationErrorKey } from "./validation.ts";
import type { EmailErrorKey, ExternalServiceErrorKey } from "./external.ts";
import type { StorageErrorKey } from "./storage.ts";
import type { PermissionErrorKey, PermissionGroupErrorKey } from "./permissions.ts";
import type { JobErrorKey } from "./jobs.ts";
import type { PublicShareErrorKey } from "./public-sharing.ts";
import type { EnvironmentErrorKey } from "./environment.ts";
import type { DocumentAccessErrorKey, DocumentCommentErrorKey, DocumentErrorKey, DocumentFolderErrorKey } from "./documents.ts";
import type { NoteAttachmentErrorKey, NoteCollectionErrorKey, NoteErrorKey, NoteTagErrorKey } from "./notes.ts";
import type { UploadErrorKey } from "./upload.ts";
