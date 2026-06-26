/**
 * @file constants/errors/media.ts
 * @description Media error message constants
 */
/**
 * Media and File Processing Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Media Processing Errors
 */
export const MEDIA_ERRORS = {
  UPLOAD_FAILED: {
    message: "File upload failed",
    messageKey: "media.upload-failed",
    statusCode: 500,
  },
  INVALID_FILE: {
    message: "Invalid file provided",
    messageKey: "media.invalid-file",
    statusCode: 400,
  },
  INVALID_FILE_TYPE: {
    message: "Invalid file type provided",
    messageKey: "media.invalid-file-type",
    statusCode: 400,
  },
  FILE_TOO_LARGE: {
    message: "File size exceeds maximum limit",
    messageKey: "media.file-too-large",
    statusCode: 413,
  },
  PROCESSING_FAILED: {
    message: "Media processing failed",
    messageKey: "media.processing-failed",
    statusCode: 500,
  },
  STREAMING_FAILED: {
    message: "Media streaming failed",
    messageKey: "media.streaming-failed",
    statusCode: 500,
  },
  TRANSCODING_FAILED: {
    message: "Media transcoding failed",
    messageKey: "media.transcoding-failed",
    statusCode: 500,
  },
  THUMBNAIL_GENERATION_FAILED: {
    message: "Thumbnail generation failed",
    messageKey: "media.thumbnail-generation-failed",
    statusCode: 500,
  },
  METADATA_EXTRACTION_FAILED: {
    message: "Media metadata extraction failed",
    messageKey: "media.metadata-extraction-failed",
    statusCode: 500,
  },
  STORAGE_QUOTA_EXCEEDED: {
    message: "Storage quota exceeded",
    messageKey: "media.storage-quota-exceeded",
    statusCode: 507,
  },
  FILE_NOT_FOUND: {
    message: "Media file not found",
    messageKey: "media.file-not-found",
    statusCode: 404,
  },
  ACCESS_DENIED: {
    message: "Access denied to media file",
    messageKey: "media.access-denied",
    statusCode: 403,
  },
  UPLOAD_SESSION_NOT_FOUND: {
    message: "Upload session not found or expired",
    messageKey: "document.upload-session-not-found",
    statusCode: 404,
  },
  UPLOAD_SESSION_EXPIRED: {
    message: "Upload session has expired",
    messageKey: "document.upload-session-expired",
    statusCode: 410,
  },
  UPLOAD_INCOMPLETE: {
    message: "Upload incomplete - not all chunks uploaded",
    messageKey: "document.upload-incomplete",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

export type MediaErrorKey = keyof typeof MEDIA_ERRORS;
