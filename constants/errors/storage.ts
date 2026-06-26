/**
 * @file constants/errors/storage.ts
 * @description Storage error message constants
 */
/**
 * Storage Provider Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Storage Operation Errors
 */
export const STORAGE_ERRORS = {
  FILE_NOT_FOUND: {
    message: "File not found in storage",
    messageKey: "storage.file-not-found",
    statusCode: 404,
  },
  QUOTA_EXCEEDED: {
    message: "Storage quota exceeded",
    messageKey: "storage.quota-exceeded",
    statusCode: 413,
  },
  UPLOAD_FAILED: {
    message: "File upload to storage failed",
    messageKey: "storage.upload-failed",
    statusCode: 500,
  },
  DOWNLOAD_FAILED: {
    message: "File download from storage failed",
    messageKey: "storage.download-failed",
    statusCode: 500,
  },
  DELETE_FAILED: {
    message: "File deletion from storage failed",
    messageKey: "storage.delete-failed",
    statusCode: 500,
  },
  PROVIDER_ERROR: {
    message: "Storage provider error",
    messageKey: "storage.provider-error",
    statusCode: 500,
  },
  INVALID_PATH: {
    message: "Invalid storage path",
    messageKey: "storage.invalid-path",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

export type StorageErrorKey = keyof typeof STORAGE_ERRORS;
