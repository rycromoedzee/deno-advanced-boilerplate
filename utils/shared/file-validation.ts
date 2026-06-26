/**
 * @file utils/shared/file-validation.ts
 * @description Shared helpers for validating file metadata across services
 */

import {
  determineContentType,
  determineFileCategory,
  FILE_SIZE_LIMITS,
  type FileCategory,
  getSizeLimitForCategory,
  getSizeLimitForMimeType,
  isMimeTypeSupported,
  MIME_TYPES_BY_CATEGORY,
} from "./file-types.ts";
import { getExtensionFromMimeType, getMimeTypeFromExtension } from "./mime-types.ts";

/**
 * Minimal metadata required to validate a file upload.
 */
export interface FileValidationMetadata {
  name?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}

/**
 * Result of the high-level file validation routine.
 */
export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
}

type UppercaseCategory = Uppercase<FileCategory>;

/**
 * Result of detailed MIME type validation.
 */
export interface FileTypeValidationResult {
  valid: boolean;
  category?: UppercaseCategory;
  error?: string;
  mimeType?: string;
}

/**
 * Result of detailed file size validation.
 */
export interface FileSizeValidationResult {
  valid: boolean;
  size: number;
  limit: number;
  category?: string;
  error?: string;
}

/**
 * Validates required metadata prior to accepting a file upload.
 * Mirrors the behaviour of the legacy FileValidator class.
 */
export function validateFileMetadata(
  metadata: FileValidationMetadata,
): FileValidationResult {
  const errors: string[] = [];

  const name = metadata.name ?? "";
  const fileSize = typeof metadata.fileSize === "number" ? metadata.fileSize : undefined;
  const mimeType = metadata.mimeType?.trim();

  if (name.trim().length === 0) {
    errors.push("File name is required");
  }

  if (fileSize === undefined || Number.isNaN(fileSize) || fileSize <= 0) {
    errors.push("File size must be greater than 0");
  }

  if (!mimeType || mimeType.length === 0) {
    errors.push("MIME type is required");
  }

  if (fileSize !== undefined && fileSize > FILE_SIZE_LIMITS.absolute) {
    errors.push(
      `File size exceeds absolute maximum of ${FILE_SIZE_LIMITS.absolute / (1024 * 1024)}MB`,
    );
  }

  if (mimeType) {
    const normalizedMimeType = mimeType.toLowerCase();
    const category = determineFileCategory(normalizedMimeType);

    if (category === "unknown") {
      errors.push(`Unsupported MIME type: ${mimeType}`);
    } else {
      if (fileSize !== undefined) {
        const categoryLimit = getSizeLimitForCategory(category);
        if (fileSize > categoryLimit) {
          errors.push(
            `File size exceeds ${category} limit of ${categoryLimit / (1024 * 1024)}MB`,
          );
        }
      }

      const supportedTypes = MIME_TYPES_BY_CATEGORY[category];
      if (
        supportedTypes &&
        !supportedTypes.map((type) => type.toLowerCase()).includes(normalizedMimeType)
      ) {
        errors.push(
          `MIME type ${mimeType} is not supported for ${category} files`,
        );
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a MIME type and optional filename against the supported catalog.
 */
export function validateFileType(
  mimeType: string,
  filename?: string,
): FileTypeValidationResult {
  const normalizedMimeType = mimeType.toLowerCase().trim();

  const category = determineFileCategory(normalizedMimeType);
  if (category === "unknown") {
    return {
      valid: false,
      error: `Unsupported file type: ${mimeType}`,
    };
  }

  if (filename) {
    const extension = filename.split(".").pop()?.toLowerCase();
    if (extension) {
      const expectedMimeType = getMimeTypeFromExtension(extension);
      if (expectedMimeType && expectedMimeType !== normalizedMimeType) {
        return {
          valid: false,
          error: `File extension .${extension} does not match MIME type ${mimeType}`,
        };
      }
    }
  }

  return {
    valid: true,
    category: category.toUpperCase() as UppercaseCategory,
    mimeType: normalizedMimeType,
  };
}

/**
 * Validates a file size against category-specific limits.
 */
export function validateFileSize(
  fileSize: number,
  mimeType: string,
): FileSizeValidationResult {
  if (fileSize > FILE_SIZE_LIMITS.absolute) {
    return {
      valid: false,
      size: fileSize,
      limit: FILE_SIZE_LIMITS.absolute,
      error: `File size ${formatBytes(fileSize)} exceeds absolute maximum of ${formatBytes(FILE_SIZE_LIMITS.absolute)}`,
    };
  }

  const category = determineFileCategory(mimeType);
  if (category === "unknown") {
    return {
      valid: false,
      size: fileSize,
      limit: FILE_SIZE_LIMITS.absolute,
      error: "Cannot determine file category for size validation",
    };
  }

  const limit = category === "archive" ? FILE_SIZE_LIMITS.absolute : getSizeLimitForCategory(category);

  if (fileSize > limit) {
    return {
      valid: false,
      size: fileSize,
      limit,
      category: category.toUpperCase(),
      error: `File size ${formatBytes(fileSize)} exceeds ${category.toLowerCase()} limit of ${formatBytes(limit)}`,
    };
  }

  return {
    valid: true,
    size: fileSize,
    limit,
    category: category.toUpperCase(),
  };
}

/**
 * Executes both MIME type and size validation for convenience.
 */
export function validateFileUpload(
  filename: string,
  mimeType: string,
  fileSize: number,
): {
  typeValidation: FileTypeValidationResult;
  sizeValidation: FileSizeValidationResult;
  valid: boolean;
  errors: string[];
} {
  const typeValidation = validateFileType(mimeType, filename);
  const sizeValidation = validateFileSize(fileSize, mimeType);

  const errors: string[] = [];
  if (!typeValidation.valid && typeValidation.error) {
    errors.push(typeValidation.error);
  }
  if (!sizeValidation.valid && sizeValidation.error) {
    errors.push(sizeValidation.error);
  }

  return {
    typeValidation,
    sizeValidation,
    valid: typeValidation.valid && sizeValidation.valid,
    errors,
  };
}

/**
 * Re-export helpers from other shared modules for convenience.
 */
export {
  determineContentType,
  determineFileCategory,
  getExtensionFromMimeType,
  getSizeLimitForCategory,
  getSizeLimitForMimeType,
  isMimeTypeSupported,
};

/**
 * File-size formatter for validation error messages.
 *
 * NOTE: intentionally distinct from `services/cache/cache-utils.ts::formatBytes`
 * — that one emits cache-stat strings (`"1.50MB"`, `B`/`KB`/`MB`/`GB`, no space);
 * this one emits human-readable error-message strings (`"1.50 MB"`,
 * `Bytes`/`KB`/`MB`/`GB`/`TB`, with space, configurable precision). Same name,
 * different policy + audience — not a true duplicate, so not merged (see
 * plans/refactor-review-log.md, Phase 9 · 9e). Kept local because it has exactly
 * two call sites in this file.
 */
function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
