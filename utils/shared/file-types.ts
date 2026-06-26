/**
 * @file utils/shared/file-types.ts
 * @description Centralized file type metadata, size limits, and helpers
 *
 * This module consolidates MIME type catalogs, category detection, and basic
 * validation utilities that were previously duplicated across upload-related
 * services. Keeping this information in one place ensures consistent handling
 * of supported file types and limits across the application.
 */

export type FileCategory = "document" | "image" | "video" | "audio" | "archive";

/**
 * File size limits by category (in bytes)
 */
export const FILE_SIZE_LIMITS: Record<FileCategory | "absolute", number> = {
  document: 500 * 1024 * 1024, // 500MB
  image: 200 * 1024 * 1024, // 200MB
  video: 100 * 1024 * 1024 * 1024, // 100GB
  audio: 500 * 1024 * 1024, // 500MB
  archive: 150 * 1024 * 1024 * 1024, // 150GB
  absolute: 200 * 1024 * 1024 * 1024, // 200GB absolute maximum
};

/**
 * Supported MIME types grouped by logical category
 */
export const MIME_TYPES_BY_CATEGORY: Record<FileCategory, readonly string[]> = {
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/rtf",
    "application/json",
    "application/xml",
    "text/xml",
    "text/plain",
    "text/csv",
    "text/html",
    "text/css",
    "text/javascript",
  ] as const,
  image: [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
    "image/tiff",
  ] as const,
  video: [
    "video/mp4",
    "video/mpeg",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
    "video/webm",
    "video/ogg",
    "video/avi",
    "video/mov",
    "video/mkv",
    "video/wmv",
    "video/flv",
    "video/3gp",
  ] as const,
  audio: [
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/wav",
    "audio/webm",
    "audio/ogg",
    "audio/aac",
    "audio/flac",
    "audio/m4a",
    "audio/wma",
    "audio/opus",
  ] as const,
  archive: [
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
  ] as const,
};

/**
 * Flattened list of all supported MIME types
 */
export const ALL_SUPPORTED_MIME_TYPES: readonly string[] = Object.values(
  MIME_TYPES_BY_CATEGORY,
).flat();

/**
 * Flattened list of media MIME types (video + audio)
 */
export const SUPPORTED_MEDIA_MIME_TYPES: readonly string[] = [
  ...MIME_TYPES_BY_CATEGORY.video,
  ...MIME_TYPES_BY_CATEGORY.audio,
];

/**
 * Determine the canonical category for a MIME type
 */
export function determineFileCategory(mimeType: string): FileCategory | "unknown" {
  const normalized = mimeType.toLowerCase().trim();

  for (const [category, types] of Object.entries(MIME_TYPES_BY_CATEGORY)) {
    if ((types as readonly string[]).includes(normalized)) {
      return category as FileCategory;
    }
  }

  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";

  return "unknown";
}

/**
 * Determine a display-friendly content type from MIME type
 */
export function determineContentType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().trim();

  if (normalized === "application/pdf") return "pdf";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("text/")) return "text";
  if (
    normalized.includes("spreadsheet") ||
    normalized.includes("excel") ||
    normalized === "text/csv"
  ) {
    return "spreadsheet";
  }
  if (normalized.includes("presentation") || normalized.includes("powerpoint")) {
    return "presentation";
  }
  if (
    normalized.includes("zip") ||
    normalized.includes("rar") ||
    normalized.includes("tar") ||
    normalized.includes("7z") ||
    normalized.includes("gzip")
  ) {
    return "archive";
  }

  return "other";
}

/**
 * Check if a MIME type is part of the supported catalog
 */
export function isMimeTypeSupported(mimeType: string): boolean {
  return determineFileCategory(mimeType) !== "unknown";
}

/**
 * Return the size limit for a given category. Falls back to the absolute limit.
 */
export function getSizeLimitForCategory(category: FileCategory | "absolute"): number {
  return FILE_SIZE_LIMITS[category] ?? FILE_SIZE_LIMITS.absolute;
}

/**
 * Return the size limit for a MIME type
 */
export function getSizeLimitForMimeType(mimeType: string): number {
  const category = determineFileCategory(mimeType);
  return category === "unknown" ? FILE_SIZE_LIMITS.absolute : getSizeLimitForCategory(category);
}

/**
 * Basic validation result used for binary uploads
 */
export interface BasicFileValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Options for basic binary file validation
 */
export interface BasicFileValidationOptions {
  maxFileSize?: number;
  allowedMimeTypes?: readonly string[];
}

/**
 * Descriptor for a generic binary file
 */
export interface BasicFileDescriptor {
  size: number;
  mimeType: string;
  name?: string;
}

/**
 * Perform lightweight validation against size and allowed MIME types.
 * Consumers can layer additional validation logic if needed.
 */
export function validateBinaryFile(
  descriptor: BasicFileDescriptor,
  options: BasicFileValidationOptions = {},
): BasicFileValidationResult {
  const { size, mimeType } = descriptor;
  const {
    maxFileSize = FILE_SIZE_LIMITS.absolute,
    allowedMimeTypes,
  } = options;

  if (size > maxFileSize) {
    return {
      valid: false,
      error: `File size ${size} bytes exceeds maximum allowed size of ${maxFileSize} bytes`,
    };
  }

  if (allowedMimeTypes && allowedMimeTypes.length > 0) {
    const normalized = mimeType.toLowerCase().trim();
    const allowedNormalized = allowedMimeTypes.map((type) => type.toLowerCase());

    if (!allowedNormalized.includes(normalized)) {
      return {
        valid: false,
        error: `File type ${mimeType} is not allowed. Allowed types: ${allowedMimeTypes.join(", ")}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Helper to expose supported MIME types for a given category
 */
export function getMimeTypesForCategory(category: FileCategory): readonly string[] {
  return MIME_TYPES_BY_CATEGORY[category];
}

/**
 * Returns true when the MIME type is eligible for metadata extraction
 */
export function supportsMetadataExtraction(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("video/") || normalized.startsWith("audio/");
}
