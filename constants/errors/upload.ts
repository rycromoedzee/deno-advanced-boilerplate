/**
 * @file constants/errors/upload.ts
 * @description Upload error message constants
 */
/**
 * Upload / multipart protocol error constants.
 *
 * Covers multipart parsing, document/chunked upload validation, and thumbnail
 * validation. Promoted from static throwHttpErrorWithCustomMessage messages so
 * the frontend can distinguish these cases via distinct messageKeys.
 */

import type { ErrorCategory } from "./types.ts";

export const UPLOAD_ERRORS = {
  MULTIPART_MISSING_BOUNDARY: {
    message: "Invalid multipart/form-data: missing boundary",
    messageKey: "upload.multipart-missing-boundary",
    statusCode: 400,
  },
  MULTIPART_EMPTY_BOUNDARY: {
    message: "Invalid multipart/form-data: empty boundary",
    messageKey: "upload.multipart-empty-boundary",
    statusCode: 400,
  },
  CONTENT_TYPE_NOT_MULTIPART: {
    message: "Content-Type must be multipart/form-data",
    messageKey: "upload.content-type-not-multipart",
    statusCode: 400,
  },
  BODY_EMPTY: {
    message: "Request body is empty",
    messageKey: "upload.body-empty",
    statusCode: 400,
  },
  TOO_MANY_FORM_FIELDS: {
    message: "Too many form fields",
    messageKey: "upload.too-many-form-fields",
    statusCode: 400,
  },
  MULTIPLE_FILE_FIELDS: {
    message: "Only one file field is allowed",
    messageKey: "upload.multiple-file-fields",
    statusCode: 400,
  },
  PART_HEADER_TOO_LARGE: {
    message: "Multipart part header too large",
    messageKey: "upload.part-header-too-large",
    statusCode: 400,
  },
  PART_MISSING_NAME: {
    message: "Multipart part missing name in Content-Disposition",
    messageKey: "upload.part-missing-name",
    statusCode: 400,
  },
  CHUNK_DATA_REQUIRED: {
    message: "No chunk data provided",
    messageKey: "upload.chunk-data-required",
    statusCode: 400,
  },
  ENCRYPTION_DATA_MISSING: {
    message: "Encryption data not found in upload session",
    messageKey: "upload.encryption-data-missing",
    statusCode: 500,
  },
  TAGS_NOT_ARRAY: {
    message: "Tags must be an array",
    messageKey: "upload.tags-not-array",
    statusCode: 400,
  },
  METADATA_NOT_OBJECT: {
    message: "Metadata must be an object",
    messageKey: "upload.metadata-not-object",
    statusCode: 400,
  },
  SHARED_USERS_NOT_ARRAY: {
    message: "Shared users must be an array",
    messageKey: "upload.shared-users-not-array",
    statusCode: 400,
  },
  ADMIN_PERMISSION_FORBIDDEN: {
    message: "Cannot grant ADMIN permission during upload",
    messageKey: "upload.admin-permission-forbidden",
    statusCode: 400,
  },
  THUMBNAIL_REQUIRED: {
    message: "No thumbnail data provided",
    messageKey: "upload.thumbnail-required",
    statusCode: 400,
  },
  THUMBNAIL_INVALID_JPEG: {
    message: "Invalid image format — must be a valid JPEG",
    messageKey: "upload.thumbnail-invalid-jpeg",
    statusCode: 400,
  },
  NO_FILE_PROVIDED: {
    message: "No file provided or invalid file",
    messageKey: "upload.no-file-provided",
    statusCode: 400,
  },
  TAGS_INVALID_JSON: {
    message: "Invalid tags format - must be valid JSON array",
    messageKey: "upload.tags-invalid-json",
    statusCode: 400,
  },
  METADATA_INVALID_JSON: {
    message: "Invalid metadata format - must be valid JSON object",
    messageKey: "upload.metadata-invalid-json",
    statusCode: 400,
  },
  SHARED_USERS_INVALID_JSON: {
    message: "Invalid shared users format - must be valid JSON array",
    messageKey: "upload.shared-users-invalid-json",
    statusCode: 400,
  },
  DOCUMENT_ID_REQUIRED: {
    message: "Document ID is required",
    messageKey: "upload.document-id-required",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

export type UploadErrorKey = keyof typeof UPLOAD_ERRORS;
