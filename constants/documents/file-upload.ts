/**
 * @file constants/documents/file-upload.ts
 * @description File upload configuration and constraints
 *
 * Centralized from models/documents/validation-schemas.model.ts
 * Provides file size limits and upload constraints for the document system.
 */

import { NUMERIC_LIMITS } from "../validation/numeric-limits.ts";
import { STRING_LENGTH_CONSTRAINTS } from "../validation/string-lengths.ts";
import { MIME_TYPES_BY_CATEGORY } from "@utils/shared/index.ts";

/**
 * File size limits in bytes and GB
 */
export const FILE_SIZE_LIMITS = {
  MAX_BYTES: NUMERIC_LIMITS.MAX_FILE_SIZE_BYTES, // 5GB
  MAX_GB: NUMERIC_LIMITS.MAX_FILE_SIZE_GB,
} as const;

/**
 * Allowed MIME types by category
 */
export const ALLOWED_MIME_TYPES = {
  // Document types
  DOCUMENTS: MIME_TYPES_BY_CATEGORY.document,

  // Image types
  IMAGES: MIME_TYPES_BY_CATEGORY.image,

  // Video types
  VIDEOS: MIME_TYPES_BY_CATEGORY.video,

  // Audio types
  AUDIO: MIME_TYPES_BY_CATEGORY.audio,

  // Archive types
  ARCHIVES: MIME_TYPES_BY_CATEGORY.archive,

  // Text types
  TEXT: MIME_TYPES_BY_CATEGORY.document.filter((type) => type.startsWith("text/") || type === "application/json"),
} as const;

/**
 * Flattened array of all allowed MIME types
 */
export const ALL_ALLOWED_MIME_TYPES = [
  ...new Set([
    ...ALLOWED_MIME_TYPES.DOCUMENTS,
    ...ALLOWED_MIME_TYPES.IMAGES,
    ...ALLOWED_MIME_TYPES.VIDEOS,
    ...ALLOWED_MIME_TYPES.AUDIO,
    ...ALLOWED_MIME_TYPES.ARCHIVES,
    ...ALLOWED_MIME_TYPES.TEXT,
  ]),
] as const;

/**
 * File upload constraint object (backward compatibility)
 *
 * @deprecated This is maintained for backward compatibility.
 * New code should import individual constants from their respective modules.
 */
export const FILE_UPLOAD_CONSTRAINTS = {
  MAX_FILE_SIZE: FILE_SIZE_LIMITS.MAX_BYTES,
  MAX_NAME_LENGTH: STRING_LENGTH_CONSTRAINTS.NAME_MAX,
  MAX_DESCRIPTION_LENGTH: STRING_LENGTH_CONSTRAINTS.DESCRIPTION_STANDARD_MAX,
  MAX_TAGS: NUMERIC_LIMITS.MAX_TAGS_PER_DOCUMENT,
  ALLOWED_MIME_TYPES: ALL_ALLOWED_MIME_TYPES,
} as const;
